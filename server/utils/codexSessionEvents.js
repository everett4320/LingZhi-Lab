export function buildCodexSessionCreatedEvent({
  sessionId,
  sessionMode = 'research',
  projectName = null,
  provisionalSessionId = null,
  clientTurnId = null,
}) {
  return {
    type: 'session-created',
    sessionId,
    provider: 'codex',
    mode: sessionMode || 'research',
    ...(projectName ? { projectName } : {}),
    ...(provisionalSessionId ? { provisionalSessionId } : {}),
    ...(clientTurnId ? { clientTurnId } : {}),
  };
}
