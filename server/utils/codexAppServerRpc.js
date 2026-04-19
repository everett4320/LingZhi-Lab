import { randomUUID } from 'crypto';

const JSONRPC_VERSION = '2.0';
const METHOD_NOT_FOUND_ERROR_CODE = -32601;
const INTERNAL_ERROR_CODE = -32603;
const REQUEST_TIMEOUT_ERROR_CODE = -32002;
const DEFAULT_REQUEST_TIMEOUT_MS = Number.parseInt(
  process.env.CODEX_APP_SERVER_RPC_TIMEOUT_MS || '',
  10,
) || 30_000;

function createTimeoutError(method, timeoutMs) {
  const error = new Error(`RPC timeout after ${timeoutMs}ms: ${method}`);
  error.code = REQUEST_TIMEOUT_ERROR_CODE;
  return error;
}

function normalizeRpcError(rawError, fallbackMessage = 'Unknown RPC error') {
  if (!rawError || typeof rawError !== 'object') {
    return { code: -32603, message: fallbackMessage, data: null };
  }

  const code = Number.isFinite(rawError.code) ? rawError.code : -32603;
  const message =
    typeof rawError.message === 'string' && rawError.message.trim()
      ? rawError.message
      : fallbackMessage;
  const data = Object.prototype.hasOwnProperty.call(rawError, 'data')
    ? rawError.data
    : null;

  return { code, message, data };
}

export function createJsonRpcMux({
  sendMessage,
  onNotification,
  onRequest,
  logger = console,
  defaultTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
} = {}) {
  if (typeof sendMessage !== 'function') {
    throw new Error('createJsonRpcMux requires sendMessage function');
  }

  const pendingRequests = new Map();
  let closed = false;

  const cleanupPending = (requestId) => {
    const pending = pendingRequests.get(requestId);
    if (!pending) return;
    pendingRequests.delete(requestId);
    if (pending.timeout) {
      clearTimeout(pending.timeout);
    }
  };

  const failAllPending = (error) => {
    for (const [requestId, pending] of pendingRequests.entries()) {
      cleanupPending(requestId);
      pending.reject(error);
    }
  };

  const request = (method, params = {}, options = {}) => {
    if (closed) {
      return Promise.reject(new Error('JSON-RPC mux is closed'));
    }

    const requestId = options.id || randomUUID();
    const timeoutMs = Number.isFinite(options.timeoutMs)
      ? options.timeoutMs
      : defaultTimeoutMs;

    return new Promise((resolve, reject) => {
      const timeout = timeoutMs > 0
        ? setTimeout(() => {
          cleanupPending(requestId);
          reject(createTimeoutError(method, timeoutMs));
        }, timeoutMs)
        : null;

      pendingRequests.set(requestId, {
        resolve,
        reject,
        timeout,
        method,
      });

      try {
        sendMessage({
          jsonrpc: JSONRPC_VERSION,
          id: requestId,
          method,
          params,
        });
      } catch (error) {
        cleanupPending(requestId);
        reject(error);
      }
    });
  };

  const notify = (method, params = undefined) => {
    if (closed) {
      return;
    }

    const message = {
      jsonrpc: JSONRPC_VERSION,
      method,
    };
    if (params !== undefined) {
      message.params = params;
    }

    sendMessage(message);
  };

  const sendResult = (requestId, result = {}) => {
    if (closed) return;
    sendMessage({
      jsonrpc: JSONRPC_VERSION,
      id: requestId,
      result,
    });
  };

  const sendError = (requestId, error = null) => {
    if (closed) return;
    sendMessage({
      jsonrpc: JSONRPC_VERSION,
      id: requestId,
      error: normalizeRpcError(error, 'RPC request failed'),
    });
  };

  const handleIncomingRequest = async (message) => {
    const requestId = message.id;
    const method = message.method;
    const params = message.params || {};

    if (typeof onRequest !== 'function') {
      sendError(requestId, {
        code: METHOD_NOT_FOUND_ERROR_CODE,
        message: `Method not found: ${method}`,
      });
      return;
    }

    let responded = false;
    const respond = (result = {}) => {
      if (responded) return;
      responded = true;
      sendResult(requestId, result);
    };
    const respondError = (error = null) => {
      if (responded) return;
      responded = true;
      sendError(requestId, error);
    };

    try {
      const result = await onRequest(method, params, {
        id: requestId,
        respond,
        respondError,
      });

      if (!responded) {
        respond(result ?? {});
      }
    } catch (error) {
      logger?.error?.('[CodexBridge][RPC] Request handler failed:', error);
      respondError({
        code: Number.isFinite(error?.code) ? error.code : INTERNAL_ERROR_CODE,
        message: error?.message || 'RPC request handler failed',
      });
    }
  };

  const handleIncoming = (message) => {
    if (closed || !message || typeof message !== 'object') {
      return;
    }

    const hasMethod = typeof message.method === 'string' && message.method.length > 0;
    const hasId = Object.prototype.hasOwnProperty.call(message, 'id');

    if (hasMethod && !hasId) {
      try {
        onNotification?.(message.method, message.params || {});
      } catch (error) {
        logger?.error?.('[CodexBridge][RPC] Notification handler failed:', error);
      }
      return;
    }

    if (hasMethod && hasId) {
      void handleIncomingRequest(message);
      return;
    }

    if (!hasId) {
      return;
    }

    const pending = pendingRequests.get(message.id);
    if (!pending) {
      return;
    }

    cleanupPending(message.id);

    if (Object.prototype.hasOwnProperty.call(message, 'error')) {
      pending.reject(normalizeRpcError(message.error));
      return;
    }

    pending.resolve(message.result);
  };

  const close = (reason = 'JSON-RPC mux closed') => {
    if (closed) return;
    closed = true;
    const error = new Error(reason);
    failAllPending(error);
  };

  return {
    request,
    notify,
    handleIncoming,
    close,
    isClosed: () => closed,
  };
}

export {
  DEFAULT_REQUEST_TIMEOUT_MS,
  METHOD_NOT_FOUND_ERROR_CODE,
  REQUEST_TIMEOUT_ERROR_CODE,
  normalizeRpcError,
};
