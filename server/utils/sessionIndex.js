import { sessionDb } from '../database/db.js';
import { encodeProjectPath } from '../projects.js';

function defaultSessionName(provider) {
  switch (provider) {
    case 'cursor':
      return 'Untitled Session';
    case 'codex':
      return 'Codex Session';
    case 'gemini':
      return 'Gemini Session';
    default:
      return 'New Session';
  }
}

export function recordIndexedSession({
  sessionId,
  provider,
  projectPath,
  sessionMode = 'research',
  displayName = null,
  lastActivity = null,
}) {
  if (!sessionId || !provider || !projectPath) {
    return;
  }

  const projectName = encodeProjectPath(projectPath);
  sessionDb.upsertSessionPlaceholder(
    sessionId,
    projectName,
    provider,
    displayName || defaultSessionName(provider),
    lastActivity || new Date().toISOString(),
    {
      sessionMode,
      projectPath,
      indexState: 'placeholder',
    },
  );
}
