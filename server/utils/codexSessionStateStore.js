function toSessionKey(value) {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function createSessionState() {
  return {
    threadId: null,
    activeTurnId: null,
    provisional: null,
    actualSessionId: null,
    turnByClientTurnId: new Map(),
    lastStatus: 'idle',
    startTime: null,
  };
}

export function createCodexSessionStateStore() {
  const sessions = new Map();
  const threadToSession = new Map();

  const ensureSessionState = (sessionId) => {
    const key = toSessionKey(sessionId);
    if (!key) return null;

    let state = sessions.get(key);
    if (!state) {
      state = createSessionState();
      sessions.set(key, state);
    }
    return state;
  };

  const ensureSession = (sessionId, metadata = {}) => {
    const key = toSessionKey(sessionId);
    if (!key) return null;

    const state = ensureSessionState(key);
    if (!state) return null;

    if (metadata.provisionalSessionId) {
      state.provisional = toSessionKey(metadata.provisionalSessionId);
    }
    if (metadata.threadId) {
      const threadId = toSessionKey(metadata.threadId);
      if (threadId) {
        state.threadId = threadId;
        threadToSession.set(threadId, key);
      }
    }
    if (metadata.actualSessionId) {
      state.actualSessionId = toSessionKey(metadata.actualSessionId);
    }
    if (Number.isFinite(metadata.startTime)) {
      state.startTime = metadata.startTime;
    }

    return key;
  };

  const resolveSessionId = ({ sessionId = null, provisionalSessionId = null, threadId = null } = {}) => {
    const normalizedSessionId = toSessionKey(sessionId);
    if (normalizedSessionId && sessions.has(normalizedSessionId)) {
      return normalizedSessionId;
    }

    const normalizedProvisional = toSessionKey(provisionalSessionId);
    if (normalizedProvisional && sessions.has(normalizedProvisional)) {
      return normalizedProvisional;
    }

    const normalizedThreadId = toSessionKey(threadId);
    if (normalizedThreadId && threadToSession.has(normalizedThreadId)) {
      return threadToSession.get(normalizedThreadId);
    }

    return normalizedSessionId || normalizedProvisional || null;
  };

  const bindThread = (sessionId, threadId) => {
    const normalizedSessionId = ensureSession(sessionId, { threadId });
    if (!normalizedSessionId) {
      return null;
    }

    const normalizedThreadId = toSessionKey(threadId);
    if (!normalizedThreadId) {
      return normalizedSessionId;
    }

    const state = sessions.get(normalizedSessionId);
    state.threadId = normalizedThreadId;
    threadToSession.set(normalizedThreadId, normalizedSessionId);
    return normalizedSessionId;
  };

  const rebindSessionId = ({ provisionalSessionId, actualSessionId, threadId = null } = {}) => {
    const provisional = toSessionKey(provisionalSessionId);
    const actual = toSessionKey(actualSessionId);
    const normalizedThreadId = toSessionKey(threadId);

    if (!actual) {
      return {
        previousSessionId: provisional,
        sessionId: provisional,
      };
    }

    if (!provisional || provisional === actual || !sessions.has(provisional)) {
      ensureSession(actual, {
        provisionalSessionId: provisional,
        threadId: normalizedThreadId,
        actualSessionId: actual,
      });
      return {
        previousSessionId: provisional,
        sessionId: actual,
      };
    }

    const previousState = sessions.get(provisional);
    const nextState = sessions.get(actual) || createSessionState();

    if (!nextState.threadId && previousState.threadId) {
      nextState.threadId = previousState.threadId;
    }
    if (normalizedThreadId) {
      nextState.threadId = normalizedThreadId;
    }
    if (!nextState.activeTurnId && previousState.activeTurnId) {
      nextState.activeTurnId = previousState.activeTurnId;
    }
    if (!nextState.startTime && previousState.startTime) {
      nextState.startTime = previousState.startTime;
    }

    for (const [clientTurnId, turnId] of previousState.turnByClientTurnId.entries()) {
      if (!nextState.turnByClientTurnId.has(clientTurnId)) {
        nextState.turnByClientTurnId.set(clientTurnId, turnId);
      }
    }

    nextState.provisional = provisional;
    nextState.actualSessionId = actual;
    nextState.lastStatus = previousState.lastStatus;

    sessions.set(actual, nextState);
    sessions.delete(provisional);

    if (previousState.threadId && threadToSession.get(previousState.threadId) === provisional) {
      threadToSession.set(previousState.threadId, actual);
    }
    if (nextState.threadId) {
      threadToSession.set(nextState.threadId, actual);
    }

    return {
      previousSessionId: provisional,
      sessionId: actual,
    };
  };

  const setActiveTurn = ({ sessionId = null, threadId = null, turnId = null, clientTurnId = null } = {}) => {
    const resolvedSessionId = resolveSessionId({ sessionId, threadId });
    if (!resolvedSessionId) {
      return null;
    }

    const state = ensureSessionState(resolvedSessionId);
    if (!state) return null;

    const normalizedThreadId = toSessionKey(threadId);
    if (normalizedThreadId) {
      state.threadId = normalizedThreadId;
      threadToSession.set(normalizedThreadId, resolvedSessionId);
    }

    const normalizedTurnId = toSessionKey(turnId);
    state.activeTurnId = normalizedTurnId;

    const normalizedClientTurnId = toSessionKey(clientTurnId);
    if (normalizedClientTurnId && normalizedTurnId) {
      state.turnByClientTurnId.set(normalizedClientTurnId, normalizedTurnId);
    }

    return resolvedSessionId;
  };

  const clearActiveTurn = ({ sessionId = null, threadId = null } = {}) => {
    const resolvedSessionId = resolveSessionId({ sessionId, threadId });
    if (!resolvedSessionId) return null;

    const state = sessions.get(resolvedSessionId);
    if (!state) return resolvedSessionId;

    state.activeTurnId = null;
    return resolvedSessionId;
  };

  const setStatus = ({ sessionId = null, threadId = null, status = null } = {}) => {
    const resolvedSessionId = resolveSessionId({ sessionId, threadId });
    if (!resolvedSessionId) return null;

    const state = ensureSessionState(resolvedSessionId);
    if (!state) return null;

    state.lastStatus = toSessionKey(status) || state.lastStatus;
    return resolvedSessionId;
  };

  const setStartTime = ({ sessionId = null, threadId = null, startTime = null } = {}) => {
    const resolvedSessionId = resolveSessionId({ sessionId, threadId });
    if (!resolvedSessionId) return null;

    const state = ensureSessionState(resolvedSessionId);
    if (!state) return null;

    if (Number.isFinite(startTime)) {
      state.startTime = startTime;
    }

    return resolvedSessionId;
  };

  const getActiveTurnId = ({ sessionId = null, threadId = null } = {}) => {
    const resolvedSessionId = resolveSessionId({ sessionId, threadId });
    if (!resolvedSessionId) return null;

    const state = sessions.get(resolvedSessionId);
    if (!state) return null;

    return state.activeTurnId || null;
  };

  const getStateSnapshot = ({ sessionId = null, threadId = null } = {}) => {
    const resolvedSessionId = resolveSessionId({ sessionId, threadId });
    if (!resolvedSessionId) return null;

    const state = sessions.get(resolvedSessionId);
    if (!state) return null;

    return {
      sessionId: resolvedSessionId,
      threadId: state.threadId,
      activeTurnId: state.activeTurnId,
      provisionalSessionId: state.provisional,
      actualSessionId: state.actualSessionId,
      status: state.lastStatus,
      isProcessing: state.lastStatus === 'running' || state.lastStatus === 'interrupting',
      startTime: state.startTime,
    };
  };

  const listActiveSessions = () => {
    const active = [];
    for (const [sessionId, state] of sessions.entries()) {
      if (state.lastStatus === 'running' || state.lastStatus === 'interrupting') {
        active.push({
          id: sessionId,
          status: state.lastStatus,
          startTime: state.startTime,
          threadId: state.threadId,
          activeTurnId: state.activeTurnId,
        });
      }
    }
    return active;
  };

  const deleteSession = (sessionId) => {
    const normalizedSessionId = toSessionKey(sessionId);
    if (!normalizedSessionId) return;

    const state = sessions.get(normalizedSessionId);
    if (!state) return;

    if (state.threadId && threadToSession.get(state.threadId) === normalizedSessionId) {
      threadToSession.delete(state.threadId);
    }
    sessions.delete(normalizedSessionId);
  };

  return {
    ensureSession,
    bindThread,
    rebindSessionId,
    resolveSessionId,
    setActiveTurn,
    clearActiveTurn,
    setStatus,
    setStartTime,
    getActiveTurnId,
    getStateSnapshot,
    listActiveSessions,
    deleteSession,
  };
}
