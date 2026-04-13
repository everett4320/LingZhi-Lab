/**
 * SessionMessageStore — unified message state layer.
 *
 * Separates chat messages into three non-overlapping layers:
 *   1. persisted  — messages confirmed by the server (history reload)
 *   2. optimistic — user messages sent but not yet confirmed in persisted history
 *   3. streaming  — in-flight assistant response chunks (transient)
 *
 * The merged view presented to the UI is always:
 *   [...persisted, ...optimistic, ...streaming]
 *
 * Server reloads only replace `persisted`; they never touch optimistic or streaming.
 * When a reload contains a message that matches an optimistic entry, the optimistic
 * entry is promoted (removed from optimistic, now lives in persisted).
 *
 * Provider-neutral: works for Claude, Codex, Gemini, OpenRouter, Local, Nano, Cursor.
 * Platform-neutral: no path separators or OS assumptions.
 */

import type { ChatMessage } from '../types/types';

// ---------------------------------------------------------------------------
// Stable UID helpers
// ---------------------------------------------------------------------------

/** Derive a stable key from a message for dedup / reconciliation. */
export function getMessageStableKey(msg: ChatMessage): string | null {
  // Prefer server-assigned IDs
  if (msg.id) return `id:${msg.id}`;
  if (msg.toolId) return `tool:${msg.toolId}`;
  if (msg.toolCallId) return `toolcall:${msg.toolCallId}`;
  if (msg.blobId) return `blob:${msg.blobId}`;
  if (msg.rowid !== undefined && msg.rowid !== null) return `rowid:${msg.rowid}`;
  if (msg.sequence !== undefined && msg.sequence !== null) return `seq:${msg.sequence}`;

  // For user messages without server IDs, use content + timestamp fingerprint
  if (msg.type === 'user' && msg.content) {
    const ts = new Date(msg.timestamp).getTime();
    const contentSnippet = String(msg.content).slice(0, 100);
    return `user:${ts}:${contentSnippet}`;
  }

  // Client-assigned messageId (from setChatMessages wrapper)
  if (msg.messageId) return `mid:${msg.messageId}`;

  return null;
}

// ---------------------------------------------------------------------------
// Store types
// ---------------------------------------------------------------------------

export interface MessageStoreState {
  /** Messages confirmed by server history. */
  persisted: ChatMessage[];
  /** User messages sent but not yet seen in persisted history. */
  optimistic: ChatMessage[];
  /** In-flight streaming assistant chunks. */
  streaming: ChatMessage[];
  /** Session this store is bound to. */
  sessionId: string | null;
  /** Provider for this session. */
  provider: string | null;
}

export type MessageStoreAction =
  | { type: 'SET_PERSISTED'; messages: ChatMessage[] }
  | { type: 'PREPEND_PERSISTED'; messages: ChatMessage[] }
  | { type: 'ADD_OPTIMISTIC'; message: ChatMessage }
  | { type: 'SET_STREAMING'; messages: ChatMessage[] }
  | { type: 'APPEND_STREAMING_CHUNK'; chunk: string; newline?: boolean }
  | { type: 'FINALIZE_STREAMING'; finalMessages: ChatMessage[] }
  | { type: 'CLEAR_STREAMING' }
  | { type: 'CLEAR_ALL' }
  | { type: 'BIND_SESSION'; sessionId: string | null; provider: string | null }
  | { type: 'RECONCILE' }
  | { type: 'SET_CHAT_MESSAGES_COMPAT'; messages: ChatMessage[] };

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

export const initialMessageStoreState: MessageStoreState = {
  persisted: [],
  optimistic: [],
  streaming: [],
  sessionId: null,
  provider: null,
};

// ---------------------------------------------------------------------------
// Reconciliation: promote optimistic → persisted when server confirms
// ---------------------------------------------------------------------------

function reconcileOptimistic(persisted: ChatMessage[], optimistic: ChatMessage[]): ChatMessage[] {
  if (optimistic.length === 0) return optimistic;

  const persistedKeys = new Set<string>();
  for (const msg of persisted) {
    const key = getMessageStableKey(msg);
    if (key) persistedKeys.add(key);
  }

  // Also build a content-based index for user messages (fuzzy match)
  const persistedUserContents = new Set<string>();
  for (const msg of persisted) {
    if ((msg.type === 'user') && msg.content) {
      persistedUserContents.add(String(msg.content).trim());
    }
  }

  return optimistic.filter((opt) => {
    // If the optimistic message's key now exists in persisted, it's been confirmed
    const key = getMessageStableKey(opt);
    if (key && persistedKeys.has(key)) return false;

    // For user messages, also check content match (server may assign different ID)
    if (opt.type === 'user' && opt.content) {
      const trimmed = String(opt.content).trim();
      if (persistedUserContents.has(trimmed)) return false;
    }

    return true;
  });
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export function messageStoreReducer(
  state: MessageStoreState,
  action: MessageStoreAction,
): MessageStoreState {
  switch (action.type) {
    case 'SET_PERSISTED': {
      const remaining = reconcileOptimistic(action.messages, state.optimistic);
      return { ...state, persisted: action.messages, optimistic: remaining };
    }

    case 'PREPEND_PERSISTED': {
      const merged = [...action.messages, ...state.persisted];
      return { ...state, persisted: merged };
    }

    case 'ADD_OPTIMISTIC': {
      return { ...state, optimistic: [...state.optimistic, action.message] };
    }

    case 'SET_STREAMING': {
      return { ...state, streaming: action.messages };
    }

    case 'APPEND_STREAMING_CHUNK': {
      const { chunk, newline } = action;
      if (!chunk) return state;

      const updated = [...state.streaming];
      const lastIndex = updated.length - 1;
      const last = updated[lastIndex];

      if (last && last.type === 'assistant' && !last.isToolUse && last.isStreaming) {
        const nextContent = newline
          ? last.content ? `${last.content}\n${chunk}` : chunk
          : `${last.content || ''}${chunk}`;
        updated[lastIndex] = { ...last, content: nextContent };
      } else {
        updated.push({
          type: 'assistant',
          content: chunk,
          timestamp: new Date(),
          isStreaming: true,
        });
      }
      return { ...state, streaming: updated };
    }

    case 'FINALIZE_STREAMING': {
      // Replace streaming with finalized messages, move them to persisted tail
      return {
        ...state,
        persisted: [...state.persisted, ...action.finalMessages],
        streaming: [],
      };
    }

    case 'CLEAR_STREAMING': {
      return { ...state, streaming: [] };
    }

    case 'CLEAR_ALL': {
      return { ...state, persisted: [], optimistic: [], streaming: [] };
    }

    case 'BIND_SESSION': {
      if (state.sessionId === action.sessionId && state.provider === action.provider) {
        return state;
      }
      return {
        ...initialMessageStoreState,
        sessionId: action.sessionId,
        provider: action.provider,
      };
    }

    case 'RECONCILE': {
      const remaining = reconcileOptimistic(state.persisted, state.optimistic);
      if (remaining.length === state.optimistic.length) return state;
      return { ...state, optimistic: remaining };
    }

    // Backward-compat: direct set of the full merged array (used during migration)
    case 'SET_CHAT_MESSAGES_COMPAT': {
      return { ...state, persisted: action.messages, optimistic: [], streaming: [] };
    }

    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Merged view selector
// ---------------------------------------------------------------------------

/** Compute the merged message array the UI should render. */
export function selectMergedMessages(state: MessageStoreState): ChatMessage[] {
  const { persisted, optimistic, streaming } = state;
  if (optimistic.length === 0 && streaming.length === 0) return persisted;
  if (optimistic.length === 0) return [...persisted, ...streaming];
  if (streaming.length === 0) return [...persisted, ...optimistic];
  return [...persisted, ...optimistic, ...streaming];
}

// ---------------------------------------------------------------------------
// Session-level localStorage persistence (minimal recovery info only)
// ---------------------------------------------------------------------------

const SESSION_STORE_PREFIX = 'msg_store_';
const MAX_PERSISTED_SESSIONS = 5;
const MAX_PERSISTED_MESSAGES = 30;

export function persistSessionStore(sessionId: string, state: MessageStoreState): void {
  if (!sessionId) return;
  try {
    // Only persist a small tail of persisted + any optimistic (for crash recovery)
    const tail = state.persisted.slice(-MAX_PERSISTED_MESSAGES);
    const payload = JSON.stringify({
      sessionId,
      provider: state.provider,
      persisted: tail,
      optimistic: state.optimistic,
      ts: Date.now(),
    });
    localStorage.setItem(`${SESSION_STORE_PREFIX}${sessionId}`, payload);

    // Evict old session stores
    const keys = Object.keys(localStorage)
      .filter((k) => k.startsWith(SESSION_STORE_PREFIX))
      .sort();
    if (keys.length > MAX_PERSISTED_SESSIONS) {
      keys.slice(0, keys.length - MAX_PERSISTED_SESSIONS).forEach((k) => {
        localStorage.removeItem(k);
      });
    }
  } catch {
    // Quota exceeded or other error — non-critical
  }
}

export function loadSessionStore(sessionId: string): Partial<MessageStoreState> | null {
  if (!sessionId) return null;
  try {
    const raw = localStorage.getItem(`${SESSION_STORE_PREFIX}${sessionId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed.sessionId !== sessionId) return null;
    return {
      persisted: Array.isArray(parsed.persisted) ? parsed.persisted : [],
      optimistic: Array.isArray(parsed.optimistic) ? parsed.optimistic : [],
      provider: parsed.provider || null,
    };
  } catch {
    return null;
  }
}

export function clearSessionStore(sessionId: string): void {
  if (!sessionId) return;
  try {
    localStorage.removeItem(`${SESSION_STORE_PREFIX}${sessionId}`);
  } catch {
    // ignore
  }
}
