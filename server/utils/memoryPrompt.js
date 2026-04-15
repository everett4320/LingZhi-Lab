import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { memoryDb } from '../database/db.js';

/**
 * Sanitizes memory content before injecting into system prompts.
 * Strips markdown headings that could confuse prompt structure.
 */
function sanitizeContent(content) {
  return content.replace(/^#+\s/gm, '').trim();
}

/**
 * Builds a memory block string to inject into system prompts (Option A: web UI).
 * Returns empty string if memory is disabled for this user or no enabled memories exist.
 * @param {number} userId - The authenticated user's ID
 * @returns {string} Formatted memory block or empty string
 */
export function buildMemoryBlock(userId) {
  if (!userId) return '';

  if (!memoryDb.getMemoryEnabled(userId)) return '';

  const memories = memoryDb.getEnabled(userId);
  if (!memories || memories.length === 0) return '';

  const lines = memories.map(m => `- ${sanitizeContent(m.content)}`).join('\n');
  return `\n\n# User Memories\nThe following are things the user has asked you to remember. Incorporate them naturally into your responses where relevant:\n${lines}\n`;
}

/**
 * Syncs enabled memories to a user-scoped reference file ~/.claude/MEMORY-{userId}.md.
 * This file is for user reference only — Option A (web UI) injects memories via
 * buildMemoryBlock() directly into system prompts and does not read this file.
 * File is namespaced by userId to avoid multi-user conflicts on shared servers.
 * @param {number} userId - The authenticated user's ID
 */
export async function syncMemoryFiles(userId) {
  if (!userId) return;

  const claudeDir = path.join(os.homedir(), '.claude');

  try {
    await fs.mkdir(claudeDir, { recursive: true });
  } catch {
    // directory likely exists
  }

  const isEnabled = memoryDb.getMemoryEnabled(userId);
  const memories = isEnabled ? memoryDb.getEnabled(userId) : [];

  const lines = [
    '# User Memories',
    '',
    '> This file is a read-only reference synced by Lingzhi Lab.',
    '> To manage memories: use Lingzhi Lab Settings > Memory tab.',
    '',
  ];

  if (!memories || memories.length === 0) {
    lines.push('_No memories saved yet. Add them in Lingzhi Lab Settings > Memory._');
  } else {
    for (const m of memories) {
      const tag = m.category && m.category !== 'general' ? ` [${m.category}]` : '';
      lines.push(`- ${sanitizeContent(m.content)}${tag}`);
    }
  }

  lines.push('');

  const memoryMdPath = path.join(claudeDir, `MEMORY-${userId}.md`);
  try {
    await fs.writeFile(memoryMdPath, lines.join('\n'), 'utf-8');
  } catch (err) {
    console.warn('[memory-sync] Failed to write MEMORY file:', err.message);
  }
}
