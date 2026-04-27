import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const legacyFns = vi.hoisted(() => ({
  queryCodex: vi.fn(async () => ({ ok: true, from: 'legacy' })),
  abortCodexSession: vi.fn(() => true),
  isCodexSessionActive: vi.fn(() => false),
  getCodexSessionStartTime: vi.fn(() => null),
  getActiveCodexSessions: vi.fn(() => []),
  rebindCodexSessionWriter: vi.fn(() => false),
}));

const bridgeFns = vi.hoisted(() => ({
  queryCodexViaBridge: vi.fn(async () => ({ ok: true, from: 'bridge' })),
  steerCodexViaBridge: vi.fn(async () => ({
    ok: false,
    status: 409,
    error: 'expectedTurnId is required for steer',
    details: { reason: 'missing_expected_turn_id' },
  })),
  interruptCodexViaBridge: vi.fn(async () => ({ ok: false })),
  isCodexBridgeSessionActive: vi.fn(() => false),
  getCodexBridgeSessionStartTime: vi.fn(() => null),
  getCodexBridgeActiveSessions: vi.fn(() => []),
  rebindCodexBridgeSessionWriter: vi.fn(() => false),
  getCodexBridgeSessionStatus: vi.fn((sessionId) => ({
    sessionId,
    provider: 'codex',
    isProcessing: false,
    startTime: null,
  })),
}));

const parityFns = vi.hoisted(() => ({
  recordCodexShadowParityComparison: vi.fn(() => ({})),
}));

vi.mock('../openai-codex.js', () => ({
  queryCodex: legacyFns.queryCodex,
  abortCodexSession: legacyFns.abortCodexSession,
  isCodexSessionActive: legacyFns.isCodexSessionActive,
  getCodexSessionStartTime: legacyFns.getCodexSessionStartTime,
  getActiveCodexSessions: legacyFns.getActiveCodexSessions,
  rebindCodexSessionWriter: legacyFns.rebindCodexSessionWriter,
}));

vi.mock('../codex-bridge-runtime.js', () => ({
  queryCodexViaBridge: bridgeFns.queryCodexViaBridge,
  steerCodexViaBridge: bridgeFns.steerCodexViaBridge,
  interruptCodexViaBridge: bridgeFns.interruptCodexViaBridge,
  isCodexBridgeSessionActive: bridgeFns.isCodexBridgeSessionActive,
  getCodexBridgeSessionStartTime: bridgeFns.getCodexBridgeSessionStartTime,
  getCodexBridgeActiveSessions: bridgeFns.getCodexBridgeActiveSessions,
  rebindCodexBridgeSessionWriter: bridgeFns.rebindCodexBridgeSessionWriter,
  getCodexBridgeSessionStatus: bridgeFns.getCodexBridgeSessionStatus,
}));

vi.mock('../utils/codexShadowParity.js', () => ({
  recordCodexShadowParityComparison: parityFns.recordCodexShadowParityComparison,
}));

function createWriter() {
  const sent = [];
  return {
    sent,
    writer: {
      send(payload) {
        sent.push(payload);
      },
    },
  };
}

describe('codex runtime facade', () => {
  beforeEach(() => {
    vi.resetModules();
    legacyFns.queryCodex.mockClear();
    legacyFns.abortCodexSession.mockClear();
    legacyFns.isCodexSessionActive.mockClear();
    legacyFns.getCodexSessionStartTime.mockClear();
    legacyFns.getActiveCodexSessions.mockClear();
    legacyFns.rebindCodexSessionWriter.mockClear();

    bridgeFns.queryCodexViaBridge.mockClear();
    bridgeFns.steerCodexViaBridge.mockClear();
    bridgeFns.interruptCodexViaBridge.mockClear();
    bridgeFns.isCodexBridgeSessionActive.mockClear();
    bridgeFns.getCodexBridgeSessionStartTime.mockClear();
    bridgeFns.getCodexBridgeActiveSessions.mockClear();
    bridgeFns.rebindCodexBridgeSessionWriter.mockClear();
    bridgeFns.getCodexBridgeSessionStatus.mockClear();
    parityFns.recordCodexShadowParityComparison.mockClear();
  });

  afterEach(() => {
    delete process.env.CODEX_RUNTIME_MODE;
  });

  it('defaults to bridge mode', async () => {
    const mod = await import('../codex-runtime-facade.js');
    expect(mod.getCodexRuntimeMode()).toBe('bridge');
  });

  it('uses bridge query path by default', async () => {
    delete process.env.CODEX_RUNTIME_MODE;
    const mod = await import('../codex-runtime-facade.js');

    const writer = createWriter().writer;
    const result = await mod.queryCodexUnified('hello', { sessionId: 's-1' }, writer);

    expect(result).toEqual(expect.objectContaining({ from: 'bridge' }));
    expect(bridgeFns.queryCodexViaBridge).toHaveBeenCalledTimes(1);
    expect(legacyFns.queryCodex).not.toHaveBeenCalled();
  });

  it('passes through regular query payload in bridge mode', async () => {
    delete process.env.CODEX_RUNTIME_MODE;
    const mod = await import('../codex-runtime-facade.js');

    const writer = createWriter().writer;
    const result = await mod.queryCodexUnified('queued-message', {
      sessionId: 'session-q-1',
      projectName: 'proj',
    }, writer);

    expect(result).toEqual(expect.objectContaining({ from: 'bridge' }));
    expect(bridgeFns.queryCodexViaBridge).toHaveBeenCalledTimes(1);
    expect(bridgeFns.queryCodexViaBridge).toHaveBeenCalledWith(
      'queued-message',
      expect.objectContaining({
        sessionId: 'session-q-1',
      }),
      writer,
    );
  });

  it('honors explicit runtimeMode option override to bridge', async () => {
    process.env.CODEX_RUNTIME_MODE = 'legacy';
    const mod = await import('../codex-runtime-facade.js');

    const writer = createWriter().writer;
    const result = await mod.queryCodexUnified('hello-override', {
      runtimeMode: 'bridge',
      sessionId: 's-override',
    }, writer);

    expect(result).toEqual(expect.objectContaining({ from: 'bridge' }));
    expect(bridgeFns.queryCodexViaBridge).toHaveBeenCalledTimes(1);
    expect(legacyFns.queryCodex).not.toHaveBeenCalled();
  });

  it('runs legacy primary and bridge secondary in shadow mode', async () => {
    process.env.CODEX_RUNTIME_MODE = 'shadow';
    const mod = await import('../codex-runtime-facade.js');

    const writer = createWriter().writer;
    const result = await mod.queryCodexUnified('hello-shadow', { sessionId: 's-shadow' }, writer);

    expect(result).toEqual(expect.objectContaining({ from: 'legacy' }));
    expect(legacyFns.queryCodex).toHaveBeenCalledTimes(1);
    expect(bridgeFns.queryCodexViaBridge).toHaveBeenCalledTimes(1);
    expect(parityFns.recordCodexShadowParityComparison).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'query',
      }),
    );
  });

  it('uses shadow override when runtimeMode option is shadow', async () => {
    process.env.CODEX_RUNTIME_MODE = 'bridge';
    const mod = await import('../codex-runtime-facade.js');

    const writer = createWriter().writer;
    const result = await mod.queryCodexUnified('hello-shadow-override', {
      runtimeMode: 'shadow',
      sessionId: 's-shadow-override',
    }, writer);

    expect(result).toEqual(expect.objectContaining({ from: 'legacy' }));
    expect(legacyFns.queryCodex).toHaveBeenCalledTimes(1);
    expect(bridgeFns.queryCodexViaBridge).toHaveBeenCalledTimes(1);
    expect(parityFns.recordCodexShadowParityComparison).toHaveBeenCalledTimes(1);
  });

  it('rejects steer without expectedTurnId in bridge mode', async () => {
    process.env.CODEX_RUNTIME_MODE = 'bridge';
    const mod = await import('../codex-runtime-facade.js');

    const { sent, writer } = createWriter();
    const result = await mod.queryCodexUnified('Please revise this', {
      sessionId: 'sess-1',
      turnKind: 'steer',
      projectName: 'proj-1',
      projectPath: '/tmp/proj',
    }, writer);

    expect(result).toEqual(expect.objectContaining({ ok: false, status: 409 }));
    expect(bridgeFns.steerCodexViaBridge).toHaveBeenCalledTimes(1);
    expect(sent).toContainEqual(expect.objectContaining({
      type: 'chat-turn-error',
      errorType: 'steer_precondition_failed',
      isRetryable: false,
    }));
  });

  it('rejects steer without sessionId in bridge mode', async () => {
    process.env.CODEX_RUNTIME_MODE = 'bridge';
    const mod = await import('../codex-runtime-facade.js');

    const { sent, writer } = createWriter();
    const result = await mod.queryCodexUnified('Please revise this', {
      turnKind: 'steer',
      projectName: 'proj-1',
    }, writer);

    expect(result).toEqual(expect.objectContaining({ ok: false, status: 400 }));
    expect(bridgeFns.steerCodexViaBridge).not.toHaveBeenCalled();
    expect(sent).toContainEqual(expect.objectContaining({
      type: 'chat-turn-error',
      errorType: 'steer_precondition_failed',
      isRetryable: false,
    }));
  });

  it('returns inactive status for unknown sessions in bridge mode', async () => {
    process.env.CODEX_RUNTIME_MODE = 'bridge';
    const mod = await import('../codex-runtime-facade.js');

    const status = mod.getCodexSessionStatusUnified('unknown-session');
    expect(status).toEqual({
      sessionId: 'unknown-session',
      provider: 'codex',
      isProcessing: false,
      startTime: null,
    });
    expect(bridgeFns.getCodexBridgeSessionStatus).toHaveBeenCalledWith('unknown-session');
  });

  it('abort returns false when no active bridge session exists', async () => {
    process.env.CODEX_RUNTIME_MODE = 'bridge';
    const mod = await import('../codex-runtime-facade.js');

    bridgeFns.interruptCodexViaBridge.mockResolvedValueOnce({ ok: false });

    const success = await mod.abortCodexSessionUnified('missing-session');
    expect(success).toBe(false);
    expect(bridgeFns.interruptCodexViaBridge).toHaveBeenCalledWith({ sessionId: 'missing-session' });
  });

  it('runs interrupt shadow parity with legacy primary and bridge secondary', async () => {
    process.env.CODEX_RUNTIME_MODE = 'shadow';
    const mod = await import('../codex-runtime-facade.js');

    legacyFns.abortCodexSession.mockReturnValueOnce(true);
    const success = await mod.abortCodexSessionUnified('shadow-session');
    expect(success).toBe(true);
    expect(legacyFns.abortCodexSession).toHaveBeenCalledWith('shadow-session');
    expect(bridgeFns.interruptCodexViaBridge).toHaveBeenCalledWith({ sessionId: 'shadow-session' });
    expect(parityFns.recordCodexShadowParityComparison).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'interrupt',
      }),
    );
  });

});
