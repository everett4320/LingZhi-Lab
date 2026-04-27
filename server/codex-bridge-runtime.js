import { spawn } from 'child_process';

import { classifyError, classifySDKError } from '../shared/errorClassifier.js';
import { CODEX_MODELS } from '../shared/modelConstants.js';
import { encodeProjectPath } from './projects.js';
import { resolveAvailableCliCommand } from './utils/cliResolution.js';
import { createJsonRpcMux, normalizeRpcError } from './utils/codexAppServerRpc.js';
import { createCodexSessionStateStore } from './utils/codexSessionStateStore.js';
import { normalizeSessionMode } from './utils/sessionMode.js';
import { buildCodexRealtimeTokenBudget } from './utils/sessionTokenUsage.js';
import { buildLingzhiCodexRuntimeEnv, getLingzhiCodexHome } from './utils/codexHome.js';

const APP_SERVER_BOOT_TIMEOUT_MS =
  Number.parseInt(process.env.CODEX_APP_SERVER_BOOT_TIMEOUT_MS || '', 10) || 15000;
const APP_SERVER_STOP_TIMEOUT_MS =
  Number.parseInt(process.env.CODEX_APP_SERVER_STOP_TIMEOUT_MS || '', 10) || 5000;
const INTERRUPT_WAIT_TIMEOUT_MS =
  Number.parseInt(process.env.CODEX_APP_SERVER_INTERRUPT_TIMEOUT_MS || '', 10) || 20000;
const TURN_COMPLETION_WAIT_TIMEOUT_MS =
  Number.parseInt(process.env.CODEX_APP_SERVER_TURN_COMPLETION_TIMEOUT_MS || '', 10) || (30 * 60 * 1000);
const RESTART_BACKOFF_MS =
  Number.parseInt(process.env.CODEX_APP_SERVER_RESTART_BACKOFF_MS || '', 10) || 750;

const NOTIFICATION = {
  THREAD_STARTED: 'thread/started',
  THREAD_STATUS_CHANGED: 'thread/status/changed',
  TURN_STARTED: 'turn/started',
  TURN_COMPLETED: 'turn/completed',
  ITEM_STARTED: 'item/started',
  ITEM_COMPLETED: 'item/completed',
  AGENT_MESSAGE_DELTA: 'item/agentMessage/delta',
  REASONING_TEXT_DELTA: 'item/reasoning/textDelta',
  REASONING_SUMMARY_DELTA: 'item/reasoningSummary/textDelta',
  TURN_PLAN_UPDATED: 'turn/plan/updated',
  TOKEN_USAGE_UPDATED: 'thread/tokenUsage/updated',
  ERROR: 'error',
};

const SERVER_REQUEST = {
  COMMAND_EXECUTION_APPROVAL: 'item/commandExecution/requestApproval',
  FILE_CHANGE_APPROVAL: 'item/fileChange/requestApproval',
  TOOL_REQUEST_USER_INPUT: 'item/tool/requestUserInput',
  PERMISSIONS_REQUEST_APPROVAL: 'item/permissions/requestApproval',
  MCP_ELICITATION_REQUEST: 'mcpServer/elicitation/request',
  DYNAMIC_TOOL_CALL: 'item/tool/call',
  CHATGPT_AUTH_TOKENS_REFRESH: 'account/chatgptAuthTokens/refresh',
};

function nowMs() {
  return Date.now();
}

function toSessionKey(value) {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function normalizeCliCommand(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function mapPermissionModeToThreadSettings(permissionMode) {
  switch (permissionMode) {
    case 'acceptEdits':
      return { approvalPolicy: 'never', sandbox: 'workspace-write' };
    case 'bypassPermissions':
      return { approvalPolicy: 'never', sandbox: 'danger-full-access' };
    case 'plan':
    case 'default':
    default:
      return { approvalPolicy: 'untrusted', sandbox: 'workspace-write' };
  }
}

function buildInputItems(command, attachments = null) {
  const input = [];
  const text = String(command || '');
  if (text.trim()) {
    input.push({ type: 'text', text, text_elements: [] });
  }

  const imagePaths = Array.isArray(attachments?.imagePaths)
    ? attachments.imagePaths.filter((value) => typeof value === 'string' && value.trim())
    : [];
  for (const imagePath of imagePaths) {
    input.push({ type: 'localImage', path: imagePath });
  }

  const documentPaths = Array.isArray(attachments?.documentPaths)
    ? attachments.documentPaths.filter((value) => typeof value === 'string' && value.trim())
    : [];
  for (const documentPath of documentPaths) {
    input.push({
      type: 'text',
      text: `Attached workspace PDF path: ${documentPath}`,
      text_elements: [],
    });
  }

  return input;
}

function buildScope(projectName, sessionId) {
  if (!projectName || !sessionId) return null;
  return {
    projectName,
    provider: 'codex',
    sessionId,
  };
}

function mapThreadStatusToSessionState(status) {
  const statusType = status?.type || status;
  if (statusType === 'active') return 'running';
  if (statusType === 'idle') return 'completed';
  if (statusType === 'notLoaded') return 'idle';
  if (statusType === 'systemError') return 'failed';
  return null;
}

function mapTurnStatusToSessionState(status) {
  if (status === 'completed') return 'completed';
  if (status === 'interrupted') return 'aborted';
  if (status === 'failed') return 'failed';
  if (status === 'inProgress') return 'running';
  return 'completed';
}

function normalizeProviderError(rawError) {
  if (!rawError || typeof rawError !== 'object') {
    return {
      code: null,
      message: String(rawError || 'Unknown provider error'),
      data: null,
    };
  }

  const code = Number.isFinite(rawError.code)
    ? rawError.code
    : (typeof rawError.code === 'string' ? rawError.code : null);
  const message = typeof rawError.message === 'string' && rawError.message.trim()
    ? rawError.message
    : 'Provider error';
  const data = Object.prototype.hasOwnProperty.call(rawError, 'data')
    ? rawError.data
    : null;

  return { code, message, data };
}

function sanitizePermissionProfile(requestedPermissions) {
  const requested = requestedPermissions && typeof requestedPermissions === 'object'
    ? requestedPermissions
    : {};

  const requestedNetwork = requested.network && typeof requested.network === 'object'
    ? requested.network
    : null;
  const requestedFileSystem = requested.fileSystem && typeof requested.fileSystem === 'object'
    ? requested.fileSystem
    : null;

  const networkEnabled = requestedNetwork?.enabled === true ? true : null;

  const normalizePathList = (value) => {
    if (!Array.isArray(value)) return null;
    const list = value
      .filter((entry) => typeof entry === 'string' && entry.trim().length > 0)
      .map((entry) => entry.trim());
    return list.length > 0 ? list : null;
  };

  const readPaths = normalizePathList(requestedFileSystem?.read);
  const writePaths = normalizePathList(requestedFileSystem?.write);

  return {
    network: {
      enabled: networkEnabled,
    },
    fileSystem: {
      read: readPaths,
      write: writePaths,
    },
  };
}

function mapRpcErrorToTurnError(rpcError) {
  const normalized = normalizeProviderError(rpcError);
  const sdkClassified = typeof normalized.code === 'string' && normalized.code
    ? classifySDKError(normalized.code, 'codex')
    : classifyError(normalized.message || 'Provider request failed');

  return {
    message: normalized.message,
    errorType: sdkClassified.errorType || 'provider_error',
    isRetryable: Boolean(sdkClassified.isRetryable),
    details: {
      code: normalized.code,
      data: normalized.data,
    },
  };
}

function buildSteerCompareKey(item = null) {
  if (!item || typeof item !== 'object') {
    return null;
  }

  const textParts = [];
  let localImageCount = 0;
  let remoteImageCount = 0;
  let mentionCount = 0;
  let documentCount = 0;

  if (Array.isArray(item.content)) {
    for (const part of item.content) {
      if (!part || typeof part !== 'object') continue;
      const partType = String(part.type || '').trim();
      if (partType === 'text') {
        const text = typeof part.text === 'string' ? part.text.trim() : '';
        if (text) textParts.push(text);
      } else if (partType === 'local_image') {
        localImageCount += 1;
      } else if (partType === 'remote_image') {
        remoteImageCount += 1;
      } else if (partType === 'mention') {
        mentionCount += 1;
      } else if (partType === 'document') {
        documentCount += 1;
      }
    }
  }

  const rawText = textParts.join('\n').trim();
  if (!rawText && localImageCount === 0 && remoteImageCount === 0 && mentionCount === 0 && documentCount === 0) {
    return null;
  }

  return {
    text: rawText,
    textElements: [],
    localImagesCount: localImageCount,
    remoteImageUrlsCount: remoteImageCount,
    mentionBindingsCount: mentionCount,
    documentCount,
  };
}

function emit(writer, payload) {
  if (!writer || typeof writer.send !== 'function' || !payload) return;
  writer.send(payload);
}

function emitSessionStateChanged({ writer, scope, state, reason }) {
  if (!scope?.sessionId) return;
  emit(writer, {
    type: 'session-state-changed',
    provider: 'codex',
    sessionId: scope.sessionId,
    state,
    reason,
    changedAt: nowMs(),
    projectName: scope.projectName,
  });
}

function mapItemToChatTurnItem(item, { scope, clientTurnId, lifecycle }) {
  if (!item || !scope) return null;

  if (item.type === 'agentMessage') {
    // Agent text is streamed via `item/agentMessage/delta`.
    // Emitting again from item start/completed duplicates assistant content.
    return null;
  }

  if (item.type === 'commandExecution') {
    return {
      type: 'chat-turn-item',
      scope,
      clientTurnId,
      itemId: item.id,
      itemType: 'command_execution',
      lifecycle,
      title: 'command_execution',
      input: {
        command: item.command,
      },
      output: {
        output: item.aggregatedOutput || '',
        exitCode: Number.isFinite(item.exitCode) ? item.exitCode : undefined,
        status: item.status,
      },
      status: item.status,
      isError: item.status === 'failed' || item.status === 'declined',
    };
  }

  if (item.type === 'fileChange') {
    return {
      type: 'chat-turn-item',
      scope,
      clientTurnId,
      itemId: item.id,
      itemType: 'file_change',
      lifecycle,
      title: 'file_change',
      input: {
        changes: Array.isArray(item.changes) ? item.changes : [],
      },
      output: {
        status: item.status,
      },
      status: item.status,
      isError: item.status === 'failed' || item.status === 'declined',
    };
  }

  if (item.type === 'mcpToolCall') {
    return {
      type: 'chat-turn-item',
      scope,
      clientTurnId,
      itemId: item.id,
      itemType: 'mcp_tool_call',
      lifecycle,
      title: 'mcp_tool_call',
      input: {
        server: item.server,
        tool: item.tool,
        arguments: item.arguments,
      },
      output: item.error ? { error: item.error } : { result: item.result },
      status: item.status,
      isError: Boolean(item.error) || item.status === 'failed',
    };
  }

  if (item.type === 'webSearch') {
    return {
      type: 'chat-turn-item',
      scope,
      clientTurnId,
      itemId: item.id,
      itemType: 'web_search',
      lifecycle,
      title: 'web_search',
      input: {
        query: item.query,
      },
      output: item.action != null ? { action: item.action } : undefined,
      status: undefined,
      isError: false,
    };
  }

  return {
    type: 'chat-turn-item',
    scope,
    clientTurnId,
    itemId: item.id || `${scope.sessionId}-${nowMs()}`,
    itemType: item.type || 'item',
    lifecycle,
    title: item.type || 'item',
    input: null,
    output: item,
    status: undefined,
    isError: false,
  };
}

function toWriterItemPayload(itemPayload, sessionId, projectName) {
  if (!itemPayload || typeof itemPayload !== 'object') {
    return itemPayload;
  }

  return {
    ...itemPayload,
    sessionId,
    provider: 'codex',
    projectName,
  };
}

class CodexBridgeRuntime {
  constructor({
    spawnFn = spawn,
    rpcMuxFactory = createJsonRpcMux,
    cliResolver = resolveAvailableCliCommand,
    logger = console,
  } = {}) {
    this.spawnFn = spawnFn;
    this.rpcMuxFactory = rpcMuxFactory;
    this.cliResolver = cliResolver;
    this.logger = logger;

    this.child = null;
    this.rpc = null;
    this.closing = false;
    this.destroyed = false;
    this.restartTimer = null;
    this.lastBootPromise = null;
    this.currentCliCommand = null;

    this.sessions = new Map();
    this.sessionStore = createCodexSessionStateStore();
    this.interruptWaiters = new Map();
    this.turnCompletionWaiters = new Map();
    this.completedTurns = new Map();

    this.lineBuffer = '';
  }

  async initialize() {
    await this.ensureStarted();
    return true;
  }

  async ensureStarted() {
    if (this.destroyed) {
      throw new Error('Codex bridge runtime is shut down');
    }

    if (this.child && this.rpc && !this.closing) {
      return;
    }

    if (this.lastBootPromise) {
      return this.lastBootPromise;
    }

    this.lastBootPromise = this.startChildProcess();
    try {
      await this.lastBootPromise;
    } finally {
      this.lastBootPromise = null;
    }
  }

  async resolveCliCommand() {
    if (this.currentCliCommand) {
      return this.currentCliCommand;
    }

    const resolved = await this.cliResolver({
      envVarName: 'CODEX_CLI_PATH',
      defaultCommands: ['codex'],
      appendWindowsSuffixes: true,
      args: ['--version'],
    });

    const cliCommand = normalizeCliCommand(resolved || process.env.CODEX_CLI_PATH || 'codex');
    if (!cliCommand) {
      throw new Error('Codex CLI command unavailable');
    }

    this.currentCliCommand = cliCommand;
    return cliCommand;
  }

  async startChildProcess() {
    const cliCommand = await this.resolveCliCommand();

    this.closing = false;
    this.lineBuffer = '';
    const runtimeEnv = buildLingzhiCodexRuntimeEnv(process.env);
    const codexHome = getLingzhiCodexHome(runtimeEnv);

    const child = this.spawnFn(cliCommand, ['app-server', '--listen', 'stdio://'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: runtimeEnv,
      shell: process.platform === 'win32',
    });

    this.child = child;

    this.rpc = this.rpcMuxFactory({
      sendMessage: (message) => this.writeRpcMessage(message),
      onNotification: (method, params) => this.handleNotification(method, params),
      onRequest: (method, params) => this.handleServerRequest(method, params),
      logger: this.logger,
    });

    if (child.stdout && typeof child.stdout.on === 'function') {
      child.stdout.on('data', (chunk) => this.handleStdoutChunk(chunk));
    }

    if (child.stderr && typeof child.stderr.on === 'function') {
      child.stderr.on('data', (chunk) => {
        const text = String(chunk || '').trim();
        if (text) {
          this.logger?.warn?.(`[CodexBridge][stderr] ${text}`);
        }
      });
    }

    if (typeof child.on === 'function') {
      child.on('error', (error) => {
        this.logger?.error?.('[CodexBridge] app-server child error:', error);
        this.handleChildExit(error);
      });
      child.on('exit', (code, signal) => {
        this.logger?.warn?.(`[CodexBridge] app-server exited code=${code} signal=${signal}`);
        this.handleChildExit(new Error(`app-server exited code=${code} signal=${signal}`));
      });
    }

    await this.performInitializationHandshake();
    this.logger?.info?.(`[CodexBridge] app-server started with CODEX_HOME=${codexHome}`);
  }

  async handleServerRequest(method, params = {}) {
    switch (method) {
      case SERVER_REQUEST.COMMAND_EXECUTION_APPROVAL:
        return { decision: 'accept' };

      case SERVER_REQUEST.FILE_CHANGE_APPROVAL:
        return { decision: 'accept' };

      case SERVER_REQUEST.TOOL_REQUEST_USER_INPUT:
        return { answers: {} };

      case SERVER_REQUEST.PERMISSIONS_REQUEST_APPROVAL:
        return {
          permissions: sanitizePermissionProfile(params.permissions),
          scope: 'turn',
        };

      case SERVER_REQUEST.MCP_ELICITATION_REQUEST:
        return {
          action: 'decline',
          content: null,
          _meta: null,
        };

      case SERVER_REQUEST.DYNAMIC_TOOL_CALL:
        return {
          contentItems: [],
          success: false,
        };

      case SERVER_REQUEST.CHATGPT_AUTH_TOKENS_REFRESH:
        throw {
          code: -32603,
          message: 'account/chatgptAuthTokens/refresh is unsupported in codex-only bridge runtime',
        };

      default:
        this.logger?.warn?.(`[CodexBridge] Unsupported server request method: ${method}`);
        throw {
          code: -32601,
          message: `Method not found: ${method}`,
        };
    }
  }

  async performInitializationHandshake() {
    if (!this.rpc) {
      throw new Error('RPC unavailable during initialization');
    }

    const initPromise = this.rpc.request(
      'initialize',
      {
        clientInfo: {
          name: 'lingzhi-lab-server-bridge',
          title: 'Lingzhi Lab Server Bridge',
          version: process.env.npm_package_version || '0.0.0',
        },
      },
      { timeoutMs: APP_SERVER_BOOT_TIMEOUT_MS },
    );

    await initPromise;

    this.rpc.notify('initialized');
  }

  writeRpcMessage(message) {
    if (!this.child?.stdin || typeof this.child.stdin.write !== 'function') {
      throw new Error('app-server stdin unavailable');
    }

    const serialized = `${JSON.stringify(message)}\n`;
    this.child.stdin.write(serialized);
  }

  handleStdoutChunk(chunk) {
    const text = String(chunk || '');
    if (!text) return;

    this.lineBuffer += text;
    const lines = this.lineBuffer.split(/\r?\n/);
    this.lineBuffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let message;
      try {
        message = JSON.parse(trimmed);
      } catch {
        this.logger?.warn?.('[CodexBridge] Failed to parse app-server JSONL line:', trimmed);
        continue;
      }

      try {
        this.rpc?.handleIncoming?.(message);
      } catch (error) {
        this.logger?.error?.('[CodexBridge] Failed to process RPC message:', error);
      }
    }
  }

  handleChildExit(error) {
    const priorChild = this.child;
    this.child = null;

    if (this.rpc) {
      this.rpc.close('app-server process exited');
      this.rpc = null;
    }

    if (this.closing || this.destroyed) {
      return;
    }

    for (const waiter of this.interruptWaiters.values()) {
      waiter.reject(error || new Error('app-server process exited'));
      if (waiter.timer) clearTimeout(waiter.timer);
    }
    this.interruptWaiters.clear();

    for (const waiters of this.turnCompletionWaiters.values()) {
      for (const waiter of waiters) {
        if (waiter.timer) clearTimeout(waiter.timer);
        waiter.reject(error || new Error('app-server process exited'));
      }
    }
    this.turnCompletionWaiters.clear();
    this.completedTurns.clear();

    this.restartAfterCrash(priorChild != null);
  }

  restartAfterCrash(hadChild) {
    if (!hadChild || this.destroyed || this.closing) {
      return;
    }

    if (this.restartTimer) {
      return;
    }

    this.restartTimer = setTimeout(async () => {
      this.restartTimer = null;
      try {
        await this.ensureStarted();
      } catch (error) {
        this.logger?.error?.('[CodexBridge] Failed to restart app-server:', error);
      }
    }, RESTART_BACKOFF_MS);
  }

  getSessionRuntime(sessionId) {
    const key = toSessionKey(sessionId);
    if (!key) return null;
    return this.sessions.get(key) || null;
  }

  ensureSessionRuntime(sessionId, seed = {}) {
    const key = toSessionKey(sessionId);
    if (!key) return null;

    let runtime = this.sessions.get(key);
    if (!runtime) {
        runtime = {
          sessionId: key,
          provisionalSessionId: toSessionKey(seed.provisionalSessionId) || null,
          projectName: seed.projectName || null,
          projectPath: seed.projectPath || null,
          writer: seed.writer || null,
          clientTurnId: seed.clientTurnId || null,
          startTime: Number.isFinite(seed.startTime) ? seed.startTime : nowMs(),
          lastTurnId: toSessionKey(seed.turnId) || null,
          lastTokenUsage: null,
        };
      this.sessions.set(key, runtime);
    } else {
      if (seed.projectName) runtime.projectName = seed.projectName;
      if (seed.projectPath) runtime.projectPath = seed.projectPath;
      if (seed.writer) runtime.writer = seed.writer;
      if (seed.clientTurnId) runtime.clientTurnId = seed.clientTurnId;
      if (Number.isFinite(seed.startTime) && !runtime.startTime) runtime.startTime = seed.startTime;
      if (seed.turnId) runtime.lastTurnId = toSessionKey(seed.turnId);
    }

    this.sessionStore.ensureSession(key, {
      provisionalSessionId: runtime.provisionalSessionId,
      threadId: key,
      actualSessionId: key,
      startTime: runtime.startTime,
    });

    return runtime;
  }

  moveSessionRuntime(previousSessionId, actualSessionId) {
    const previousKey = toSessionKey(previousSessionId);
    const actualKey = toSessionKey(actualSessionId);

    if (!actualKey || !previousKey || previousKey === actualKey) {
      return;
    }

    const runtime = this.sessions.get(previousKey);
    if (!runtime) return;

    runtime.sessionId = actualKey;
    runtime.provisionalSessionId = previousKey;
    this.sessions.set(actualKey, runtime);
    this.sessions.delete(previousKey);
  }

  emitSessionCreated({ sessionId, provisionalSessionId = null, sessionMode = 'research', writerOverride = null }) {
    const runtime = this.ensureSessionRuntime(sessionId);
    if (!runtime) return;

    const writer = writerOverride || runtime.writer;
    if (writer && typeof writer.setSessionId === 'function') {
      writer.setSessionId(runtime.sessionId);
    }
    const scope = buildScope(runtime.projectName, runtime.sessionId);
    if (!scope) return;

    emit(writer, {
      type: 'chat-session-created',
      scope,
      provisionalSessionId: provisionalSessionId || runtime.provisionalSessionId || undefined,
      sessionId: runtime.sessionId,
      provider: 'codex',
      projectName: runtime.projectName,
      displayName: null,
      mode: normalizeSessionMode(sessionMode),
      createdAt: nowMs(),
      model: null,
    });
  }

  emitTurnAccepted({ sessionId, clientTurnId = null, turnId = null }) {
    const runtime = this.getSessionRuntime(sessionId);
    if (!runtime) return;

    const scope = buildScope(runtime.projectName, runtime.sessionId);
    if (!scope) return;

    emit(runtime.writer, {
      type: 'chat-turn-accepted',
      scope,
      sessionId: runtime.sessionId,
      provider: 'codex',
      projectName: runtime.projectName,
      clientTurnId: clientTurnId || runtime.clientTurnId || runtime.sessionId,
      turnId: toSessionKey(turnId) || runtime.lastTurnId || null,
      provisionalSessionId: runtime.provisionalSessionId || undefined,
      queued: false,
    });
  }

  emitTurnError({ sessionId, clientTurnId = null, errorInfo }) {
    const runtime = this.getSessionRuntime(sessionId);
    if (!runtime) return;

    const scope = buildScope(runtime.projectName, runtime.sessionId);
    if (!scope) return;

    emit(runtime.writer, {
      type: 'chat-turn-error',
      scope,
      sessionId: runtime.sessionId,
      provider: 'codex',
      projectName: runtime.projectName,
      clientTurnId: clientTurnId || runtime.clientTurnId || runtime.sessionId,
      error: errorInfo?.message || 'Turn failed',
      errorType: errorInfo?.errorType || 'provider_error',
      isRetryable: Boolean(errorInfo?.isRetryable),
      details: errorInfo?.details || null,
    });
  }

  emitTurnComplete({ sessionId, clientTurnId = null, usage = null }) {
    const runtime = this.getSessionRuntime(sessionId);
    if (!runtime) return;

    const scope = buildScope(runtime.projectName, runtime.sessionId);
    if (!scope) return;

    emit(runtime.writer, {
      type: 'chat-turn-complete',
      scope,
      sessionId: runtime.sessionId,
      provider: 'codex',
      projectName: runtime.projectName,
      clientTurnId: clientTurnId || runtime.clientTurnId || runtime.sessionId,
      usage: usage || undefined,
      actualSessionId: runtime.sessionId,
    });
  }

  emitTurnAborted({ sessionId, clientTurnId = null, success = true }) {
    const runtime = this.getSessionRuntime(sessionId);
    if (!runtime) return;

    const scope = buildScope(runtime.projectName, runtime.sessionId);
    if (!scope) return;

    emit(runtime.writer, {
      type: 'chat-turn-aborted',
      provider: 'codex',
      projectName: runtime.projectName,
      sessionId: runtime.sessionId,
      scope,
      clientTurnId: clientTurnId || runtime.clientTurnId || runtime.sessionId,
      success,
    });
  }

  rebindSessionWriter(sessionId, writer) {
    const key = toSessionKey(sessionId);
    if (!key || !writer) return false;

    const runtime = this.getSessionRuntime(key);
    if (!runtime) return false;

    runtime.writer = writer;
    return true;
  }

  getSessionStatus(sessionId) {
    const key = toSessionKey(sessionId);
    if (!key) {
      return {
        sessionId,
        provider: 'codex',
        isProcessing: false,
        startTime: null,
      };
    }

    const snapshot = this.sessionStore.getStateSnapshot({ sessionId: key });
    if (!snapshot) {
      return {
        sessionId: key,
        provider: 'codex',
        isProcessing: false,
        startTime: null,
      };
    }

    return {
      sessionId: snapshot.sessionId,
      provider: 'codex',
      isProcessing: snapshot.isProcessing,
      startTime: snapshot.startTime,
      status: snapshot.status,
      activeTurnId: snapshot.activeTurnId,
      threadId: snapshot.threadId,
    };
  }

  isSessionActive(sessionId) {
    return Boolean(this.getSessionStatus(sessionId)?.isProcessing);
  }

  getSessionStartTime(sessionId) {
    const status = this.getSessionStatus(sessionId);
    return Number.isFinite(status?.startTime) ? status.startTime : null;
  }

  listActiveSessions() {
    return this.sessionStore.listActiveSessions();
  }

  resolveSessionFromNotification(params = {}) {
    const directSessionId = toSessionKey(params.sessionId);
    const threadId = toSessionKey(params.threadId || params.thread?.id);
    const provisionalSessionId = toSessionKey(params.provisionalSessionId);

    const resolved = this.sessionStore.resolveSessionId({
      sessionId: directSessionId,
      threadId,
      provisionalSessionId,
    });

    if (resolved) return resolved;
    return threadId || directSessionId || provisionalSessionId || null;
  }

  handleNotification(method, params = {}) {
    const resolvedSessionId = this.resolveSessionFromNotification(params);

    switch (method) {
      case NOTIFICATION.THREAD_STARTED: {
        const threadId = toSessionKey(params.thread?.id || params.threadId);
        const targetSessionId = toSessionKey(resolvedSessionId || threadId);
        if (!targetSessionId) return;

        let runtime = this.getSessionRuntime(targetSessionId);
        if (!runtime && threadId && resolvedSessionId && resolvedSessionId !== threadId) {
          this.moveSessionRuntime(resolvedSessionId, threadId);
          runtime = this.getSessionRuntime(threadId);
        }
        if (!runtime) {
          runtime = this.ensureSessionRuntime(targetSessionId, {
            projectName: params.projectName || null,
            startTime: nowMs(),
          });
        }

        const previousSessionId = runtime.provisionalSessionId || null;
        const sessionIdForStore = runtime.sessionId;
        const actualThreadId = threadId || sessionIdForStore;

        this.sessionStore.ensureSession(sessionIdForStore, {
          provisionalSessionId: previousSessionId,
          threadId: actualThreadId,
          actualSessionId: actualThreadId,
          startTime: runtime.startTime,
        });
        this.sessionStore.bindThread(sessionIdForStore, actualThreadId);

        if (previousSessionId && previousSessionId !== actualThreadId) {
          this.sessionStore.rebindSessionId({
            provisionalSessionId: previousSessionId,
            actualSessionId: actualThreadId,
            threadId: actualThreadId,
          });
          this.moveSessionRuntime(previousSessionId, actualThreadId);
          runtime = this.getSessionRuntime(actualThreadId) || runtime;
        }

        runtime.sessionId = actualThreadId;
        runtime.startTime = runtime.startTime || nowMs();

        this.emitSessionCreated({
          sessionId: runtime.sessionId,
          provisionalSessionId: previousSessionId,
          sessionMode: normalizeSessionMode(params.mode || params.sessionMode || 'research'),
        });

        emitSessionStateChanged({
          writer: runtime.writer,
          scope: buildScope(runtime.projectName, runtime.sessionId),
          state: 'running',
          reason: method,
        });
        this.sessionStore.setStatus({ sessionId: runtime.sessionId, status: 'running' });
        break;
      }

      case NOTIFICATION.THREAD_STATUS_CHANGED: {
        const sessionId = toSessionKey(resolvedSessionId);
        if (!sessionId) return;

        const runtime = this.getSessionRuntime(sessionId);
        if (!runtime) return;

        const mappedState = mapThreadStatusToSessionState(params.status);
        if (mappedState) {
          this.sessionStore.setStatus({ sessionId, status: mappedState });
          emitSessionStateChanged({
            writer: runtime.writer,
            scope: buildScope(runtime.projectName, runtime.sessionId),
            state: mappedState,
            reason: method,
          });
        }
        break;
      }

      case NOTIFICATION.TURN_STARTED: {
        const sessionId = toSessionKey(resolvedSessionId);
        const turnId = toSessionKey(params.turn?.id || params.turnId);
        if (!sessionId || !turnId) return;

        const runtime = this.getSessionRuntime(sessionId);
        if (!runtime) return;

        runtime.lastTurnId = turnId;
        this.sessionStore.setActiveTurn({ sessionId, threadId: sessionId, turnId, clientTurnId: runtime.clientTurnId });
        this.sessionStore.setStatus({ sessionId, status: 'running' });

        this.emitTurnAccepted({ sessionId, clientTurnId: runtime.clientTurnId, turnId });
        emitSessionStateChanged({
          writer: runtime.writer,
          scope: buildScope(runtime.projectName, runtime.sessionId),
          state: 'running',
          reason: method,
        });
        break;
      }

      case NOTIFICATION.AGENT_MESSAGE_DELTA: {
        const sessionId = toSessionKey(resolvedSessionId);
        if (!sessionId) return;

        const runtime = this.getSessionRuntime(sessionId);
        if (!runtime) return;

        const scope = buildScope(runtime.projectName, runtime.sessionId);
        if (!scope) return;

        const delta = String(params.delta || '');
        if (!delta.trim()) return;

        emit(runtime.writer, {
          type: 'chat-turn-delta',
          scope,
          sessionId: runtime.sessionId,
          provider: 'codex',
          projectName: runtime.projectName,
          clientTurnId: runtime.clientTurnId || runtime.sessionId,
          messageId: params.itemId || `${runtime.sessionId}-${nowMs()}`,
          role: 'assistant',
          partKind: 'text',
          textDelta: delta,
        });
        break;
      }

      case NOTIFICATION.REASONING_TEXT_DELTA:
      case NOTIFICATION.REASONING_SUMMARY_DELTA: {
        const sessionId = toSessionKey(resolvedSessionId);
        if (!sessionId) return;

        const runtime = this.getSessionRuntime(sessionId);
        if (!runtime) return;

        const scope = buildScope(runtime.projectName, runtime.sessionId);
        if (!scope) return;

        const delta = String(params.delta || '');
        if (!delta.trim()) return;

        emit(runtime.writer, {
          type: 'chat-turn-delta',
          scope,
          sessionId: runtime.sessionId,
          provider: 'codex',
          projectName: runtime.projectName,
          clientTurnId: runtime.clientTurnId || runtime.sessionId,
          messageId: params.itemId || `${runtime.sessionId}-reasoning-${nowMs()}`,
          role: 'assistant',
          partKind: 'thinking',
          textDelta: delta,
        });
        break;
      }

      case NOTIFICATION.ITEM_STARTED:
      case NOTIFICATION.ITEM_COMPLETED: {
        const sessionId = toSessionKey(resolvedSessionId);
        if (!sessionId) return;

        const runtime = this.getSessionRuntime(sessionId);
        if (!runtime) return;

        const scope = buildScope(runtime.projectName, runtime.sessionId);
        if (!scope) return;

        const lifecycle = method === NOTIFICATION.ITEM_STARTED ? 'started' : 'completed';
        const mappedItem = mapItemToChatTurnItem(params.item, {
          scope,
          clientTurnId: runtime.clientTurnId || runtime.sessionId,
          lifecycle,
        });
        if (!mappedItem) return;

        emit(runtime.writer, toWriterItemPayload(mappedItem, runtime.sessionId, runtime.projectName));

        if (method === NOTIFICATION.ITEM_COMPLETED && params?.item?.type === 'userMessage') {
          const compareKey = buildSteerCompareKey(params.item);
          emit(runtime.writer, {
            type: 'chat-turn-user-message-committed',
            sessionId: runtime.sessionId,
            provider: 'codex',
            projectName: runtime.projectName,
            turnId: toSessionKey(params.turnId || params?.item?.turnId || runtime.lastTurnId),
            compareKey,
          });
        }
        break;
      }

      case NOTIFICATION.TURN_PLAN_UPDATED: {
        const sessionId = toSessionKey(resolvedSessionId);
        if (!sessionId) return;

        const runtime = this.getSessionRuntime(sessionId);
        if (!runtime) return;

        const scope = buildScope(runtime.projectName, runtime.sessionId);
        if (!scope) return;

        emit(runtime.writer, toWriterItemPayload({
          type: 'chat-turn-item',
          scope,
          clientTurnId: runtime.clientTurnId || runtime.sessionId,
          itemId: `plan-${nowMs()}`,
          itemType: 'plan',
          lifecycle: 'updated',
          title: 'plan',
          input: null,
          output: params,
          status: undefined,
          isError: false,
        }, runtime.sessionId, runtime.projectName));
        break;
      }

      case NOTIFICATION.TOKEN_USAGE_UPDATED: {
        const sessionId = toSessionKey(resolvedSessionId);
        if (!sessionId) return;

        const runtime = this.getSessionRuntime(sessionId);
        if (!runtime) return;

        runtime.lastTokenUsage = params.tokenUsage?.last || null;

        const modelContextWindow = Number.isFinite(params.tokenUsage?.modelContextWindow)
          ? params.tokenUsage.modelContextWindow
          : 200000;

        const budget = buildCodexRealtimeTokenBudget({
          current_context_usage: {
            total_tokens: params.tokenUsage?.total?.totalTokens,
          },
        }, modelContextWindow);

        emit(runtime.writer, {
          type: 'token-budget',
          data: budget,
          sessionId: runtime.sessionId,
          provider: 'codex',
        });
        break;
      }

      case NOTIFICATION.TURN_COMPLETED: {
        const sessionId = toSessionKey(resolvedSessionId);
        if (!sessionId) return;

        const runtime = this.getSessionRuntime(sessionId);
        if (!runtime) return;

        const turnStatus = params.turn?.status;
        const mappedState = mapTurnStatusToSessionState(turnStatus);

        this.sessionStore.clearActiveTurn({ sessionId, threadId: sessionId });
        this.sessionStore.setStatus({ sessionId, status: mappedState || 'completed' });

        if (turnStatus === 'failed') {
          const failed = params.turn?.error || params.error || { message: 'Turn failed' };
          const errorInfo = mapRpcErrorToTurnError(failed);
          this.emitTurnError({ sessionId, errorInfo });
          runtime.lastTokenUsage = null;
        } else if (turnStatus === 'interrupted') {
          this.emitTurnAborted({ sessionId, success: true });
          runtime.lastTokenUsage = null;
        } else {
          const usage = runtime.lastTokenUsage
            ? {
              inputTokens: runtime.lastTokenUsage.inputTokens,
              outputTokens: runtime.lastTokenUsage.outputTokens,
              cachedInputTokens: runtime.lastTokenUsage.cachedInputTokens,
              totalTokens: runtime.lastTokenUsage.totalTokens,
              reasoningOutputTokens: runtime.lastTokenUsage.reasoningOutputTokens,
            }
            : null;
          this.emitTurnComplete({ sessionId, usage });
          runtime.lastTokenUsage = null;
        }

        emitSessionStateChanged({
          writer: runtime.writer,
          scope: buildScope(runtime.projectName, runtime.sessionId),
          state: mappedState || 'completed',
          reason: method,
        });

        this.settleTurnCompletionWaiters(sessionId, params.turn);
        this.resolveInterruptWaiter(sessionId, turnStatus);
        break;
      }

      case NOTIFICATION.ERROR: {
        const sessionId = toSessionKey(resolvedSessionId);
        if (!sessionId) return;

        const runtime = this.getSessionRuntime(sessionId);
        if (!runtime) return;

        const errorInfo = mapRpcErrorToTurnError(params.error || params);
        this.emitTurnError({ sessionId, errorInfo });
        this.sessionStore.setStatus({ sessionId, status: 'failed' });
        emitSessionStateChanged({
          writer: runtime.writer,
          scope: buildScope(runtime.projectName, runtime.sessionId),
          state: 'failed',
          reason: method,
        });
        break;
      }

      default:
        break;
    }
  }

  resolveInterruptWaiter(sessionId, turnStatus) {
    const waiter = this.interruptWaiters.get(sessionId);
    if (!waiter) return;

    if (turnStatus === 'interrupted') {
      if (waiter.timer) clearTimeout(waiter.timer);
      this.interruptWaiters.delete(sessionId);
      waiter.resolve({ ok: true, status: 200, interrupted: true });
      return;
    }

    if (turnStatus === 'completed' || turnStatus === 'failed') {
      if (waiter.timer) clearTimeout(waiter.timer);
      this.interruptWaiters.delete(sessionId);
      waiter.resolve({
        ok: false,
        status: 409,
        interrupted: false,
        error: `Turn settled with status=${turnStatus} before interrupted convergence`,
      });
    }
  }

  getTurnCompletionWaiterKey(sessionId, turnId) {
    const normalizedSessionId = toSessionKey(sessionId);
    const normalizedTurnId = toSessionKey(turnId);
    if (!normalizedSessionId || !normalizedTurnId) return null;
    return `${normalizedSessionId}:${normalizedTurnId}`;
  }

  settleTurnCompletionWaiters(sessionId, turn = null) {
    const key = this.getTurnCompletionWaiterKey(sessionId, turn?.id);
    if (!key) return;

    const payload = {
      sessionId: toSessionKey(sessionId),
      turnId: toSessionKey(turn?.id),
      status: toSessionKey(turn?.status),
      turn,
    };
    this.completedTurns.set(key, payload);

    const waiters = this.turnCompletionWaiters.get(key);
    if (!Array.isArray(waiters) || waiters.length === 0) {
      return;
    }

    this.turnCompletionWaiters.delete(key);
    for (const waiter of waiters) {
      if (waiter.timer) clearTimeout(waiter.timer);
      waiter.resolve(payload);
    }
  }

  waitForTurnCompletion(sessionId, turnId, timeoutMs = TURN_COMPLETION_WAIT_TIMEOUT_MS) {
    const key = this.getTurnCompletionWaiterKey(sessionId, turnId);
    if (!key) {
      return Promise.reject(new Error('sessionId and turnId are required to wait for turn completion'));
    }

    const completed = this.completedTurns.get(key);
    if (completed) {
      this.completedTurns.delete(key);
      return Promise.resolve(completed);
    }

    return new Promise((resolve, reject) => {
      const waiters = this.turnCompletionWaiters.get(key) || [];
      const waiter = {
        timer: null,
        resolve: (value) => resolve(value),
        reject: (error) => reject(error),
      };

      if (timeoutMs > 0) {
        waiter.timer = setTimeout(() => {
          const current = this.turnCompletionWaiters.get(key) || [];
          const remaining = current.filter((entry) => entry !== waiter);
          if (remaining.length > 0) {
            this.turnCompletionWaiters.set(key, remaining);
          } else {
            this.turnCompletionWaiters.delete(key);
          }
          reject(new Error(`Timed out waiting for turn/completed for session=${sessionId} turn=${turnId}`));
        }, timeoutMs);
      }

      waiters.push(waiter);
      this.turnCompletionWaiters.set(key, waiters);
    });
  }

  async query(command, options = {}, writer) {
    await this.ensureStarted();

    const projectPath = options.projectPath || options.cwd || process.cwd();
    const projectName = options.projectName || encodeProjectPath(projectPath);
    const sessionMode = normalizeSessionMode(options.sessionMode || 'research');
    const model = options.model || CODEX_MODELS.DEFAULT;
    const clientTurnId = toSessionKey(options.clientTurnId) || null;
    const providedSessionId = toSessionKey(options.sessionId || options.resumeSessionId);
    const provisionalSessionId = toSessionKey(options.provisionalSessionId)
      || (providedSessionId && providedSessionId.startsWith('new-session-') ? providedSessionId : null)
      || (!providedSessionId ? `new-session-${nowMs()}` : null);

    const effectiveSessionId = providedSessionId || provisionalSessionId;
    if (!effectiveSessionId) {
      throw new Error('Unable to resolve bridge session id');
    }

    const runtime = this.ensureSessionRuntime(effectiveSessionId, {
      provisionalSessionId,
      projectName,
      projectPath,
      writer,
      clientTurnId,
      startTime: nowMs(),
    });

    if (!runtime) {
      throw new Error('Unable to initialize bridge session runtime');
    }

    runtime.writer = writer || runtime.writer;
    runtime.clientTurnId = clientTurnId || runtime.clientTurnId;

    this.emitSessionCreated({
      sessionId: runtime.sessionId,
      provisionalSessionId: runtime.provisionalSessionId,
      sessionMode,
      writerOverride: runtime.writer,
    });

    const { approvalPolicy, sandbox } = mapPermissionModeToThreadSettings(options.permissionMode || 'default');
    const sandboxPolicy = sandbox === 'danger-full-access'
      ? { type: 'dangerFullAccess' }
      : {
        type: 'workspaceWrite',
        writableRoots: [projectPath],
        readOnlyAccess: {},
        networkAccess: false,
        excludeTmpdirEnvVar: false,
        excludeSlashTmp: false,
      };

    try {
      let threadId = toSessionKey(runtime.sessionId);

      if (providedSessionId) {
        const resumeResult = await this.rpc.request('thread/resume', { threadId: providedSessionId });
        threadId = toSessionKey(resumeResult?.thread?.id || providedSessionId);
      } else {
        const threadStartResult = await this.rpc.request('thread/start', {
          model,
          cwd: projectPath,
          approvalPolicy,
          sandbox,
        });
        threadId = toSessionKey(threadStartResult?.thread?.id || runtime.sessionId);
      }

      if (!threadId) {
        throw new Error('thread/start|resume did not return thread id');
      }

      if (runtime.sessionId !== threadId) {
        this.sessionStore.rebindSessionId({
          provisionalSessionId: runtime.sessionId,
          actualSessionId: threadId,
          threadId,
        });
        this.moveSessionRuntime(runtime.sessionId, threadId);
      }

      const reboundRuntime = this.getSessionRuntime(threadId) || runtime;
      reboundRuntime.sessionId = threadId;
      reboundRuntime.projectName = projectName;
      reboundRuntime.projectPath = projectPath;
      reboundRuntime.writer = writer || reboundRuntime.writer;
      if (reboundRuntime.writer && typeof reboundRuntime.writer.setSessionId === 'function') {
        reboundRuntime.writer.setSessionId(reboundRuntime.sessionId);
      }
      reboundRuntime.clientTurnId = clientTurnId || reboundRuntime.clientTurnId;
      reboundRuntime.startTime = reboundRuntime.startTime || nowMs();
      reboundRuntime.provisionalSessionId = runtime.provisionalSessionId;

      this.sessionStore.ensureSession(threadId, {
        provisionalSessionId: reboundRuntime.provisionalSessionId,
        threadId,
        actualSessionId: threadId,
        startTime: reboundRuntime.startTime,
      });
      this.sessionStore.bindThread(threadId, threadId);
      this.sessionStore.setStatus({ sessionId: threadId, status: 'running' });

      if (reboundRuntime.provisionalSessionId && reboundRuntime.provisionalSessionId !== threadId) {
        this.emitSessionCreated({
          sessionId: threadId,
          provisionalSessionId: reboundRuntime.provisionalSessionId,
          sessionMode,
          writerOverride: reboundRuntime.writer,
        });
      }

      emitSessionStateChanged({
        writer: reboundRuntime.writer,
        scope: buildScope(reboundRuntime.projectName, threadId),
        state: 'running',
        reason: 'query-started',
      });

      const turnStartResult = await this.rpc.request('turn/start', {
        threadId,
        input: buildInputItems(command, options.attachments),
        model,
        cwd: projectPath,
        approvalPolicy,
        sandboxPolicy,
      });

      const turnId = toSessionKey(turnStartResult?.turn?.id);
      if (!turnId) {
        throw new Error('turn/start did not return turn id');
      }

      reboundRuntime.lastTurnId = turnId;
      this.sessionStore.setActiveTurn({
        sessionId: threadId,
        threadId,
        turnId,
        clientTurnId: reboundRuntime.clientTurnId,
      });

      this.emitTurnAccepted({
        sessionId: threadId,
        clientTurnId: reboundRuntime.clientTurnId,
        turnId,
      });

      const completion = await this.waitForTurnCompletion(threadId, turnId);
      if (completion.status === 'completed') {
        return {
          ok: true,
          status: 200,
          sessionId: threadId,
          provisionalSessionId: reboundRuntime.provisionalSessionId,
          turnId,
        };
      }

      if (completion.status === 'interrupted') {
        return {
          ok: false,
          status: 409,
          sessionId: threadId,
          provisionalSessionId: reboundRuntime.provisionalSessionId,
          turnId,
          interrupted: true,
          error: 'Turn interrupted',
        };
      }

      if (completion.status === 'failed') {
        const failed = completion.turn?.error || { message: 'Turn failed' };
        const mappedFailure = mapRpcErrorToTurnError(failed);
        return {
          ok: false,
          status: 500,
          sessionId: threadId,
          provisionalSessionId: reboundRuntime.provisionalSessionId,
          turnId,
          error: mappedFailure.message,
          errorType: mappedFailure.errorType,
          isRetryable: mappedFailure.isRetryable,
          details: mappedFailure.details,
        };
      }

      return {
        ok: false,
        status: 500,
        sessionId: threadId,
        provisionalSessionId: reboundRuntime.provisionalSessionId,
        turnId,
        error: `Unknown turn completion status: ${completion.status || 'unknown'}`,
      };
    } catch (error) {
      const mappedError = mapRpcErrorToTurnError(error);
      const activeSessionId = this.sessionStore.resolveSessionId({
        sessionId: runtime.sessionId,
        provisionalSessionId: runtime.provisionalSessionId,
      }) || runtime.sessionId;

      this.sessionStore.setStatus({ sessionId: activeSessionId, status: 'failed' });
      this.emitTurnError({
        sessionId: activeSessionId,
        clientTurnId: runtime.clientTurnId,
        errorInfo: mappedError,
      });

      const activeRuntime = this.getSessionRuntime(activeSessionId);
      if (activeRuntime) {
        emitSessionStateChanged({
          writer: activeRuntime.writer,
          scope: buildScope(activeRuntime.projectName, activeRuntime.sessionId),
          state: 'failed',
          reason: 'query-error',
        });
      }

      return {
        ok: false,
        status: 500,
        sessionId: activeSessionId,
        error: mappedError.message,
        errorType: mappedError.errorType,
        isRetryable: mappedError.isRetryable,
        details: mappedError.details,
      };
    }
  }

  async steer({
    sessionId,
    command,
    expectedTurnId,
    clientTurnId = null,
  } = {}) {
    await this.ensureStarted();

    const normalizedSessionId = toSessionKey(sessionId);
    if (!normalizedSessionId) {
      return {
        ok: false,
        status: 400,
        error: 'sessionId is required for steer',
      };
    }

    const runtime = this.getSessionRuntime(normalizedSessionId);
    if (!runtime) {
      return {
        ok: false,
        status: 404,
        error: 'Unknown codex bridge session',
      };
    }

    const expected = toSessionKey(expectedTurnId);
    if (!expected) {
      return {
        ok: false,
        status: 409,
        error: 'expectedTurnId is required for steer',
      };
    }

    const activeTurnId = this.sessionStore.getActiveTurnId({ sessionId: normalizedSessionId, threadId: normalizedSessionId });
    if (!activeTurnId) {
      return {
        ok: false,
        status: 409,
        error: 'No active turn available for steer',
        details: {
          sessionId: normalizedSessionId,
          expectedTurnId: expected,
          activeTurnId: null,
        },
      };
    }

    if (activeTurnId !== expected) {
      return {
        ok: false,
        status: 409,
        error: 'expectedTurnId does not match active turn',
        details: {
          sessionId: normalizedSessionId,
          expectedTurnId: expected,
          activeTurnId,
        },
      };
    }

    runtime.clientTurnId = toSessionKey(clientTurnId) || runtime.clientTurnId;
    try {
      const steerResult = await this.rpc.request('turn/steer', {
        threadId: normalizedSessionId,
        input: buildInputItems(command),
        expectedTurnId: expected,
      });

      const resultTurnId = toSessionKey(steerResult?.turnId) || expected;
      this.sessionStore.setActiveTurn({
        sessionId: normalizedSessionId,
        threadId: normalizedSessionId,
        turnId: resultTurnId,
        clientTurnId: runtime.clientTurnId,
      });
      this.sessionStore.setStatus({ sessionId: normalizedSessionId, status: 'running' });

      this.emitTurnAccepted({
        sessionId: normalizedSessionId,
        clientTurnId: runtime.clientTurnId,
        turnId: resultTurnId,
      });

      emitSessionStateChanged({
        writer: runtime.writer,
        scope: buildScope(runtime.projectName, runtime.sessionId),
        state: 'running',
        reason: 'turn/steer',
      });

      return {
        ok: true,
        status: 200,
        sessionId: normalizedSessionId,
        turnId: resultTurnId,
      };
    } catch (error) {
      const mappedError = mapRpcErrorToTurnError(error);
      const errorCode = String(mappedError?.details?.code || '').trim().toLowerCase();
      if (errorCode === 'activeturnnotsteerable') {
        emit(runtime.writer, {
          type: 'chat-turn-steer-rejected',
          sessionId: runtime.sessionId,
          provider: 'codex',
          projectName: runtime.projectName,
          clientTurnId: runtime.clientTurnId || null,
          turnKind: 'steer',
        });
      }
      this.emitTurnError({
        sessionId: normalizedSessionId,
        clientTurnId: runtime.clientTurnId,
        errorInfo: mappedError,
      });

      return {
        ok: false,
        status: 500,
        sessionId: normalizedSessionId,
        error: mappedError.message,
        errorType: mappedError.errorType,
        isRetryable: mappedError.isRetryable,
        details: mappedError.details,
      };
    }
  }

  async interrupt({ sessionId } = {}) {
    await this.ensureStarted();

    const normalizedSessionId = toSessionKey(sessionId);
    if (!normalizedSessionId) {
      return {
        ok: false,
        status: 400,
        error: 'sessionId is required for interrupt',
      };
    }

    const runtime = this.getSessionRuntime(normalizedSessionId);
    if (!runtime) {
      return {
        ok: false,
        status: 404,
        error: 'Unknown codex bridge session',
      };
    }

    const activeTurnId = this.sessionStore.getActiveTurnId({
      sessionId: normalizedSessionId,
      threadId: normalizedSessionId,
    });

    if (!activeTurnId) {
      return {
        ok: false,
        status: 409,
        error: 'No active turn to interrupt',
      };
    }

    this.sessionStore.setStatus({ sessionId: normalizedSessionId, status: 'interrupting' });
    emitSessionStateChanged({
      writer: runtime.writer,
      scope: buildScope(runtime.projectName, runtime.sessionId),
      state: 'running',
      reason: 'turn/interrupt-requested',
    });

    try {
      await this.rpc.request('turn/interrupt', {
        threadId: normalizedSessionId,
        turnId: activeTurnId,
      });
    } catch (error) {
      const mappedError = mapRpcErrorToTurnError(error);
      this.sessionStore.setStatus({ sessionId: normalizedSessionId, status: 'failed' });
      this.emitTurnError({
        sessionId: normalizedSessionId,
        clientTurnId: runtime.clientTurnId,
        errorInfo: mappedError,
      });
      emitSessionStateChanged({
        writer: runtime.writer,
        scope: buildScope(runtime.projectName, runtime.sessionId),
        state: 'failed',
        reason: 'turn/interrupt-error',
      });
      return {
        ok: false,
        status: 500,
        error: mappedError.message,
        errorType: mappedError.errorType,
        isRetryable: mappedError.isRetryable,
        details: mappedError.details,
      };
    }

    const existingWaiter = this.interruptWaiters.get(normalizedSessionId);
    if (existingWaiter) {
      if (existingWaiter.timer) clearTimeout(existingWaiter.timer);
      this.interruptWaiters.delete(normalizedSessionId);
    }

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.interruptWaiters.delete(normalizedSessionId);
        resolve({
          ok: false,
          status: 504,
          interrupted: false,
          error: 'Interrupt convergence timed out waiting for turn/completed(status=interrupted)',
        });
      }, INTERRUPT_WAIT_TIMEOUT_MS);

      this.interruptWaiters.set(normalizedSessionId, {
        timer,
        resolve,
        reject: (error) => {
          if (timer) clearTimeout(timer);
          resolve({
            ok: false,
            status: 500,
            interrupted: false,
            error: error?.message || 'Interrupt waiter failed',
          });
        },
      });
    });
  }

  async shutdown() {
    this.destroyed = true;
    this.closing = true;

    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }

    for (const waiter of this.interruptWaiters.values()) {
      if (waiter.timer) clearTimeout(waiter.timer);
      waiter.resolve({
        ok: false,
        status: 499,
        interrupted: false,
        error: 'Bridge runtime shutting down',
      });
    }
    this.interruptWaiters.clear();

    for (const waiters of this.turnCompletionWaiters.values()) {
      for (const waiter of waiters) {
        if (waiter.timer) clearTimeout(waiter.timer);
        waiter.reject(new Error('Bridge runtime shutting down'));
      }
    }
    this.turnCompletionWaiters.clear();
    this.completedTurns.clear();

    if (this.rpc) {
      this.rpc.close('bridge shutdown');
      this.rpc = null;
    }

    if (!this.child) {
      return;
    }

    const child = this.child;
    this.child = null;

    await new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };

      const timeout = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {}
        finish();
      }, APP_SERVER_STOP_TIMEOUT_MS);

      if (typeof child.once === 'function') {
        child.once('exit', () => {
          clearTimeout(timeout);
          finish();
        });
      }

      try {
        child.kill('SIGTERM');
      } catch {
        clearTimeout(timeout);
        finish();
      }
    });
  }
}

let singleton = null;

export function getCodexBridgeRuntime() {
  if (!singleton) {
    singleton = new CodexBridgeRuntime();
  }
  return singleton;
}

export async function queryCodexViaBridge(command, options = {}, writer) {
  const runtime = getCodexBridgeRuntime();
  return runtime.query(command, options, writer);
}

export async function steerCodexViaBridge(params = {}) {
  const runtime = getCodexBridgeRuntime();
  return runtime.steer(params);
}

export async function interruptCodexViaBridge(params = {}) {
  const runtime = getCodexBridgeRuntime();
  return runtime.interrupt(params);
}

export function isCodexBridgeSessionActive(sessionId) {
  return getCodexBridgeRuntime().isSessionActive(sessionId);
}

export function getCodexBridgeSessionStartTime(sessionId) {
  return getCodexBridgeRuntime().getSessionStartTime(sessionId);
}

export function getCodexBridgeActiveSessions() {
  return getCodexBridgeRuntime().listActiveSessions();
}

export function rebindCodexBridgeSessionWriter(sessionId, writer) {
  return getCodexBridgeRuntime().rebindSessionWriter(sessionId, writer);
}

export function getCodexBridgeSessionStatus(sessionId) {
  return getCodexBridgeRuntime().getSessionStatus(sessionId);
}

export async function shutdownCodexBridgeRuntime() {
  if (!singleton) return;
  await singleton.shutdown();
  singleton = null;
}

export {
  APP_SERVER_BOOT_TIMEOUT_MS,
  APP_SERVER_STOP_TIMEOUT_MS,
  INTERRUPT_WAIT_TIMEOUT_MS,
  normalizeRpcError,
};

setInterval(() => {
  const runtime = singleton;
  if (!runtime || runtime.destroyed) {
    return;
  }

  const cutoff = nowMs() - (30 * 60 * 1000);
  for (const [sessionId, runtimeSession] of runtime.sessions.entries()) {
    const snapshot = runtime.sessionStore.getStateSnapshot({ sessionId });
    const isProcessing = Boolean(snapshot?.isProcessing);
    const startTime = Number.isFinite(runtimeSession?.startTime) ? runtimeSession.startTime : null;
    if (!isProcessing && Number.isFinite(startTime) && startTime < cutoff) {
      runtime.sessions.delete(sessionId);
      runtime.sessionStore.deleteSession(sessionId);
    }
  }
}, 5 * 60 * 1000);
