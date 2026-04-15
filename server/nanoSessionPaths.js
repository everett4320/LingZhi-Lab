/**
 * Central Nano Claude Code session JSON location (~/.lingzhi-lab/nano-sessions).
 * Matches file watcher PROVIDER_WATCH_PATHS and avoids cwd-scattered lingzhilab-nano-*.json.
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';

export function getNanoLingzhiLabSessionsRoot() {
  return path.join(os.homedir(), '.lingzhi-lab', 'nano-sessions');
}

export async function ensureNanoLingzhiLabSessionsRoot() {
  const root = getNanoLingzhiLabSessionsRoot();
  await fs.mkdir(root, { recursive: true });
  return root;
}

/**
 * Plain filename only: lingzhilab-nano-<sanitizedId>.json — no path segments / traversal.
 */
export function safeNanoSessionFilename(sessionId) {
  const safe = String(sessionId || '').replace(/[^a-zA-Z0-9._-]/g, '');
  if (!safe || safe.includes('..')) {
    return null;
  }
  const filename = `lingzhilab-nano-${safe}.json`;
  if (path.basename(filename) !== filename) {
    return null;
  }
  return filename;
}

export function resolveNanoSessionAbsPath(sessionId) {
  const filename = safeNanoSessionFilename(sessionId);
  if (!filename) {
    return null;
  }
  return path.join(getNanoLingzhiLabSessionsRoot(), filename);
}
