import { describe, expect, it } from 'vitest';
import type { QueuedMessageKind } from '../../types/types';
import {
  beginQueueAwaitingAck,
  createInitialQueueDispatchState,
  filterQueuedComposerMessagesBySession,
  insertQueuedComposerMessage,
  removeQueuedComposerMessageById,
  resolveQueueAckDecision,
  resolveQueueAckTimeoutDecision,
  resolveQueueTurnCompletion,
  selectNextQueuedComposerMessageForAutoDispatch,
  selectNextQueuedComposerMessageForSession,
  selectNextQueuedComposerMessage,
  shouldAutoDispatchQueuedMessage,
  shouldHandleQueueAck,
} from '../queuedComposerQueue';

type QueueItem = {
  id: string;
  kind: QueuedMessageKind;
};

const queueItem = (id: string, kind: QueuedMessageKind): QueueItem => ({ id, kind });

describe('queuedComposerQueue end-to-end scenarios', () => {
  it('dispatches strictly serially: ACK success + turn success before next queue starts', () => {
    const q1 = queueItem('q1', 'queue');
    const q2 = queueItem('q2', 'queue');
    let queue = [q1, q2];
    let dispatch = createInitialQueueDispatchState();

    expect(shouldAutoDispatchQueuedMessage({ isLoading: false, dispatchStatus: dispatch.status, queueLength: queue.length })).toBe(true);
    const firstHead = selectNextQueuedComposerMessage(queue);
    expect(firstHead?.id).toBe('q1');

    dispatch = beginQueueAwaitingAck(dispatch, {
      queueMessageId: q1.id,
      clientRequestId: 'req-1',
      ackAttempts: 1,
    });
    expect(shouldAutoDispatchQueuedMessage({ isLoading: false, dispatchStatus: dispatch.status, queueLength: queue.length })).toBe(false);

    const ack1 = resolveQueueAckDecision(dispatch, true);
    dispatch = ack1.nextState;
    queue = removeQueuedComposerMessageById(queue, q1.id);

    expect(dispatch.status).toBe('running');
    expect(queue.map((item) => item.id)).toEqual(['q2']);

    dispatch = resolveQueueTurnCompletion(dispatch, true);
    expect(dispatch.status).toBe('idle');
    expect(shouldAutoDispatchQueuedMessage({ isLoading: false, dispatchStatus: dispatch.status, queueLength: queue.length })).toBe(true);

    const secondHead = selectNextQueuedComposerMessage(queue);
    expect(secondHead?.id).toBe('q2');
  });

  it('retries timeout twice, then pauses on third timeout and stops auto-dispatch', () => {
    let dispatch = createInitialQueueDispatchState();

    dispatch = beginQueueAwaitingAck(dispatch, {
      queueMessageId: 'q1',
      clientRequestId: 'req-1',
      ackAttempts: 1,
    });
    expect(resolveQueueAckTimeoutDecision(dispatch).shouldRetry).toBe(true);

    dispatch = beginQueueAwaitingAck(dispatch, {
      queueMessageId: 'q1',
      clientRequestId: 'req-2',
      ackAttempts: 2,
    });
    expect(resolveQueueAckTimeoutDecision(dispatch).shouldRetry).toBe(true);

    dispatch = beginQueueAwaitingAck(dispatch, {
      queueMessageId: 'q1',
      clientRequestId: 'req-3',
      ackAttempts: 3,
    });
    const thirdTimeout = resolveQueueAckTimeoutDecision(dispatch);
    dispatch = thirdTimeout.nextState;

    expect(thirdTimeout.shouldRetry).toBe(false);
    expect(thirdTimeout.shouldPauseToManual).toBe(true);
    expect(dispatch.status).toBe('paused_manual');
    expect(shouldAutoDispatchQueuedMessage({ isLoading: false, dispatchStatus: dispatch.status, queueLength: 2 })).toBe(false);
  });

  it('ignores stale ACK after retry rotates clientRequestId', () => {
    let dispatch = beginQueueAwaitingAck(createInitialQueueDispatchState(), {
      queueMessageId: 'q1',
      clientRequestId: 'req-1',
      ackAttempts: 1,
    });

    const rejected = resolveQueueAckDecision(dispatch, false);
    expect(rejected.shouldRetry).toBe(true);
    dispatch = beginQueueAwaitingAck(dispatch, {
      queueMessageId: 'q1',
      clientRequestId: 'req-2',
      ackAttempts: 2,
    });

    expect(shouldHandleQueueAck(dispatch, 'req-1')).toBe(false);
    expect(shouldHandleQueueAck(dispatch, 'req-2')).toBe(true);
  });

  it('on running turn error, pauses and next drafted item should be steer-first', () => {
    const running = resolveQueueAckDecision(
      beginQueueAwaitingAck(createInitialQueueDispatchState(), {
        queueMessageId: 'q-head',
        clientRequestId: 'req-head',
        ackAttempts: 1,
      }),
      true,
    ).nextState;

    const errored = resolveQueueTurnCompletion(running, false);
    expect(errored.status).toBe('paused_manual');

    const mixedQueue = [
      queueItem('queue-2', 'queue'),
      queueItem('steer-1', 'steer'),
      queueItem('queue-3', 'queue'),
    ];

    const draftCandidate = selectNextQueuedComposerMessage(mixedQueue);
    expect(draftCandidate?.id).toBe('steer-1');
    expect(draftCandidate?.kind).toBe('steer');
  });

  it('does not auto-dispatch while loading, while awaiting_ack, while running, or while paused', () => {
    expect(shouldAutoDispatchQueuedMessage({ isLoading: true, dispatchStatus: 'idle', queueLength: 1 })).toBe(false);
    expect(shouldAutoDispatchQueuedMessage({ isLoading: false, dispatchStatus: 'awaiting_ack', queueLength: 1 })).toBe(false);
    expect(shouldAutoDispatchQueuedMessage({ isLoading: false, dispatchStatus: 'running', queueLength: 1 })).toBe(false);
    expect(shouldAutoDispatchQueuedMessage({ isLoading: false, dispatchStatus: 'paused_manual', queueLength: 1 })).toBe(false);
    expect(shouldAutoDispatchQueuedMessage({ isLoading: false, dispatchStatus: 'idle', queueLength: 0 })).toBe(false);
    expect(shouldAutoDispatchQueuedMessage({ isLoading: false, dispatchStatus: 'idle', queueLength: 2 })).toBe(true);
  });

  it('scopes visible queue list by target session id', () => {
    const queue = [
      { ...queueItem('a-1', 'queue'), targetSessionId: 'session-a' },
      { ...queueItem('b-1', 'queue'), targetSessionId: 'session-b' },
      { ...queueItem('a-2', 'steer'), targetSessionId: 'session-a' },
      { ...queueItem('none-1', 'queue'), targetSessionId: null },
    ];

    const scopedA = filterQueuedComposerMessagesBySession(queue, 'session-a');
    const scopedB = filterQueuedComposerMessagesBySession(queue, 'session-b');
    const scopedNull = filterQueuedComposerMessagesBySession(queue, null);

    expect(scopedA.map((item) => item.id)).toEqual(['a-1', 'a-2']);
    expect(scopedB.map((item) => item.id)).toEqual(['b-1']);
    expect(scopedNull.map((item) => item.id)).toEqual(['none-1']);
  });

  it('handles realistic mixed queue ordering with steer injection mid-flight', () => {
    let queue: QueueItem[] = [];
    queue = insertQueuedComposerMessage(queue, queueItem('queue-1', 'queue'));
    queue = insertQueuedComposerMessage(queue, queueItem('queue-2', 'queue'));
    queue = insertQueuedComposerMessage(queue, queueItem('steer-urgent', 'steer'));
    queue = insertQueuedComposerMessage(queue, queueItem('queue-3', 'queue'));

    expect(queue.map((item) => `${item.id}:${item.kind}`)).toEqual([
      'steer-urgent:steer',
      'queue-1:queue',
      'queue-2:queue',
      'queue-3:queue',
    ]);

    const firstDispatch = selectNextQueuedComposerMessage(queue);
    expect(firstDispatch?.id).toBe('steer-urgent');

    queue = removeQueuedComposerMessageById(queue, 'steer-urgent');
    const secondDispatch = selectNextQueuedComposerMessage(queue);
    expect(secondDispatch?.id).toBe('queue-1');
  });

  it('prefers dispatching from the just-finished session before other sessions', () => {
    const queue = [
      { ...queueItem('a-1', 'queue'), targetSessionId: 'session-a' },
      { ...queueItem('b-steer', 'steer'), targetSessionId: 'session-b' },
      { ...queueItem('a-2', 'queue'), targetSessionId: 'session-a' },
    ];

    const preferredA = selectNextQueuedComposerMessageForAutoDispatch(queue, 'session-a');
    expect(preferredA?.id).toBe('a-1');
    expect(preferredA?.targetSessionId).toBe('session-a');
  });

  it('falls back to global queue selection when preferred session has no queued messages', () => {
    const queue = [
      { ...queueItem('b-1', 'queue'), targetSessionId: 'session-b' },
      { ...queueItem('b-steer', 'steer'), targetSessionId: 'session-b' },
      { ...queueItem('null-1', 'queue'), targetSessionId: null },
    ];

    const fallback = selectNextQueuedComposerMessageForAutoDispatch(queue, 'session-a');
    expect(fallback?.id).toBe('b-steer');
    expect(fallback?.targetSessionId).toBe('session-b');
  });

  it('selects next queued item inside one session with steer-first ordering', () => {
    const queue = [
      { ...queueItem('a-queue-1', 'queue'), targetSessionId: 'session-a' },
      { ...queueItem('b-steer', 'steer'), targetSessionId: 'session-b' },
      { ...queueItem('a-steer', 'steer'), targetSessionId: 'session-a' },
      { ...queueItem('a-queue-2', 'queue'), targetSessionId: 'session-a' },
    ];

    const nextInA = selectNextQueuedComposerMessageForSession(queue, 'session-a');
    const nextInB = selectNextQueuedComposerMessageForSession(queue, 'session-b');
    const nextInNull = selectNextQueuedComposerMessageForSession(queue, null);

    expect(nextInA?.id).toBe('a-steer');
    expect(nextInB?.id).toBe('b-steer');
    expect(nextInNull).toBeNull();
  });
});
