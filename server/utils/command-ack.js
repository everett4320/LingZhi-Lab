export function resolveClientRequestId(payload = {}) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const topLevelId = typeof payload.clientRequestId === 'string' ? payload.clientRequestId.trim() : '';
  if (topLevelId) {
    return topLevelId;
  }

  const optionId = typeof payload.options?.clientRequestId === 'string'
    ? payload.options.clientRequestId.trim()
    : '';
  if (optionId) {
    return optionId;
  }

  return null;
}

export function buildCommandAck({
  accepted,
  provider,
  clientRequestId = null,
  reason = null,
  sessionId = null,
}) {
  return {
    type: 'command-ack',
    accepted: Boolean(accepted),
    provider: provider || null,
    clientRequestId: clientRequestId || null,
    reason: reason || null,
    sessionId: sessionId || null,
  };
}

export function sendCommandAck(writer, payload) {
  if (!writer || typeof writer.send !== 'function') {
    return;
  }

  writer.send(buildCommandAck(payload));
}
