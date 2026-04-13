import type { QueuedMessageKind } from '../types/types';

type QueuedComposerMessageLike = {
  id: string;
  kind: QueuedMessageKind;
};

type SessionScopedQueuedComposerMessageLike = {
  targetSessionId?: string | null;
};

export type QueueDispatchStatus = 'idle' | 'awaiting_ack' | 'running' | 'paused_manual';

export interface QueueDispatchState {
  status: QueueDispatchStatus;
  activeQueueMessageId: string | null;
  activeClientRequestId: string | null;
  ackAttempts: number;
  maxAckAttempts: number;
}

export const QUEUE_ACK_RETRY_DELAY_MS = 1000;
export const QUEUE_ACK_MAX_ATTEMPTS = 3;

export function createInitialQueueDispatchState(
  maxAckAttempts: number = QUEUE_ACK_MAX_ATTEMPTS,
): QueueDispatchState {
  return {
    status: 'idle',
    activeQueueMessageId: null,
    activeClientRequestId: null,
    ackAttempts: 0,
    maxAckAttempts,
  };
}

export function beginQueueAwaitingAck(
  previous: QueueDispatchState,
  {
    queueMessageId,
    clientRequestId,
    ackAttempts,
  }: {
    queueMessageId: string;
    clientRequestId: string;
    ackAttempts: number;
  },
): QueueDispatchState {
  return {
    ...previous,
    status: 'awaiting_ack',
    activeQueueMessageId: queueMessageId,
    activeClientRequestId: clientRequestId,
    ackAttempts,
  };
}

export function markQueueRunning(previous: QueueDispatchState): QueueDispatchState {
  return {
    ...previous,
    status: 'running',
  };
}

export function pauseQueueForManual(previous: QueueDispatchState): QueueDispatchState {
  return {
    ...previous,
    status: 'paused_manual',
    activeClientRequestId: null,
    activeQueueMessageId: null,
    ackAttempts: 0,
  };
}

export function resetQueueToIdle(previous: QueueDispatchState): QueueDispatchState {
  return {
    ...previous,
    status: 'idle',
    activeClientRequestId: null,
    activeQueueMessageId: null,
    ackAttempts: 0,
  };
}

export function shouldHandleQueueAck(
  state: QueueDispatchState,
  clientRequestId: string | null | undefined,
): boolean {
  return Boolean(
    state.status === 'awaiting_ack'
      && state.activeClientRequestId
      && clientRequestId
      && state.activeClientRequestId === clientRequestId,
  );
}

export function resolveQueueAckDecision(
  state: QueueDispatchState,
  accepted: boolean,
): {
  nextState: QueueDispatchState;
  shouldRetry: boolean;
  shouldPauseToManual: boolean;
} {
  if (accepted) {
    return {
      nextState: markQueueRunning(state),
      shouldRetry: false,
      shouldPauseToManual: false,
    };
  }

  if (state.ackAttempts >= state.maxAckAttempts) {
    return {
      nextState: pauseQueueForManual(state),
      shouldRetry: false,
      shouldPauseToManual: true,
    };
  }

  return {
    nextState: state,
    shouldRetry: true,
    shouldPauseToManual: false,
  };
}

export function resolveQueueAckTimeoutDecision(
  state: QueueDispatchState,
): {
  shouldRetry: boolean;
  shouldPauseToManual: boolean;
  nextState: QueueDispatchState;
} {
  if (state.ackAttempts >= state.maxAckAttempts) {
    return {
      shouldRetry: false,
      shouldPauseToManual: true,
      nextState: pauseQueueForManual(state),
    };
  }

  return {
    shouldRetry: true,
    shouldPauseToManual: false,
    nextState: state,
  };
}

export function resolveQueueTurnCompletion(
  state: QueueDispatchState,
  success: boolean,
): QueueDispatchState {
  if (state.status !== 'running') {
    return state;
  }

  if (success) {
    return resetQueueToIdle(state);
  }

  return pauseQueueForManual(state);
}

export function scheduleQueueAckTimeout(
  onTimeout: () => void,
  delayMs: number = QUEUE_ACK_RETRY_DELAY_MS,
): ReturnType<typeof setTimeout> {
  return setTimeout(onTimeout, delayMs);
}

export function clearQueueAckTimeout(timeoutHandle: ReturnType<typeof setTimeout> | null | undefined): void {
  if (timeoutHandle) {
    clearTimeout(timeoutHandle);
  }
}

export function shouldAutoDispatchQueuedMessage(params: {
  isLoading: boolean;
  dispatchStatus: QueueDispatchStatus;
  queueLength: number;
}): boolean {
  return !params.isLoading && params.dispatchStatus === 'idle' && params.queueLength > 0;
}

export function filterQueuedComposerMessagesBySession<
  T extends SessionScopedQueuedComposerMessageLike,
>(messages: T[], targetSessionId: string | null): T[] {
  return messages.filter((message) => (message.targetSessionId ?? null) === targetSessionId);
}

export function selectNextQueuedComposerMessageForSession<
  T extends QueuedComposerMessageLike & SessionScopedQueuedComposerMessageLike,
>(messages: T[], targetSessionId: string | null): T | null {
  const scoped = filterQueuedComposerMessagesBySession(messages, targetSessionId);
  return selectNextQueuedComposerMessage(scoped);
}

export function selectNextQueuedComposerMessageForAutoDispatch<
  T extends QueuedComposerMessageLike & SessionScopedQueuedComposerMessageLike,
>(messages: T[], preferredSessionId: string | null): T | null {
  if (preferredSessionId) {
    const preferredCandidate = selectNextQueuedComposerMessageForSession(messages, preferredSessionId);
    if (preferredCandidate) {
      return preferredCandidate;
    }
  }

  return selectNextQueuedComposerMessage(messages);
}

export function insertQueuedComposerMessage<T extends QueuedComposerMessageLike>(
  previous: T[],
  message: T,
): T[] {
  const steerMessages = previous.filter((item) => item.kind === 'steer');
  const regularMessages = previous.filter((item) => item.kind === 'queue');

  if (message.kind === 'steer') {
    return [...steerMessages, message, ...regularMessages];
  }

  return [...steerMessages, ...regularMessages, message];
}

export function removeQueuedComposerMessageById<T extends { id: string }>(previous: T[], id: string): T[] {
  return previous.filter((item) => item.id !== id);
}

export function finalizeQueuedComposerMessageDispatch<T extends { id: string }>(
  previous: T[],
  id: string,
  submitted: boolean,
): T[] {
  if (!submitted) {
    return previous;
  }

  return removeQueuedComposerMessageById(previous, id);
}

export function markQueuedComposerMessageAsSteer<T extends QueuedComposerMessageLike>(
  previous: T[],
  id: string,
): T[] {
  const target = previous.find((item) => item.id === id);
  if (!target || target.kind === 'steer') {
    return previous;
  }

  const steerMessages = previous.filter((item) => item.kind === 'steer');
  const regularMessages = previous.filter((item) => item.kind === 'queue' && item.id !== id);
  return [...steerMessages, { ...target, kind: 'steer' }, ...regularMessages];
}

export function selectNextQueuedComposerMessage<T extends QueuedComposerMessageLike>(messages: T[]): T | null {
  if (messages.length === 0) {
    return null;
  }

  return messages.find((item) => item.kind === 'steer')
    || messages.find((item) => item.kind === 'queue')
    || null;
}
