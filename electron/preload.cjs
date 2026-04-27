const { contextBridge, ipcRenderer } = require('electron');

const ALLOWED_CHANNELS_INVOKE = new Set([
  'app:getInfo',
  'dialog:selectDirectory',
  'dialog:selectFile',
  'shell:showItemInFolder',
  'shell:openExternal',
  'shell:openPath',
  'system:getInfo',
  'system:checkDependencies',
  'window:minimize',
  'window:maximize',
  'window:close',
  'window:isMaximized',
  'updater:check',
  'updater:install',
  'notification:show',
  'clipboard:writeText',
  'clipboard:readText',
]);

const ALLOWED_CHANNELS_ON = new Set([
  'updater:available',
  'updater:not-available',
  'updater:downloaded',
  'updater:progress',
  'updater:error',
  'app:navigate',
  'server:status',
]);

const ALLOWED_CHANNELS_SEND = new Set([
  'telemetry:renderer-log',
]);

const RENDERER_TRACE_ENABLED = true;
const RENDERER_TRACE_MAX_BODY_CHARS = 4000;
const RENDERER_TRACE_FETCH_TIMEOUT_MS = 45000;
const RENDERER_TRACE_IPC_TIMEOUT_MS = 45000;
const MAIN_WORLD_TRACE_HOOK = '__lingzhiRendererTraceHook';
let rendererIpcTraceSequence = 0;
let mainWorldBridgeInjected = false;

function safeInvoke(channel, ...args) {
  if (!ALLOWED_CHANNELS_INVOKE.has(channel)) {
    return Promise.reject(new Error(`IPC channel "${channel}" is not allowed`));
  }

  const traceId = `renderer-ipc-${Date.now()}-${++rendererIpcTraceSequence}`;
  const startedAt = Date.now();
  traceRendererEvent('ipc.invoke.start', {
    traceId,
    channel,
    args: summarizePayload(args),
  });

  let timeoutHandle = null;
  if (Number.isFinite(RENDERER_TRACE_IPC_TIMEOUT_MS) && RENDERER_TRACE_IPC_TIMEOUT_MS > 0) {
    timeoutHandle = setTimeout(() => {
      traceRendererEvent('ipc.invoke.timeout', {
        traceId,
        channel,
        elapsedMs: Date.now() - startedAt,
      });
    }, RENDERER_TRACE_IPC_TIMEOUT_MS);
  }

  return ipcRenderer.invoke(channel, ...args)
    .then((result) => {
      traceRendererEvent('ipc.invoke.finish', {
        traceId,
        channel,
        durationMs: Date.now() - startedAt,
        result: summarizePayload(result),
      });
      return result;
    })
    .catch((error) => {
      traceRendererEvent('ipc.invoke.error', {
        traceId,
        channel,
        durationMs: Date.now() - startedAt,
        error: sanitizePayload(error),
      });
      throw error;
    })
    .finally(() => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    });
}

function safeOn(channel, callback) {
  if (!ALLOWED_CHANNELS_ON.has(channel)) {
    throw new Error(`IPC channel "${channel}" is not allowed`);
  }

  const wrappedCallback = (_event, ...args) => callback(...args);
  ipcRenderer.on(channel, wrappedCallback);

  return () => {
    ipcRenderer.removeListener(channel, wrappedCallback);
  };
}

function safeSend(channel, ...args) {
  if (!ALLOWED_CHANNELS_SEND.has(channel)) {
    throw new Error(`IPC channel "${channel}" is not allowed`);
  }

  ipcRenderer.send(channel, ...args);
}

function serializeError(error) {
  if (!(error instanceof Error)) {
    return String(error);
  }

  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
  };
}

function trimString(value, maxChars = RENDERER_TRACE_MAX_BODY_CHARS) {
  if (typeof value !== 'string') {
    return value;
  }
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars)}...(truncated)`;
}

function sanitizePayload(value, depth = 0) {
  if (value == null || typeof value === 'boolean' || typeof value === 'number') {
    return value;
  }

  if (typeof value === 'string') {
    return trimString(value);
  }

  if (value instanceof Error) {
    return serializeError(value);
  }

  if (depth >= 3) {
    return '[depth-limit]';
  }

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizePayload(item, depth + 1));
  }

  if (typeof value === 'object') {
    const out = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      if (typeof nestedValue === 'function') continue;
      out[key] = sanitizePayload(nestedValue, depth + 1);
    }
    return out;
  }

  return String(value);
}

function summarizePayload(value) {
  if (value == null || typeof value === 'boolean' || typeof value === 'number') {
    return value;
  }

  if (typeof value === 'string') {
    return trimString(value, 1200);
  }

  if (value instanceof Error) {
    return serializeError(value);
  }

  if (Array.isArray(value)) {
    return {
      type: 'array',
      length: value.length,
      sample: sanitizePayload(value.slice(0, 3)),
    };
  }

  if (typeof value === 'object') {
    const keys = Object.keys(value);
    return {
      type: 'object',
      keys: keys.slice(0, 20),
      truncated: keys.length > 20,
    };
  }

  return String(value);
}

function traceRendererEvent(event, payload = null) {
  if (!RENDERER_TRACE_ENABLED) {
    return;
  }

  try {
    safeSend('telemetry:renderer-log', {
      event,
      ts: new Date().toISOString(),
      payload: sanitizePayload(payload),
    });
  } catch {
    // Ignore telemetry send failures.
  }
}

function installFetchTrace(sendRendererLog) {
  const originalFetch = window.fetch.bind(window);

  window.fetch = async (...args) => {
    const traceId = `renderer-fetch-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const startedAt = Date.now();

    let url = '';
    let method = 'GET';
    try {
      url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || String(args[0]));
      method = String(args?.[1]?.method || 'GET').toUpperCase();
    } catch {
      url = '[unresolved-url]';
    }

    sendRendererLog('fetch.start', { traceId, method, url });

    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => {
      controller.abort(new Error(`fetch-timeout-${RENDERER_TRACE_FETCH_TIMEOUT_MS}ms`));
    }, RENDERER_TRACE_FETCH_TIMEOUT_MS);

    const init = args[1] ? { ...args[1] } : {};
    if (!init.signal) {
      init.signal = controller.signal;
    }

    try {
      const response = await originalFetch(args[0], init);
      sendRendererLog('fetch.finish', {
        traceId,
        method,
        url,
        status: response.status,
        ok: response.ok,
        durationMs: Date.now() - startedAt,
      });
      return response;
    } catch (error) {
      sendRendererLog('fetch.error', {
        traceId,
        method,
        url,
        durationMs: Date.now() - startedAt,
        error: sanitizePayload(error),
      });
      throw error;
    } finally {
      clearTimeout(timeoutHandle);
    }
  };
}

function installWebSocketTrace(sendRendererLog) {
  const OriginalWebSocket = window.WebSocket;

  class TracedWebSocket extends OriginalWebSocket {
    constructor(url, protocols) {
      super(url, protocols);
      this.__traceId = `renderer-ws-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      this.__traceUrl = String(url);

      sendRendererLog('ws.create', {
        traceId: this.__traceId,
        url: this.__traceUrl,
      });

      this.addEventListener('open', () => {
        sendRendererLog('ws.open', {
          traceId: this.__traceId,
          url: this.__traceUrl,
        });
      });

      this.addEventListener('close', (event) => {
        sendRendererLog('ws.close', {
          traceId: this.__traceId,
          url: this.__traceUrl,
          code: event.code,
          reason: event.reason,
          wasClean: event.wasClean,
        });
      });

      this.addEventListener('error', () => {
        sendRendererLog('ws.error', {
          traceId: this.__traceId,
          url: this.__traceUrl,
        });
      });

      this.addEventListener('message', (event) => {
        const dataText = typeof event.data === 'string' ? event.data : '[binary]';
        sendRendererLog('ws.message', {
          traceId: this.__traceId,
          url: this.__traceUrl,
          bytes: typeof dataText === 'string' ? dataText.length : null,
          dataPreview: typeof dataText === 'string' ? trimString(dataText, 1200) : dataText,
        });
      });
    }

    send(data) {
      const dataText = typeof data === 'string' ? data : '[binary]';
      sendRendererLog('ws.send', {
        traceId: this.__traceId,
        url: this.__traceUrl,
        bytes: typeof dataText === 'string' ? dataText.length : null,
        dataPreview: typeof dataText === 'string' ? trimString(dataText, 1200) : dataText,
      });
      return super.send(data);
    }
  }

  window.WebSocket = TracedWebSocket;
}

function installXhrTrace(sendRendererLog) {
  const OriginalXhr = window.XMLHttpRequest;
  if (typeof OriginalXhr !== 'function') {
    return;
  }

  class TracedXMLHttpRequest extends OriginalXhr {
    constructor() {
      super();
      this.__traceId = `renderer-xhr-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      this.__traceMethod = 'GET';
      this.__traceUrl = '';
      this.__traceStartedAt = null;

      this.addEventListener('loadend', () => {
        if (this.__traceStartedAt == null) {
          return;
        }
        sendRendererLog('xhr.finish', {
          traceId: this.__traceId,
          method: this.__traceMethod,
          url: this.__traceUrl,
          status: this.status,
          readyState: this.readyState,
          durationMs: Date.now() - this.__traceStartedAt,
        });
      });

      this.addEventListener('error', () => {
        sendRendererLog('xhr.error', {
          traceId: this.__traceId,
          method: this.__traceMethod,
          url: this.__traceUrl,
          readyState: this.readyState,
          status: this.status,
        });
      });

      this.addEventListener('timeout', () => {
        sendRendererLog('xhr.timeout', {
          traceId: this.__traceId,
          method: this.__traceMethod,
          url: this.__traceUrl,
          timeout: this.timeout,
          readyState: this.readyState,
        });
      });

      this.addEventListener('abort', () => {
        sendRendererLog('xhr.abort', {
          traceId: this.__traceId,
          method: this.__traceMethod,
          url: this.__traceUrl,
          readyState: this.readyState,
        });
      });
    }

    open(method, url, ...rest) {
      this.__traceMethod = String(method || 'GET').toUpperCase();
      this.__traceUrl = String(url || '');
      sendRendererLog('xhr.open', {
        traceId: this.__traceId,
        method: this.__traceMethod,
        url: this.__traceUrl,
      });
      return super.open(method, url, ...rest);
    }

    send(body) {
      this.__traceStartedAt = Date.now();
      sendRendererLog('xhr.send', {
        traceId: this.__traceId,
        method: this.__traceMethod,
        url: this.__traceUrl,
        body: summarizePayload(body),
      });
      return super.send(body);
    }
  }

  window.XMLHttpRequest = TracedXMLHttpRequest;
}

function getNetworkConnectionSnapshot() {
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (!connection) {
    return null;
  }

  return {
    type: connection.type || null,
    effectiveType: connection.effectiveType || null,
    downlink: typeof connection.downlink === 'number' ? connection.downlink : null,
    downlinkMax: typeof connection.downlinkMax === 'number' ? connection.downlinkMax : null,
    rtt: typeof connection.rtt === 'number' ? connection.rtt : null,
    saveData: typeof connection.saveData === 'boolean' ? connection.saveData : null,
  };
}

function installNetworkConnectionTrace(sendRendererLog) {
  sendRendererLog('network.status', {
    online: navigator.onLine,
    connection: getNetworkConnectionSnapshot(),
  });

  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (connection?.addEventListener) {
    connection.addEventListener('change', () => {
      sendRendererLog('network.connection.change', {
        online: navigator.onLine,
        connection: getNetworkConnectionSnapshot(),
      });
    });
  }
}

function bridgeMainWorldTelemetry() {
  if (mainWorldBridgeInjected || typeof contextBridge.executeInMainWorld !== 'function') {
    return;
  }

  mainWorldBridgeInjected = true;
  contextBridge.exposeInMainWorld(MAIN_WORLD_TRACE_HOOK, (event, payload) => {
    traceRendererEvent(event, payload);
  });

  contextBridge.executeInMainWorld({
    func: (hookName, fetchTimeoutMs, maxChars) => {
      const sendRendererLog = (event, payload = null) => {
        try {
          const hook = window[hookName];
          if (typeof hook === 'function') {
            hook(event, payload);
          }
        } catch {
          // Ignore bridge failures.
        }
      };

      const trimString = (value, maxLength = maxChars) => {
        if (typeof value !== 'string') {
          return value;
        }
        if (value.length <= maxLength) {
          return value;
        }
        return `${value.slice(0, maxLength)}...(truncated)`;
      };

      const summarizePayload = (value) => {
        if (value == null || typeof value === 'boolean' || typeof value === 'number') {
          return value;
        }
        if (typeof value === 'string') {
          return trimString(value, 1200);
        }
        if (Array.isArray(value)) {
          return {
            type: 'array',
            length: value.length,
          };
        }
        if (typeof value === 'object') {
          return {
            type: 'object',
            keys: Object.keys(value).slice(0, 20),
          };
        }
        return String(value);
      };

      if (typeof window.fetch === 'function' && !window.__lingzhiFetchTraced) {
        window.__lingzhiFetchTraced = true;
        const originalFetch = window.fetch.bind(window);
        window.fetch = async (...args) => {
          const traceId = `renderer-fetch-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
          const startedAt = Date.now();
          let url = '';
          let method = 'GET';
          try {
            url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || String(args[0]));
            method = String(args?.[1]?.method || 'GET').toUpperCase();
          } catch {
            url = '[unresolved-url]';
          }

          sendRendererLog('fetch.start', { traceId, method, url });

          const controller = new AbortController();
          const timeoutHandle = setTimeout(() => {
            controller.abort(new Error(`fetch-timeout-${fetchTimeoutMs}ms`));
          }, fetchTimeoutMs);

          const init = args[1] ? { ...args[1] } : {};
          if (!init.signal) {
            init.signal = controller.signal;
          }

          try {
            const response = await originalFetch(args[0], init);
            sendRendererLog('fetch.finish', {
              traceId,
              method,
              url,
              status: response.status,
              ok: response.ok,
              durationMs: Date.now() - startedAt,
            });
            return response;
          } catch (error) {
            sendRendererLog('fetch.error', {
              traceId,
              method,
              url,
              durationMs: Date.now() - startedAt,
              error: String(error),
            });
            throw error;
          } finally {
            clearTimeout(timeoutHandle);
          }
        };
      }

      if (typeof window.XMLHttpRequest === 'function' && !window.__lingzhiXhrTraced) {
        window.__lingzhiXhrTraced = true;
        const OriginalXhr = window.XMLHttpRequest;
        class TracedXMLHttpRequest extends OriginalXhr {
          constructor() {
            super();
            this.__traceId = `renderer-xhr-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
            this.__traceMethod = 'GET';
            this.__traceUrl = '';
            this.__traceStartedAt = null;

            this.addEventListener('loadend', () => {
              if (this.__traceStartedAt == null) {
                return;
              }
              sendRendererLog('xhr.finish', {
                traceId: this.__traceId,
                method: this.__traceMethod,
                url: this.__traceUrl,
                status: this.status,
                readyState: this.readyState,
                durationMs: Date.now() - this.__traceStartedAt,
              });
            });

            this.addEventListener('error', () => {
              sendRendererLog('xhr.error', {
                traceId: this.__traceId,
                method: this.__traceMethod,
                url: this.__traceUrl,
                readyState: this.readyState,
                status: this.status,
              });
            });

            this.addEventListener('timeout', () => {
              sendRendererLog('xhr.timeout', {
                traceId: this.__traceId,
                method: this.__traceMethod,
                url: this.__traceUrl,
                timeout: this.timeout,
                readyState: this.readyState,
              });
            });

            this.addEventListener('abort', () => {
              sendRendererLog('xhr.abort', {
                traceId: this.__traceId,
                method: this.__traceMethod,
                url: this.__traceUrl,
                readyState: this.readyState,
              });
            });
          }

          open(method, url, ...rest) {
            this.__traceMethod = String(method || 'GET').toUpperCase();
            this.__traceUrl = String(url || '');
            sendRendererLog('xhr.open', {
              traceId: this.__traceId,
              method: this.__traceMethod,
              url: this.__traceUrl,
            });
            return super.open(method, url, ...rest);
          }

          send(body) {
            this.__traceStartedAt = Date.now();
            sendRendererLog('xhr.send', {
              traceId: this.__traceId,
              method: this.__traceMethod,
              url: this.__traceUrl,
              body: summarizePayload(body),
            });
            return super.send(body);
          }
        }

        window.XMLHttpRequest = TracedXMLHttpRequest;
      }

      if (typeof window.WebSocket === 'function' && !window.__lingzhiWsTraced) {
        window.__lingzhiWsTraced = true;
        const OriginalWebSocket = window.WebSocket;
        class TracedWebSocket extends OriginalWebSocket {
          constructor(url, protocols) {
            super(url, protocols);
            this.__traceId = `renderer-ws-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
            this.__traceUrl = String(url);

            sendRendererLog('ws.create', { traceId: this.__traceId, url: this.__traceUrl });
            this.addEventListener('open', () => {
              sendRendererLog('ws.open', { traceId: this.__traceId, url: this.__traceUrl });
            });
            this.addEventListener('close', (event) => {
              sendRendererLog('ws.close', {
                traceId: this.__traceId,
                url: this.__traceUrl,
                code: event.code,
                reason: event.reason,
                wasClean: event.wasClean,
              });
            });
            this.addEventListener('error', () => {
              sendRendererLog('ws.error', { traceId: this.__traceId, url: this.__traceUrl });
            });
            this.addEventListener('message', (event) => {
              const dataText = typeof event.data === 'string' ? event.data : '[binary]';
              sendRendererLog('ws.message', {
                traceId: this.__traceId,
                url: this.__traceUrl,
                bytes: typeof dataText === 'string' ? dataText.length : null,
                dataPreview: typeof dataText === 'string' ? trimString(dataText, 1200) : dataText,
              });
            });
          }

          send(data) {
            const dataText = typeof data === 'string' ? data : '[binary]';
            sendRendererLog('ws.send', {
              traceId: this.__traceId,
              url: this.__traceUrl,
              bytes: typeof dataText === 'string' ? dataText.length : null,
              dataPreview: typeof dataText === 'string' ? trimString(dataText, 1200) : dataText,
            });
            return super.send(data);
          }
        }
        window.WebSocket = TracedWebSocket;
      }
    },
    args: [MAIN_WORLD_TRACE_HOOK, RENDERER_TRACE_FETCH_TIMEOUT_MS, RENDERER_TRACE_MAX_BODY_CHARS],
  });
}

function attachRendererTelemetry() {
  if (!RENDERER_TRACE_ENABLED) {
    return;
  }

  const sendRendererLog = (event, payload = null) => traceRendererEvent(event, payload);

  window.addEventListener('error', (errorEvent) => {
    sendRendererLog('window.error', {
      message: errorEvent.message,
      filename: errorEvent.filename,
      lineno: errorEvent.lineno,
      colno: errorEvent.colno,
      error: serializeError(errorEvent.error),
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    sendRendererLog('window.unhandledrejection', {
      reason: event.reason instanceof Error ? serializeError(event.reason) : String(event.reason),
    });
  });

  window.addEventListener('offline', () => {
    sendRendererLog('window.offline');
  });

  window.addEventListener('online', () => {
    sendRendererLog('window.online');
  });

  const originalConsoleError = console.error.bind(console);
  const originalConsoleWarn = console.warn.bind(console);

  console.error = (...args) => {
    sendRendererLog('console.error', {
      args: args.map((arg) => (arg instanceof Error ? serializeError(arg) : String(arg))),
    });
    originalConsoleError(...args);
  };

  console.warn = (...args) => {
    sendRendererLog('console.warn', {
      args: args.map((arg) => (arg instanceof Error ? serializeError(arg) : String(arg))),
    });
    originalConsoleWarn(...args);
  };

  installFetchTrace(sendRendererLog);
  installXhrTrace(sendRendererLog);
  installWebSocketTrace(sendRendererLog);
  installNetworkConnectionTrace(sendRendererLog);
  bridgeMainWorldTelemetry();
}

contextBridge.exposeInMainWorld('electronAPI', {
  getAppInfo: () => safeInvoke('app:getInfo'),

  selectDirectory: (options) => safeInvoke('dialog:selectDirectory', options),
  selectFile: (options) => safeInvoke('dialog:selectFile', options),

  showItemInFolder: (fullPath) => safeInvoke('shell:showItemInFolder', fullPath),
  openExternal: (url) => safeInvoke('shell:openExternal', url),
  openPath: (fullPath) => safeInvoke('shell:openPath', fullPath),

  getSystemInfo: () => safeInvoke('system:getInfo'),
  checkDependencies: () => safeInvoke('system:checkDependencies'),

  minimize: () => safeInvoke('window:minimize'),
  maximize: () => safeInvoke('window:maximize'),
  close: () => safeInvoke('window:close'),
  isMaximized: () => safeInvoke('window:isMaximized'),

  checkForUpdates: () => safeInvoke('updater:check'),
  installUpdate: () => safeInvoke('updater:install'),

  showNotification: (title, body) => safeInvoke('notification:show', title, body),

  writeClipboard: (text) => safeInvoke('clipboard:writeText', text),
  readClipboard: () => safeInvoke('clipboard:readText'),

  on: safeOn,
});

contextBridge.exposeInMainWorld('isElectron', true);
contextBridge.exposeInMainWorld('electronPlatform', process.platform);

attachRendererTelemetry();

function stampRuntimeDataAttributes() {
  const root = typeof document !== 'undefined' ? document.documentElement : null;
  if (!root) {
    return false;
  }

  root.dataset.electron = 'true';
  root.dataset.platform = process.platform;
  return true;
}

if (!stampRuntimeDataAttributes() && typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    stampRuntimeDataAttributes();
  }, { once: true });
}

