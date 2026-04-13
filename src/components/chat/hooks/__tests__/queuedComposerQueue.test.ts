import { afterEach, describe, expect, it, vi } from 'vitest';
import type { QueuedMessageKind } from '../../types/types';
import {
  QUEUE_ACK_MAX_ATTEMPTS,
  QUEUE_ACK_RETRY_DELAY_MS,
  beginQueueAwaitingAck,
  clearQueueAckTimeout,
  createInitialQueueDispatchState,
  finalizeQueuedComposerMessageDispatch,
  insertQueuedComposerMessage,
  markQueuedComposerMessageAsSteer,
  removeQueuedComposerMessageById,
  resolveQueueAckDecision,
  resolveQueueAckTimeoutDecision,
  resolveQueueTurnCompletion,
  scheduleQueueAckTimeout,
  selectNextQueuedComposerMessage,
  shouldHandleQueueAck,
} from '../queuedComposerQueue';

type QueueItem = {
  id: string;
  kind: QueuedMessageKind;
  content: string;
};

const queueItem = (id: string, kind: QueuedMessageKind): QueueItem => ({
  id,
  kind,
  content: id,
});

afterEach(() => {
  vi.useRealTimers();
});

describe('queuedComposerQueue', () => {
  it('inserts steer messages ahead of regular queued messages', () => {
    const previous = [
      queueItem('steer-1', 'steer'),
      queueItem('queue-1', 'queue'),
      queueItem('queue-2', 'queue'),
    ];

    const next = insertQueuedComposerMessage(previous, queueItem('steer-2', 'steer'));

    expect(next.map((item) => item.id)).toEqual(['steer-1', 'steer-2', 'queue-1', 'queue-2']);
  });

  it('appends regular queue messages after existing steer and queue groups', () => {
    const previous = [
      queueItem('steer-1', 'steer'),
      queueItem('queue-1', 'queue'),
    ];

    const next = insertQueuedComposerMessage(previous, queueItem('queue-2', 'queue'));

    expect(next.map((item) => item.id)).toEqual(['steer-1', 'queue-1', 'queue-2']);
  });

  it('promotes a queued message to steer while preserving steer-first ordering', () => {
    const previous = [
      queueItem('steer-1', 'steer'),
      queueItem('queue-1', 'queue'),
      queueItem('queue-2', 'queue'),
    ];

    const next = markQueuedComposerMessageAsSteer(previous, 'queue-2');

    expect(next.map((item) => `${item.id}:${item.kind}`)).toEqual([
      'steer-1:steer',
      'queue-2:steer',
      'queue-1:queue',
    ]);
  });

  it('selects steer first for auto-dispatch, then regular queue', () => {
    const messages = [
      queueItem('queue-1', 'queue'),
      queueItem('steer-1', 'steer'),
      queueItem('queue-2', 'queue'),
    ];

    const next = selectNextQueuedComposerMessage(messages);

    expect(next?.id).toBe('steer-1');
  });

  it('returns null when there is no queued message to dispatch', () => {
    expect(selectNextQueuedComposerMessage([])).toBeNull();
  });

  it('keeps the queued message when auto-dispatch did not submit', () => {
    const previous = [queueItem('queue-1', 'queue')];

    const next = finalizeQueuedComposerMessageDispatch(previous, 'queue-1', false);

    expect(next).toBe(previous);
    expect(next.map((item) => item.id)).toEqual(['queue-1']);
  });

  it('removes the queued message when auto-dispatch submitted successfully', () => {
    const previous = [queueItem('queue-1', 'queue'), queueItem('queue-2', 'queue')];

    const next = finalizeQueuedComposerMessageDispatch(previous, 'queue-1', true);

    expect(next.map((item) => item.id)).toEqual(['queue-2']);
  });

  it('removes a queued message by id', () => {
    const previous = [queueItem('queue-1', 'queue'), queueItem('queue-2', 'queue')];

    const next = removeQueuedComposerMessageById(previous, 'queue-2');

    expect(next.map((item) => item.id)).toEqual(['queue-1']);
  });

  it('matches ACK only when requestId equals active request in awaiting state', () => {
    const awaiting = beginQueueAwaitingAck(createInitialQueueDispatchState(), {
      queueMessageId: 'queue-1',
      clientRequestId: 'req-1',
      ackAttempts: 1,
    });

    expect(shouldHandleQueueAck(awaiting, 'req-1')).toBe(true);
    expect(shouldHandleQueueAck(awaiting, 'req-2')).toBe(false);
    expect(shouldHandleQueueAck(awaiting, null)).toBe(false);
  });

  it('moves to running when ACK accepted', () => {
    const awaiting = beginQueueAwaitingAck(createInitialQueueDispatchState(), {
      queueMessageId: 'queue-1',
      clientRequestId: 'req-1',
      ackAttempts: 1,
    });

    const decision = resolveQueueAckDecision(awaiting, true);

    expect(decision.shouldRetry).toBe(false);
    expect(decision.shouldPauseToManual).toBe(false);
    expect(decision.nextState.status).toBe('running');
  });

  it('requests retry when ACK rejected before max attempts', () => {
    const awaiting = beginQueueAwaitingAck(createInitialQueueDispatchState(), {
      queueMessageId: 'queue-1',
      clientRequestId: 'req-1',
      ackAttempts: 1,
    });

    const decision = resolveQueueAckDecision(awaiting, false);

    expect(decision.shouldRetry).toBe(true);
    expect(decision.shouldPauseToManual).toBe(false);
    expect(decision.nextState.status).toBe('awaiting_ack');
  });

  it('pauses manual when ACK rejected at max attempts', () => {
    const awaiting = beginQueueAwaitingAck(createInitialQueueDispatchState(), {
      queueMessageId: 'queue-1',
      clientRequestId: 'req-1',
      ackAttempts: QUEUE_ACK_MAX_ATTEMPTS,
    });

    const decision = resolveQueueAckDecision(awaiting, false);

    expect(decision.shouldRetry).toBe(false);
    expect(decision.shouldPauseToManual).toBe(true);
    expect(decision.nextState.status).toBe('paused_manual');
  });

  it('pauses manual when ACK timeout reaches max attempts', () => {
    const awaiting = beginQueueAwaitingAck(createInitialQueueDispatchState(), {
      queueMessageId: 'queue-1',
      clientRequestId: 'req-1',
      ackAttempts: QUEUE_ACK_MAX_ATTEMPTS,
    });

    const decision = resolveQueueAckTimeoutDecision(awaiting);

    expect(decision.shouldRetry).toBe(false);
    expect(decision.shouldPauseToManual).toBe(true);
    expect(decision.nextState.status).toBe('paused_manual');
  });

  it('resets to idle after running turn success and pauses on running turn error', () => {
    const runningState = resolveQueueAckDecision(
      beginQueueAwaitingAck(createInitialQueueDispatchState(), {
        queueMessageId: 'queue-1',
        clientRequestId: 'req-1',
        ackAttempts: 1,
      }),
      true,
    ).nextState;

    const successState = resolveQueueTurnCompletion(runningState, true);
    const errorState = resolveQueueTurnCompletion(runningState, false);

    expect(successState.status).toBe('idle');
    expect(errorState.status).toBe('paused_manual');
  });

  it('fires ACK timeout callback on schedule with fake timers', () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();

    scheduleQueueAckTimeout(onTimeout, QUEUE_ACK_RETRY_DELAY_MS);
    expect(onTimeout).not.toHaveBeenCalled();

    vi.advanceTimersByTime(QUEUE_ACK_RETRY_DELAY_MS - 1);
    expect(onTimeout).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('does not fire ACK timeout callback after timer is cleared', () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();

    const timeout = scheduleQueueAckTimeout(onTimeout, QUEUE_ACK_RETRY_DELAY_MS);
    clearQueueAckTimeout(timeout);

    vi.advanceTimersByTime(QUEUE_ACK_RETRY_DELAY_MS + 10);
    expect(onTimeout).not.toHaveBeenCalled();
  });
});
