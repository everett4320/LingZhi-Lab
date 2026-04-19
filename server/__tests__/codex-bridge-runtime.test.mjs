import { afterEach, describe, expect, it, vi } from 'vitest';

const notificationHandlers = [];
const requestCalls = [];
const requestPayloads = [];
const notifyCalls = [];
const processHandles = [];
const rpcConfigRefs = [];

vi.mock('../utils/cliResolution.js', () => ({
  resolveAvailableCliCommand: vi.fn(async () => 'codex'),
}));

vi.mock('../utils/codexAppServerRpc.js', () => ({
  createJsonRpcMux: vi.fn(({ onNotification, onRequest }) => {
    notificationHandlers.push(onNotification);
    rpcConfigRefs.push({ onRequest });
    return {
      request: vi.fn(async (method, params) => {
        requestCalls.push(method);
        requestPayloads.push(params);
        if (method === 'initialize') return { serverInfo: { name: 'ok' } };
        if (method === 'thread/start') return { thread: { id: 'thread-1' } };
        if (method === 'turn/start') return { turn: { id: 'turn-1' } };
        if (method === 'turn/steer') return { turnId: 'turn-1' };
        if (method === 'turn/interrupt') return {};
        return {};
      }),
      notify: vi.fn((method, params) => {
        notifyCalls.push({ method, params });
      }),
      handleIncoming: vi.fn(),
      close: vi.fn(),
    };
  }),
  normalizeRpcError: (err, fallback = 'error') => ({
    code: Number.isFinite(err?.code) ? err.code : -32603,
    message: err?.message || fallback,
    data: null,
  }),
}));

vi.mock('../shared/errorClassifier.js', () => ({
  classifyError: () => ({ errorType: 'api_error', isRetryable: false }),
  classifySDKError: () => ({ errorType: 'provider_error', isRetryable: true }),
}));

vi.mock('../shared/modelConstants.js', () => ({
  CODEX_MODELS: { DEFAULT: 'gpt-5.4' },
}));

vi.mock('../projects.js', () => ({
  encodeProjectPath: (value) => `encoded:${value}`,
}));

class FakeProcess {
  constructor() {
    this.killed = false;
    this.stdin = { write: vi.fn() };
    this.exitHandlers = [];
    this.errorHandlers = [];
    this.stdout = { on: vi.fn() };
    this.stderr = { on: vi.fn() };
  }

  kill() {
    this.killed = true;
  }

  emitExit(code = 0, signal = null) {
    for (const handler of this.exitHandlers) {
      handler(code, signal);
    }
  }

  on(event, handler) {
    if (event === 'exit') this.exitHandlers.push(handler);
    if (event === 'error') this.errorHandlers.push(handler);
  }

  once(event, handler) {
    if (event === 'exit') this.exitHandlers.push(handler);
  }
}

const fakeSpawn = vi.fn(() => {
  const process = new FakeProcess();
  processHandles.push(process);
  return process;
});

vi.mock('child_process', () => ({
  spawn: fakeSpawn,
}));

describe('codex bridge runtime', () => {
  async function waitForCondition(predicate, {
    timeoutMs = 1000,
    intervalMs = 10,
    errorMessage = 'condition not satisfied',
  } = {}) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (predicate()) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    throw new Error(errorMessage);
  }

  async function getOnNotification() {
    for (let i = 0; i < 50; i += 1) {
      const handler = notificationHandlers.at(-1);
      if (typeof handler === 'function') {
        return handler;
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    throw new Error('notification handler was not registered');
  }

  async function completeTurn(status = 'completed', overrides = {}) {
    const onNotification = await getOnNotification();
    onNotification('turn/completed', {
      threadId: 'thread-1',
      turn: {
        id: 'turn-1',
        status,
        error: null,
        ...overrides,
      },
    });
  }

  afterEach(async () => {
    const mod = await import('../codex-bridge-runtime.js');
    await mod.shutdownCodexBridgeRuntime();

    requestCalls.length = 0;
    requestPayloads.length = 0;
    notifyCalls.length = 0;
    notificationHandlers.length = 0;
    rpcConfigRefs.length = 0;
    processHandles.length = 0;
  });

  it('enforces expectedTurnId for steer operations', async () => {
    const mod = await import('../codex-bridge-runtime.js');
    const runtime = mod.getCodexBridgeRuntime();

    const writer = { send: vi.fn() };
    const queryPromise = runtime.query('hello', {
      projectPath: '/tmp/project',
      projectName: 'proj',
    }, writer);

    await waitForCondition(
      () => runtime.getSessionStatus('thread-1')?.activeTurnId === 'turn-1',
      { errorMessage: 'active turn was not established for steer precondition test' },
    );

    const steer = await runtime.steer({
      sessionId: 'thread-1',
      command: 'refine this',
      expectedTurnId: 'wrong-turn',
    });

    expect(steer).toEqual(expect.objectContaining({
      ok: false,
      status: 409,
      error: 'expectedTurnId does not match active turn',
    }));

    await completeTurn('completed');
    await queryPromise;
  });

  it('updates session status to aborted only after interrupted completion notification', async () => {
    const mod = await import('../codex-bridge-runtime.js');
    const runtime = mod.getCodexBridgeRuntime();

    const writer = { send: vi.fn() };
    const queryPromise = runtime.query('hello', {
      projectPath: '/tmp/project',
      projectName: 'proj',
    }, writer);

    await waitForCondition(
      () => runtime.getSessionStatus('thread-1')?.activeTurnId === 'turn-1',
      { errorMessage: 'active turn was not established before interrupt test' },
    );

    const interruptPromise = runtime.interrupt({ sessionId: 'thread-1' });
    await waitForCondition(
      () => requestCalls.some((entry) => entry === 'turn/interrupt'),
      { errorMessage: 'turn/interrupt request was not issued before completion notification' },
    );

    const statusBeforeCompletion = runtime.getSessionStatus('thread-1');
    expect(statusBeforeCompletion.isProcessing).toBe(true);

    await completeTurn('interrupted');

    const interruptResult = await interruptPromise;
    expect(interruptResult).toEqual(expect.objectContaining({ ok: true, status: 200 }));

    await queryPromise;

    const statusAfterCompletion = runtime.getSessionStatus('thread-1');
    expect(statusAfterCompletion.isProcessing).toBe(false);

    expect(writer.send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'chat-turn-aborted',
      sessionId: 'thread-1',
    }));
  }, 15000);

  it('emits unified chat-session-created with provisional rebinding', async () => {
    const mod = await import('../codex-bridge-runtime.js');
    const runtime = mod.getCodexBridgeRuntime();

    const writer = { send: vi.fn() };
    const queryPromise = runtime.query('hello', {
      projectPath: '/tmp/project',
      projectName: 'proj',
      provisionalSessionId: 'new-session-123',
      clientTurnId: 'client-turn-1',
    }, writer);
    await completeTurn('completed');
    const result = await queryPromise;

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      sessionId: 'thread-1',
    }));

    expect(writer.send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'chat-session-created',
      sessionId: 'thread-1',
      provider: 'codex',
      projectName: 'proj',
    }));
  });

  it('maps notification item events to unified chat-turn-item payloads', async () => {
    const mod = await import('../codex-bridge-runtime.js');
    const runtime = mod.getCodexBridgeRuntime();

    const writer = { send: vi.fn() };
    const queryPromise = runtime.query('hello', {
      projectPath: '/tmp/project',
      projectName: 'proj',
    }, writer);

    const onNotification = await getOnNotification();
    onNotification('item/started', {
      threadId: 'thread-1',
      turnId: 'turn-1',
      item: {
        type: 'commandExecution',
        id: 'item-cmd-1',
        command: 'ls -la',
        aggregatedOutput: '',
        exitCode: null,
        status: 'inProgress',
      },
    });
    onNotification('item/completed', {
      threadId: 'thread-1',
      turnId: 'turn-1',
      item: {
        type: 'commandExecution',
        id: 'item-cmd-1',
        command: 'ls -la',
        aggregatedOutput: 'ok',
        exitCode: 0,
        status: 'completed',
      },
    });
    await completeTurn('completed');
    await queryPromise;

    expect(writer.send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'chat-turn-item',
      sessionId: 'thread-1',
      provider: 'codex',
      itemType: 'command_execution',
      lifecycle: 'started',
    }));
    expect(writer.send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'chat-turn-item',
      sessionId: 'thread-1',
      provider: 'codex',
      itemType: 'command_execution',
      lifecycle: 'completed',
    }));
  });

  it('responds to app-server initiated approval and elicitation requests', async () => {
    const mod = await import('../codex-bridge-runtime.js');
    const runtime = mod.getCodexBridgeRuntime();
    await runtime.initialize();

    const onRequest = rpcConfigRefs.at(-1)?.onRequest;
    expect(onRequest).toBeTypeOf('function');

    await expect(onRequest('item/commandExecution/requestApproval', {}))
      .resolves.toEqual({ decision: 'accept' });
    await expect(onRequest('item/fileChange/requestApproval', {}))
      .resolves.toEqual({ decision: 'accept' });
    await expect(onRequest('item/tool/requestUserInput', {}))
      .resolves.toEqual({ answers: {} });
    await expect(onRequest('mcpServer/elicitation/request', {}))
      .resolves.toEqual({ action: 'decline', content: null, _meta: null });
    await expect(onRequest('item/tool/call', {}))
      .resolves.toEqual({ contentItems: [], success: false });
    await expect(onRequest('item/permissions/requestApproval', {
      permissions: {
        network: { enabled: true },
        fileSystem: { read: ['/tmp/a'], write: ['/tmp/b'] },
      },
    })).resolves.toEqual({
      permissions: {
        network: { enabled: true },
        fileSystem: { read: ['/tmp/a'], write: ['/tmp/b'] },
      },
      scope: 'turn',
    });

    await expect(onRequest('item/permissions/requestApproval', {
      permissions: null,
    })).resolves.toEqual({
      permissions: {
        network: { enabled: null },
        fileSystem: { read: null, write: null },
      },
      scope: 'turn',
    });

    await expect(onRequest('account/chatgptAuthTokens/refresh', {
      reason: 'unauthorized',
    })).rejects.toMatchObject({
      code: -32603,
    });
  });

  it('rejects unknown app-server initiated request methods', async () => {
    const mod = await import('../codex-bridge-runtime.js');
    const runtime = mod.getCodexBridgeRuntime();
    await runtime.initialize();

    const onRequest = rpcConfigRefs.at(-1)?.onRequest;
    expect(onRequest).toBeTypeOf('function');

    await expect(onRequest('unknown/request', {})).rejects.toMatchObject({
      code: -32601,
    });
  });

  it('sends strict v2 payload for turn/steer', async () => {
    const mod = await import('../codex-bridge-runtime.js');
    const runtime = mod.getCodexBridgeRuntime();

    const writer = { send: vi.fn() };
    const queryPromise = runtime.query('hello', {
      projectPath: '/tmp/project',
      projectName: 'proj',
    }, writer);

    await waitForCondition(
      () => runtime.getSessionStatus('thread-1')?.activeTurnId === 'turn-1',
      { errorMessage: 'active turn was not established before strict steer payload test' },
    );

    requestCalls.length = 0;
    requestPayloads.length = 0;
    await runtime.steer({
      sessionId: 'thread-1',
      command: 'please revise',
      expectedTurnId: 'turn-1',
      clientTurnId: 'client-turn-2',
    });

    const steerCall = requestCalls.find((entry) => entry === 'turn/steer');
    expect(steerCall).toBe('turn/steer');
    const steerPayload = requestPayloads[requestCalls.indexOf('turn/steer')];
    expect(steerPayload).toEqual({
      threadId: 'thread-1',
      input: [
        { type: 'text', text: 'please revise', text_elements: [] },
      ],
      expectedTurnId: 'turn-1',
    });

    await completeTurn('completed');
    await queryPromise;
  });

  it('sends strict v2 payload for thread/start and initialized notify', async () => {
    const mod = await import('../codex-bridge-runtime.js');
    const runtime = mod.getCodexBridgeRuntime();

    const writer = { send: vi.fn() };
    const queryPromise = runtime.query('strict start payload', {
      projectPath: '/tmp/project',
      projectName: 'proj',
    }, writer);
    await completeTurn('completed');
    await queryPromise;

    const threadStartIndex = requestCalls.findIndex((entry) => entry === 'thread/start');
    expect(threadStartIndex).toBeGreaterThanOrEqual(0);
    const threadStartPayload = requestPayloads[threadStartIndex];
    expect(threadStartPayload).toEqual(expect.objectContaining({
      model: 'gpt-5.4',
      cwd: '/tmp/project',
      approvalPolicy: 'untrusted',
      sandbox: 'workspace-write',
    }));
    expect(threadStartPayload.experimentalRawEvents).toBeUndefined();
    expect(threadStartPayload.persistExtendedHistory).toBeUndefined();

    expect(notifyCalls).toContainEqual({
      method: 'initialized',
      params: undefined,
    });
  });

  it('includes usage payload on chat-turn-complete from token usage notifications', async () => {
    const mod = await import('../codex-bridge-runtime.js');
    const runtime = mod.getCodexBridgeRuntime();

    const writer = { send: vi.fn() };
    const queryPromise = runtime.query('hello', {
      projectPath: '/tmp/project',
      projectName: 'proj',
    }, writer);

    const onNotification = await getOnNotification();
    onNotification('thread/tokenUsage/updated', {
      threadId: 'thread-1',
      turnId: 'turn-1',
      tokenUsage: {
        total: {
          totalTokens: 40,
          inputTokens: 10,
          cachedInputTokens: 3,
          outputTokens: 27,
          reasoningOutputTokens: 5,
        },
        last: {
          totalTokens: 12,
          inputTokens: 7,
          cachedInputTokens: 1,
          outputTokens: 4,
          reasoningOutputTokens: 2,
        },
        modelContextWindow: 200000,
      },
    });

    await completeTurn('completed');
    await queryPromise;

    expect(writer.send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'chat-turn-complete',
      usage: expect.objectContaining({
        inputTokens: 7,
        outputTokens: 4,
        cachedInputTokens: 1,
        totalTokens: 12,
      }),
    }));
  });

  it('emits chat-turn-complete and session-state-changed on completed turn', async () => {
    const mod = await import('../codex-bridge-runtime.js');
    const runtime = mod.getCodexBridgeRuntime();

    const writer = { send: vi.fn() };
    const queryPromise = runtime.query('hello', {
      projectPath: '/tmp/project',
      projectName: 'proj',
    }, writer);
    await completeTurn('completed');
    await queryPromise;

    expect(writer.send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'chat-turn-complete',
      sessionId: 'thread-1',
    }));
    expect(writer.send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'session-state-changed',
      sessionId: 'thread-1',
      state: 'completed',
    }));
  });

  it('returns interrupted result when turn completes as interrupted', async () => {
    const mod = await import('../codex-bridge-runtime.js');
    const runtime = mod.getCodexBridgeRuntime();

    const writer = { send: vi.fn() };
    const queryPromise = runtime.query('hello', {
      projectPath: '/tmp/project',
      projectName: 'proj',
    }, writer);
    await completeTurn('interrupted');
    const result = await queryPromise;

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      status: 409,
      interrupted: true,
      error: 'Turn interrupted',
    }));
    expect(writer.send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'chat-turn-aborted',
      sessionId: 'thread-1',
      success: true,
    }));
  });

  it('returns failure details when turn completes as failed', async () => {
    const mod = await import('../codex-bridge-runtime.js');
    const runtime = mod.getCodexBridgeRuntime();

    const writer = { send: vi.fn() };
    const queryPromise = runtime.query('hello', {
      projectPath: '/tmp/project',
      projectName: 'proj',
    }, writer);
    await completeTurn('failed', {
      error: { message: 'bridge failed', code: 'internal_error' },
    });
    const result = await queryPromise;

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      status: 500,
      error: 'bridge failed',
    }));
    expect(writer.send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'chat-turn-error',
      sessionId: 'thread-1',
      error: 'bridge failed',
    }));
  });
});
