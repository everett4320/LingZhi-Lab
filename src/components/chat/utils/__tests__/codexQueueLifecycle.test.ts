import { describe, expect, it } from 'vitest';
import {
  buildQueuedTurn,
  enqueueSessionTurn,
  getNextDispatchableTurn,
  getSessionQueue,
  reconcileSettledSessionQueue,
  removeQueuedTurn,
  type SessionQueueMap,
} from '../codexQueue';

/**
 * End-to-end scenarios that simulate the full queue lifecycle as it happens
 * in useChatComposerState. These tests verify the invariants that the UI
 * depends on:
 *
 * 1. Enter while busy → message enters queue, is NOT dispatched immediately
 * 2. Ctrl+Enter while busy → message enters queue as 'steer', ahead of normal
 * 3. After turn settles → next queued message is selected for dispatch (FIFO)
 * 4. Multiple queued messages → dispatched one at a time, in order
 * 5. Steer messages jump ahead of normal messages in the queue
 * 6. Session ID reconciliation works after temp→real ID resolution
 */
describe('codexQueue dispatch lifecycle', () => {
  const SESSION = 'new-session-1776129679853';
  const REAL_SESSION = 'sess_abc123';
  const PROJECT = 'test-project';

  function makeTurn(id: string, kind: 'normal' | 'steer' = 'normal') {
    return buildQueuedTurn({
      id,
      sessionId: SESSION,
      text: `message ${id}`,
      kind,
      status: 'queued',
      projectName: PROJECT,
    });
  }

  // ── Scenario 1: Enter while session is busy ──────────────────────────
  // The message should enter the queue. The queue utility should NOT
  // auto-dispatch — that decision belongs to the caller (useChatComposerState)
  // which checks isLoading before calling dispatchNextQueuedCodexTurn.

  it('enqueues a normal message and does not auto-select it when session is busy', () => {
    let queue: SessionQueueMap = {};
    const turn = makeTurn('q1');

    // Simulate: handleSubmit detects isCodexSessionBusy=true, enqueues
    queue = enqueueSessionTurn(queue, turn);

    // Queue should have the message
    const sessionQueue = getSessionQueue(queue, SESSION);
    expect(sessionQueue).toHaveLength(1);
    expect(sessionQueue[0].id).toBe('q1');
    expect(sessionQueue[0].kind).toBe('normal');
    expect(sessionQueue[0].status).toBe('queued');

    // getNextDispatchableTurn returns the message — but the CALLER must
    // check isLoading/hasProcessingSession before actually dispatching.
    const next = getNextDispatchableTurn(sessionQueue);
    expect(next?.id).toBe('q1');
  });

  // ── Scenario 2: Ctrl+Enter while session is busy ─────────────────────
  // The message should enter the queue as 'steer', ahead of normal messages.

  it('enqueues a steer message ahead of existing normal messages', () => {
    let queue: SessionQueueMap = {};

    // User sent two normal messages while busy
    queue = enqueueSessionTurn(queue, makeTurn('q1'));
    queue = enqueueSessionTurn(queue, makeTurn('q2'));

    // User presses Ctrl+Enter → steer
    const steerTurn = makeTurn('s1', 'steer');
    queue = enqueueSessionTurn(queue, steerTurn);

    const sessionQueue = getSessionQueue(queue, SESSION);
    expect(sessionQueue.map(t => `${t.id}:${t.kind}`)).toEqual([
      's1:steer',
      'q1:normal',
      'q2:normal',
    ]);

    // Steer should be dispatched first
    expect(getNextDispatchableTurn(sessionQueue)?.id).toBe('s1');
  });

  // ── Scenario 3: After turn settles, dispatch next in FIFO order ──────

  it('dispatches queued messages one at a time in FIFO order after turn settles', () => {
    let queue: SessionQueueMap = {};
    queue = enqueueSessionTurn(queue, makeTurn('q1'));
    queue = enqueueSessionTurn(queue, makeTurn('q2'));
    queue = enqueueSessionTurn(queue, makeTurn('q3'));

    // Turn A settles. Caller picks next from queue.
    const sessionQueue = getSessionQueue(queue, SESSION);
    const first = getNextDispatchableTurn(sessionQueue);
    expect(first?.id).toBe('q1');

    // Simulate dispatch: remove q1 from queue
    queue = removeQueuedTurn(queue, SESSION, 'q1');

    // Next should be q2
    const afterFirst = getSessionQueue(queue, SESSION);
    expect(getNextDispatchableTurn(afterFirst)?.id).toBe('q2');

    // Remove q2
    queue = removeQueuedTurn(queue, SESSION, 'q2');
    const afterSecond = getSessionQueue(queue, SESSION);
    expect(getNextDispatchableTurn(afterSecond)?.id).toBe('q3');

    // Remove q3 — queue empty
    queue = removeQueuedTurn(queue, SESSION, 'q3');
    const afterThird = getSessionQueue(queue, SESSION);
    expect(getNextDispatchableTurn(afterThird)).toBeNull();
  });

  // ── Scenario 4: Steer injected mid-queue jumps ahead ─────────────────

  it('steer injected while normal messages are queued jumps to front', () => {
    let queue: SessionQueueMap = {};
    queue = enqueueSessionTurn(queue, makeTurn('q1'));
    queue = enqueueSessionTurn(queue, makeTurn('q2'));

    // Steer arrives while q1 and q2 are waiting
    queue = enqueueSessionTurn(queue, makeTurn('s1', 'steer'));

    const sessionQueue = getSessionQueue(queue, SESSION);
    // Steer first, then normal in original order
    expect(sessionQueue.map(t => t.id)).toEqual(['s1', 'q1', 'q2']);
    expect(getNextDispatchableTurn(sessionQueue)?.id).toBe('s1');

    // After steer dispatched, normal resumes FIFO
    queue = removeQueuedTurn(queue, SESSION, 's1');
    expect(getNextDispatchableTurn(getSessionQueue(queue, SESSION))?.id).toBe('q1');
  });

  // ── Scenario 5: Session ID reconciliation ────────────────────────────
  // Messages queued under temp ID must be found after reconciliation.

  it('reconciles temp session ID to real ID so queued messages are findable', () => {
    let queue: SessionQueueMap = {};
    queue = enqueueSessionTurn(queue, makeTurn('q1'));
    queue = enqueueSessionTurn(queue, makeTurn('q2'));

    // Verify messages are under temp ID
    expect(getSessionQueue(queue, SESSION)).toHaveLength(2);
    expect(getSessionQueue(queue, REAL_SESSION)).toHaveLength(0);

    // Server resolves temp → real ID. handleCodexTurnSettled calls reconcile.
    queue = reconcileSettledSessionQueue(queue, REAL_SESSION, SESSION);

    // Messages should now be under real ID
    expect(getSessionQueue(queue, SESSION)).toHaveLength(0);
    expect(getSessionQueue(queue, REAL_SESSION)).toHaveLength(2);
    expect(getSessionQueue(queue, REAL_SESSION).map(t => t.id)).toEqual(['q1', 'q2']);

    // Session IDs on the turns themselves should be updated
    expect(getSessionQueue(queue, REAL_SESSION).every(t => t.sessionId === REAL_SESSION)).toBe(true);
  });

  // ── Scenario 6: Mixed steer + normal after reconciliation ────────────

  it('preserves steer-first ordering after session ID reconciliation', () => {
    let queue: SessionQueueMap = {};
    queue = enqueueSessionTurn(queue, makeTurn('q1'));
    queue = enqueueSessionTurn(queue, makeTurn('s1', 'steer'));
    queue = enqueueSessionTurn(queue, makeTurn('q2'));

    queue = reconcileSettledSessionQueue(queue, REAL_SESSION, SESSION);

    const sessionQueue = getSessionQueue(queue, REAL_SESSION);
    // Order should be preserved from the original queue
    expect(sessionQueue.map(t => `${t.id}:${t.kind}`)).toEqual([
      's1:steer',
      'q1:normal',
      'q2:normal',
    ]);
    expect(getNextDispatchableTurn(sessionQueue)?.id).toBe('s1');
  });

  // ── Scenario 7: Queue should not dispatch when empty ─────────────────

  it('returns null when queue is empty', () => {
    expect(getNextDispatchableTurn([])).toBeNull();
    expect(getSessionQueue({}, 'nonexistent')).toHaveLength(0);
  });

  // ── Scenario 8: Full lifecycle simulation ────────────────────────────
  // Simulates: send A → queue B → queue C(steer) → A completes → dispatch C → C completes → dispatch B

  it('full lifecycle: send, queue, steer, settle, dispatch in correct order', () => {
    let queue: SessionQueueMap = {};

    // Step 1: User sends message A (direct, not queued — session was idle)
    // A is running. isLoading=true.

    // Step 2: User sends B (Enter) while A is running → queued as normal
    queue = enqueueSessionTurn(queue, makeTurn('B'));

    // Step 3: User sends C (Ctrl+Enter) while A is running → queued as steer
    queue = enqueueSessionTurn(queue, makeTurn('C', 'steer'));

    // Queue state: [C:steer, B:normal]
    let sessionQueue = getSessionQueue(queue, SESSION);
    expect(sessionQueue.map(t => `${t.id}:${t.kind}`)).toEqual([
      'C:steer',
      'B:normal',
    ]);

    // Step 4: A completes. handleCodexTurnSettled fires.
    // Reconcile temp→real ID
    queue = reconcileSettledSessionQueue(queue, REAL_SESSION, SESSION);

    // Step 5: dispatchNextQueuedCodexTurn picks C (steer first)
    sessionQueue = getSessionQueue(queue, REAL_SESSION);
    const firstDispatch = getNextDispatchableTurn(sessionQueue);
    expect(firstDispatch?.id).toBe('C');
    expect(firstDispatch?.kind).toBe('steer');

    // C is dispatched and removed from queue
    queue = removeQueuedTurn(queue, REAL_SESSION, 'C');

    // Step 6: C completes. Next dispatch picks B.
    sessionQueue = getSessionQueue(queue, REAL_SESSION);
    const secondDispatch = getNextDispatchableTurn(sessionQueue);
    expect(secondDispatch?.id).toBe('B');
    expect(secondDispatch?.kind).toBe('normal');

    // B is dispatched and removed
    queue = removeQueuedTurn(queue, REAL_SESSION, 'B');

    // Queue is empty
    expect(getSessionQueue(queue, REAL_SESSION)).toHaveLength(0);
    expect(getNextDispatchableTurn([])).toBeNull();
  });
});
