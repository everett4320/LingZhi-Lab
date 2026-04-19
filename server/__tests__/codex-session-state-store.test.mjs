import { describe, expect, it } from 'vitest';

import { createCodexSessionStateStore } from '../utils/codexSessionStateStore.js';

describe('codex session state store', () => {
  it('rebinds provisional session id to actual thread id', () => {
    const store = createCodexSessionStateStore();

    const provisional = store.ensureSession('new-session-1', {
      provisionalSessionId: 'new-session-1',
      startTime: 100,
    });
    store.bindThread(provisional, 'thread-A');
    store.setActiveTurn({
      sessionId: provisional,
      threadId: 'thread-A',
      turnId: 'turn-1',
      clientTurnId: 'client-turn-1',
    });

    const rebound = store.rebindSessionId({
      provisionalSessionId: provisional,
      actualSessionId: 'thread-A',
      threadId: 'thread-A',
    });

    expect(rebound).toEqual({
      previousSessionId: 'new-session-1',
      sessionId: 'thread-A',
    });

    expect(store.getStateSnapshot({ sessionId: 'thread-A' })).toEqual({
      sessionId: 'thread-A',
      threadId: 'thread-A',
      activeTurnId: 'turn-1',
      provisionalSessionId: 'new-session-1',
      actualSessionId: 'thread-A',
      status: 'idle',
      isProcessing: false,
      startTime: 100,
    });
  });

  it('tracks running sessions for active list', () => {
    const store = createCodexSessionStateStore();

    const sessionId = store.ensureSession('session-1', { startTime: 1234 });
    store.bindThread(sessionId, 'thread-1');
    store.setActiveTurn({ sessionId, threadId: 'thread-1', turnId: 'turn-2' });
    store.setStatus({ sessionId, status: 'running' });

    expect(store.listActiveSessions()).toEqual([
      {
        id: 'session-1',
        status: 'running',
        startTime: 1234,
        threadId: 'thread-1',
        activeTurnId: 'turn-2',
      },
    ]);

    store.clearActiveTurn({ sessionId });
    store.setStatus({ sessionId, status: 'completed' });
    expect(store.listActiveSessions()).toEqual([]);
  });
});
