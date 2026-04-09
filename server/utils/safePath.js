/**
 * Safe path resolution that prevents directory traversal.
 *
 * Tool calls from LLM agents may contain crafted paths like "/etc/passwd"
 * or "../../../etc/shadow". This module ensures every resolved path stays
 * within the designated project root, blocking prompt-injection attacks
 * that attempt to read or write files outside the workspace.
 *
 * Only the *logical* resolved path is checked (no `realpathSync`).  This
 * means legitimate symlinks inside the project that point outside the root
 * (e.g. `data -> /mnt/storage/data`) still work, while `..` traversal and
 * absolute-path escapes are caught.
 */

import path from 'path';

/**
 * Resolve `userPath` relative to `allowedRoot` and verify the result
 * stays within `allowedRoot`.
 *
 * - Absolute paths that land outside the root are rejected.
 * - Absolute paths inside the root are allowed (LLM may reference them).
 * - `..` components that climb above the root are rejected.
 * - Symlinks are NOT resolved — only the logical path is checked.
 *
 * @param {string} userPath  Path supplied by the tool call.
 * @param {string} allowedRoot  Project root directory.
 * @returns {string}  The resolved, validated absolute path.
 * @throws {Error}  If the path escapes `allowedRoot`.
 */
export function safePath(userPath, allowedRoot) {
  const normalizedRoot = path.resolve(allowedRoot);

  if (!userPath) return normalizedRoot;

  // Resolve to absolute (works for both relative and absolute inputs).
  // path.resolve normalises away any `.` and `..` segments.
  const resolved = path.isAbsolute(userPath)
    ? path.resolve(userPath)
    : path.resolve(normalizedRoot, userPath);

  // Ensure resolved path starts with root
  if (resolved !== normalizedRoot && !resolved.startsWith(normalizedRoot + path.sep)) {
    throw new Error(
      `Path traversal blocked: "${userPath}" resolves to "${resolved}" ` +
      `which is outside the project root "${normalizedRoot}".`
    );
  }

  return resolved;
}
