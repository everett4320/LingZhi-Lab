import {
  queryCodex,
  abortCodexSession,
  isCodexSessionActive,
  getCodexSessionStartTime,
  getActiveCodexSessions,
  rebindCodexSessionWriter,
} from './openai-codex.js';
import {
  queryCodexViaBridge,
  steerCodexViaBridge,
  interruptCodexViaBridge,
  isCodexBridgeSessionActive,
  getCodexBridgeSessionStartTime,
  getCodexBridgeActiveSessions,
  rebindCodexBridgeSessionWriter,
  getCodexBridgeSessionStatus,
} from './codex-bridge-runtime.js';
import { getCodexRuntimeModeFromEnv, normalizeCodexRuntimeMode } from './utils/codexRuntimeMode.js';
import { recordCodexShadowParityComparison } from './utils/codexShadowParity.js';

function getRuntimeMode(options = {}) {
  if (typeof options?.runtimeMode === 'string' && options.runtimeMode.trim()) {
    return normalizeCodexRuntimeMode(options.runtimeMode);
  }
  return getCodexRuntimeModeFromEnv(options?.env || process.env);
}

function isLikelySteerCommand(_command, options = {}) {
  if (options.turnKind === 'steer' || options.kind === 'steer') {
    return true;
  }
  if (typeof options.expectedTurnId === 'string' && options.expectedTurnId.trim()) {
    return true;
  }
  return false;
}

function deriveExpectedTurnId(options = {}) {
  if (typeof options.expectedTurnId === 'string' && options.expectedTurnId.trim()) {
    return options.expectedTurnId.trim();
  }
  if (typeof options.activeTurnId === 'string' && options.activeTurnId.trim()) {
    return options.activeTurnId.trim();
  }
  return null;
}

function nowMs() {
  return Date.now();
}

function toSessionKey(value) {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function extractScopeSessionId(payload) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const directSessionId = toSessionKey(payload.sessionId);
  if (directSessionId) return directSessionId;

  const scopeSessionId = toSessionKey(payload.scope?.sessionId);
  if (scopeSessionId) return scopeSessionId;

  const actualSessionId = toSessionKey(payload.actualSessionId);
  if (actualSessionId) return actualSessionId;

  return null;
}

function createShadowWriterProbe(targetWriter) {
  const probe = {
    accepted: false,
    hasTerminalEvent: false,
    terminalState: null,
    sessionId: null,
    provisionalSessionId: null,
  };

  return {
    probe,
    writer: {
      send(payload) {
        const payloadType = typeof payload?.type === 'string' ? payload.type : null;
        if (payloadType === 'chat-turn-accepted') {
          probe.accepted = true;
        } else if (payloadType === 'chat-turn-complete') {
          probe.hasTerminalEvent = true;
          probe.terminalState = 'completed';
        } else if (payloadType === 'chat-turn-error') {
          probe.hasTerminalEvent = true;
          probe.terminalState = 'failed';
        } else if (payloadType === 'chat-turn-aborted') {
          probe.hasTerminalEvent = true;
          probe.terminalState = 'interrupted';
        }

        const resolvedSessionId = extractScopeSessionId(payload);
        if (resolvedSessionId) {
          probe.sessionId = resolvedSessionId;
        }
        const provisionalSessionId = toSessionKey(payload?.provisionalSessionId);
        if (provisionalSessionId) {
          probe.provisionalSessionId = provisionalSessionId;
        }

        targetWriter?.send?.(payload);
      },
    },
  };
}

function normalizeTurnResult({
  result,
  status = null,
  probe = null,
  latencyMs = null,
  fallbackSessionId = null,
  fallbackProvisionalSessionId = null,
}) {
  const normalizedStatus = Number.isFinite(status)
    ? status
    : (Number.isFinite(result?.status) ? result.status : (result?.ok === false ? 500 : 200));

  const interrupted = result?.interrupted === true
    || probe?.terminalState === 'interrupted';
  const ok = result?.ok !== false && !interrupted && normalizedStatus < 400;

  return {
    ok,
    status: normalizedStatus,
    interrupted,
    accepted: probe?.accepted === true,
    hasTerminalEvent: probe?.hasTerminalEvent === true,
    terminalState: probe?.terminalState || (interrupted ? 'interrupted' : (ok ? 'completed' : 'failed')),
    sessionId: toSessionKey(result?.sessionId)
      || toSessionKey(probe?.sessionId)
      || toSessionKey(result?.actualSessionId)
      || toSessionKey(fallbackSessionId),
    provisionalSessionId: toSessionKey(result?.provisionalSessionId)
      || toSessionKey(probe?.provisionalSessionId)
      || toSessionKey(fallbackProvisionalSessionId),
    errorType: typeof result?.errorType === 'string' ? result.errorType : null,
    latencyMs: Number.isFinite(latencyMs) ? latencyMs : null,
    details: result?.details || null,
  };
}

async function runBridgeTurn(command, options = {}, writer) {
  const sessionId = options.sessionId || options.resumeSessionId || null;
  const shouldSteer = isLikelySteerCommand(command, options);

  if (shouldSteer && !sessionId) {
    writer?.send?.({
      type: 'chat-turn-error',
      scope: {
        projectName: options.projectName || null,
        provider: 'codex',
        sessionId: null,
      },
      clientTurnId: options.clientTurnId || null,
      error: 'sessionId is required for steer',
      errorType: 'steer_precondition_failed',
      isRetryable: false,
    });

    return {
      ok: false,
      status: 400,
      error: 'sessionId is required for steer',
      errorType: 'steer_precondition_failed',
      isRetryable: false,
    };
  }

  if (!shouldSteer) {
    return queryCodexViaBridge(command, options, writer);
  }

  const steerResult = await steerCodexViaBridge({
    sessionId,
    command,
    expectedTurnId: deriveExpectedTurnId(options),
    clientTurnId: options.clientTurnId || null,
  });

  if (!steerResult.ok) {
    const errorType = steerResult.status >= 500 ? 'runtime_error' : 'steer_precondition_failed';
    const isRetryable = steerResult.status >= 500;
    writer?.send?.({
      type: 'chat-turn-error',
      scope: {
        projectName: options.projectName || null,
        provider: 'codex',
        sessionId,
      },
      clientTurnId: options.clientTurnId || sessionId,
      error: steerResult.error || 'Steer request failed',
      errorType,
      isRetryable,
      details: steerResult.details || null,
    });
  }

  return steerResult;
}

async function runShadowTurn(command, options = {}, writer) {
  const operation = isLikelySteerCommand(command, options) ? 'steer' : 'query';
  const fallbackSessionId = options.sessionId || options.resumeSessionId || null;
  const fallbackProvisionalSessionId = options.provisionalSessionId || null;

  const primaryStartAt = nowMs();
  const primaryProbePack = createShadowWriterProbe(writer);
  let primaryResult = null;
  let primaryError = null;

  try {
    primaryResult = await queryCodex(command, options, primaryProbePack.writer);
  } catch (error) {
    primaryError = error;
  }
  const primaryLatencyMs = nowMs() - primaryStartAt;
  const primaryNormalized = normalizeTurnResult({
    result: primaryResult || { ok: false, status: 500, errorType: 'runtime_error' },
    status: primaryResult?.status,
    probe: primaryProbePack.probe,
    latencyMs: primaryLatencyMs,
    fallbackSessionId,
    fallbackProvisionalSessionId,
  });

  // Shadow lane should never affect user-facing output.
  const secondaryStartAt = nowMs();
  const secondaryProbePack = createShadowWriterProbe(null);
  let secondaryResult = null;
  let secondaryError = null;

  try {
    secondaryResult = await runBridgeTurn(command, options, secondaryProbePack.writer);
  } catch (error) {
    secondaryError = error;
  }
  const secondaryLatencyMs = nowMs() - secondaryStartAt;
  const secondaryNormalized = normalizeTurnResult({
    result: secondaryResult || { ok: false, status: 500, errorType: 'runtime_error' },
    status: secondaryResult?.status,
    probe: secondaryProbePack.probe,
    latencyMs: secondaryLatencyMs,
    fallbackSessionId,
    fallbackProvisionalSessionId,
  });

  recordCodexShadowParityComparison({
    operation,
    primaryMode: 'legacy',
    secondaryMode: 'bridge',
    primary: {
      ...primaryNormalized,
      details: primaryError ? { error: String(primaryError?.message || primaryError) } : primaryNormalized.details,
    },
    secondary: {
      ...secondaryNormalized,
      details: secondaryError ? { error: String(secondaryError?.message || secondaryError) } : secondaryNormalized.details,
    },
    context: {
      expectedTurnId: deriveExpectedTurnId(options),
      hasSessionId: Boolean(fallbackSessionId),
      clientTurnId: options.clientTurnId || null,
      projectName: options.projectName || null,
    },
  });

  if (primaryError) {
    throw primaryError;
  }
  return primaryResult;
}

export async function queryCodexUnified(command, options = {}, writer) {
  const runtimeMode = getRuntimeMode(options);
  if (runtimeMode === 'legacy') {
    return queryCodex(command, options, writer);
  }
  if (runtimeMode === 'shadow') {
    return runShadowTurn(command, options, writer);
  }

  return runBridgeTurn(command, options, writer);
}

export async function abortCodexSessionUnified(sessionId) {
  const runtimeMode = getRuntimeMode();
  if (runtimeMode === 'legacy') {
    return abortCodexSession(sessionId);
  }
  if (runtimeMode === 'shadow') {
    const primaryStartAt = nowMs();
    let primaryResult = false;
    let primaryError = null;
    try {
      primaryResult = Boolean(abortCodexSession(sessionId));
    } catch (error) {
      primaryError = error;
    }
    const primaryLatencyMs = nowMs() - primaryStartAt;

    const secondaryStartAt = nowMs();
    let secondaryResult = null;
    let secondaryError = null;
    try {
      secondaryResult = await interruptCodexViaBridge({ sessionId });
    } catch (error) {
      secondaryError = error;
    }
    const secondaryLatencyMs = nowMs() - secondaryStartAt;

    recordCodexShadowParityComparison({
      operation: 'interrupt',
      primaryMode: 'legacy',
      secondaryMode: 'bridge',
      primary: {
        ok: primaryResult,
        status: primaryResult ? 200 : 409,
        interrupted: primaryResult,
        terminalState: primaryResult ? 'interrupted' : 'failed',
        hasTerminalEvent: primaryResult,
        accepted: false,
        sessionId,
        latencyMs: primaryLatencyMs,
        details: primaryError ? { error: String(primaryError?.message || primaryError) } : null,
      },
      secondary: {
        ok: Boolean(secondaryResult?.ok),
        status: Number.isFinite(secondaryResult?.status) ? secondaryResult.status : 500,
        interrupted: secondaryResult?.interrupted === true,
        terminalState: secondaryResult?.interrupted === true
          ? 'interrupted'
          : (secondaryResult?.ok ? 'completed' : 'failed'),
        hasTerminalEvent: secondaryResult?.interrupted === true,
        accepted: false,
        sessionId: secondaryResult?.sessionId || sessionId,
        latencyMs: secondaryLatencyMs,
        errorType: secondaryResult?.errorType || null,
        details: secondaryError
          ? { error: String(secondaryError?.message || secondaryError) }
          : (secondaryResult?.details || null),
      },
      context: {
        sessionId,
      },
    });

    if (primaryError) {
      throw primaryError;
    }
    return primaryResult;
  }

  const result = await interruptCodexViaBridge({ sessionId });
  return Boolean(result?.ok);
}

export function isCodexSessionActiveUnified(sessionId) {
  const runtimeMode = getRuntimeMode();
  if (runtimeMode === 'legacy' || runtimeMode === 'shadow') {
    return isCodexSessionActive(sessionId);
  }

  return isCodexBridgeSessionActive(sessionId);
}

export function getCodexSessionStartTimeUnified(sessionId) {
  const runtimeMode = getRuntimeMode();
  if (runtimeMode === 'legacy' || runtimeMode === 'shadow') {
    return getCodexSessionStartTime(sessionId);
  }

  return getCodexBridgeSessionStartTime(sessionId);
}

export function getActiveCodexSessionsUnified() {
  const runtimeMode = getRuntimeMode();
  if (runtimeMode === 'legacy' || runtimeMode === 'shadow') {
    return getActiveCodexSessions();
  }

  return getCodexBridgeActiveSessions();
}

export function rebindCodexSessionWriterUnified(sessionId, writer) {
  const runtimeMode = getRuntimeMode();
  if (runtimeMode === 'legacy' || runtimeMode === 'shadow') {
    return rebindCodexSessionWriter(sessionId, writer);
  }

  return rebindCodexBridgeSessionWriter(sessionId, writer);
}

export function getCodexSessionStatusUnified(sessionId) {
  const runtimeMode = getRuntimeMode();
  if (runtimeMode === 'legacy') {
    return {
      sessionId,
      provider: 'codex',
      isProcessing: isCodexSessionActive(sessionId),
      startTime: getCodexSessionStartTime(sessionId),
    };
  }
  if (runtimeMode === 'shadow') {
    const legacyStatus = {
      sessionId,
      provider: 'codex',
      isProcessing: isCodexSessionActive(sessionId),
      startTime: getCodexSessionStartTime(sessionId),
    };
    const bridgeStatus = getCodexBridgeSessionStatus(sessionId);
    recordCodexShadowParityComparison({
      operation: 'status',
      primaryMode: 'legacy',
      secondaryMode: 'bridge',
      primary: {
        ok: true,
        status: 200,
        interrupted: false,
        accepted: false,
        hasTerminalEvent: true,
        terminalState: legacyStatus.isProcessing ? 'running' : 'completed',
        sessionId,
        latencyMs: null,
      },
      secondary: {
        ok: true,
        status: 200,
        interrupted: false,
        accepted: false,
        hasTerminalEvent: true,
        terminalState: bridgeStatus?.isProcessing ? 'running' : 'completed',
        sessionId: bridgeStatus?.sessionId || sessionId,
        latencyMs: null,
      },
      context: {
        sessionId,
      },
    });
    return legacyStatus;
  }

  return getCodexBridgeSessionStatus(sessionId);
}

export function getCodexRuntimeMode() {
  return getCodexRuntimeModeFromEnv();
}
