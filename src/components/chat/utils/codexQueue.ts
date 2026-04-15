import type { QueuedTurn, QueuedTurnKind, QueuedTurnStatus } from '../types/types';

export type SessionQueueMap = Record<string, QueuedTurn[]>;

type BuildQueuedTurnArgs = {
  id: string;
  sessionId: string;
  text: string;
  kind: QueuedTurnKind;
  status?: QueuedTurnStatus;
  createdAt?: number;
  projectName?: string;
  projectPath?: string;
  sessionMode?: 'research' | 'workspace_qa';
};

export function buildQueuedTurn({
  id,
  sessionId,
  text,
  kind,
  status = 'queued',
  createdAt = Date.now(),
  projectName,
  projectPath,
  sessionMode,
}: BuildQueuedTurnArgs): QueuedTurn {
  return {
    id,
    sessionId,
    text,
    kind,
    status,
    createdAt,
    projectName,
    projectPath,
    sessionMode,
  };
}

export function getSessionQueue(queueBySession: SessionQueueMap, sessionId?: string | null): QueuedTurn[] {
  if (!sessionId) {
    return [];
  }
  return queueBySession[sessionId] || [];
}

function insertSteerTurn(queue: QueuedTurn[], turn: QueuedTurn): QueuedTurn[] {
  const firstNormalIndex = queue.findIndex((candidate) => candidate.kind === 'normal');
  if (firstNormalIndex === -1) {
    return [...queue, turn];
  }
  return [
    ...queue.slice(0, firstNormalIndex),
    turn,
    ...queue.slice(firstNormalIndex),
  ];
}

export function enqueueSessionTurn(queueBySession: SessionQueueMap, turn: QueuedTurn): SessionQueueMap {
  const currentQueue = getSessionQueue(queueBySession, turn.sessionId);
  if (turn.kind === 'steer') {
    return {
      ...queueBySession,
      [turn.sessionId]: insertSteerTurn(currentQueue, turn),
    };
  }
  return {
    ...queueBySession,
    [turn.sessionId]: [...currentQueue, turn],
  };
}

export function removeQueuedTurn(
  queueBySession: SessionQueueMap,
  sessionId: string,
  turnId: string,
): SessionQueueMap {
  const queue = getSessionQueue(queueBySession, sessionId);
  const nextQueue = queue.filter((turn) => turn.id !== turnId);
  if (nextQueue.length === 0) {
    const { [sessionId]: _removed, ...rest } = queueBySession;
    return rest;
  }
  return {
    ...queueBySession,
    [sessionId]: nextQueue,
  };
}

export function setSessionQueueStatus(
  queueBySession: SessionQueueMap,
  sessionId: string,
  status: QueuedTurnStatus,
): SessionQueueMap {
  const queue = getSessionQueue(queueBySession, sessionId);
  if (queue.length === 0) {
    return queueBySession;
  }
  return {
    ...queueBySession,
    [sessionId]: queue.map((turn) => ({ ...turn, status })),
  };
}

export function promoteQueuedTurnToSteer(
  queueBySession: SessionQueueMap,
  sessionId: string,
  turnId: string,
): SessionQueueMap {
  const queue = getSessionQueue(queueBySession, sessionId);
  if (queue.length === 0) {
    return queueBySession;
  }

  const targetTurn = queue.find((turn) => turn.id === turnId);
  if (!targetTurn) {
    return queueBySession;
  }

  const promotedTurn: QueuedTurn = {
    ...targetTurn,
    kind: 'steer',
  };
  const remainingTurns = queue.filter((turn) => turn.id !== turnId);

  return {
    ...queueBySession,
    [sessionId]: insertSteerTurn(remainingTurns, promotedTurn),
  };
}

export function getNextDispatchableTurn(queue: QueuedTurn[]): QueuedTurn | null {
  const steerTurn = queue.find((turn) => turn.status === 'queued' && turn.kind === 'steer');
  if (steerTurn) {
    return steerTurn;
  }
  return queue.find((turn) => turn.status === 'queued' && turn.kind === 'normal') || null;
}

export function demoteSteerTurnToNormal(
  queueBySession: SessionQueueMap,
  sessionId: string,
  turnId: string,
): SessionQueueMap {
  const queue = getSessionQueue(queueBySession, sessionId);
  if (queue.length === 0) {
    return queueBySession;
  }

  const targetTurn = queue.find((turn) => turn.id === turnId);
  if (!targetTurn || targetTurn.kind !== 'steer') {
    return queueBySession;
  }

  const demotedTurn: QueuedTurn = { ...targetTurn, kind: 'normal' };
  const remainingTurns = queue.filter((turn) => turn.id !== turnId);

  // Append to end of queue (back to normal position)
  return {
    ...queueBySession,
    [sessionId]: [...remainingTurns, demotedTurn],
  };
}

export function reorderSessionQueue(
  queueBySession: SessionQueueMap,
  sessionId: string,
  orderedTurnIds: string[],
): SessionQueueMap {
  const queue = getSessionQueue(queueBySession, sessionId);
  if (queue.length <= 1) {
    return queueBySession;
  }

  const turnMap = new Map(queue.map((turn) => [turn.id, turn]));
  const reordered: QueuedTurn[] = [];
  for (const id of orderedTurnIds) {
    const turn = turnMap.get(id);
    if (turn) {
      reordered.push(turn);
      turnMap.delete(id);
    }
  }
  // Append any turns not in orderedTurnIds (safety net)
  for (const turn of turnMap.values()) {
    reordered.push(turn);
  }

  return {
    ...queueBySession,
    [sessionId]: reordered,
  };
}

export function reconcileSessionQueueId(
  queueBySession: SessionQueueMap,
  fromSessionId?: string | null,
  toSessionId?: string | null,
): SessionQueueMap {
  if (!fromSessionId || !toSessionId || fromSessionId === toSessionId) {
    return queueBySession;
  }

  const fromQueue = getSessionQueue(queueBySession, fromSessionId);
  if (fromQueue.length === 0) {
    return queueBySession;
  }

  const toQueue = getSessionQueue(queueBySession, toSessionId);
  const mergedQueue = [...toQueue, ...fromQueue.map((turn) => ({ ...turn, sessionId: toSessionId }))];

  const { [fromSessionId]: _removed, ...rest } = queueBySession;
  return {
    ...rest,
    [toSessionId]: mergedQueue,
  };
}

export function reconcileSettledSessionQueue(
  queueBySession: SessionQueueMap,
  settledSessionId?: string | null,
  fallbackTemporarySessionId?: string | null,
): SessionQueueMap {
  if (!settledSessionId || !fallbackTemporarySessionId) {
    return queueBySession;
  }

  if (!fallbackTemporarySessionId.startsWith('new-session-')) {
    return queueBySession;
  }

  if (fallbackTemporarySessionId === settledSessionId) {
    return queueBySession;
  }

  return reconcileSessionQueueId(queueBySession, fallbackTemporarySessionId, settledSessionId);
}
