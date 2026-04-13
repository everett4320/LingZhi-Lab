/**
 * useSessionMessageStore — React hook wrapping SessionMessageStore.
 *
 * Provides the same `chatMessages` / `setChatMessages` interface that the rest
 * of the codebase expects, but internally routes mutations through the three-layer
 * store so that server reloads never blow away optimistic or streaming messages.
 *
 * Drop-in replacement: callers that do `setChatMessages(msgs)` still work via
 * the compat path, but new code should use the typed dispatch actions.
 */

import { useCallback, useMemo, useReducer, useRef } from 'react';
import type { ChatMessage } from '../types/types';
import {
  type MessageStoreState,
  type MessageStoreAction,
  initialMessageStoreState,
  messageStoreReducer,
  selectMergedMessages,
  persistSessionStore,
  loadSessionStore,
  clearSessionStore,
} from '../store/SessionMessageStore';

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseSessionMessageStoreReturn {
  /** Merged view: persisted + optimistic + streaming. Use this for rendering. */
  chatMessages: ChatMessage[];

  /**
   * Backward-compatible setter. Accepts the same signature as React setState.
   *
   * Behavior depends on context:
   * - If called with an array directly, it's treated as a full persisted reload
   *   (SET_PERSISTED) — optimistic messages are reconciled, not destroyed.
   * - If called with a function updater, the updater receives the current merged
   *   view and the result replaces the full state (SET_CHAT_MESSAGES_COMPAT).
   *   This is the escape hatch for code that hasn't been migrated yet.
   */
  setChatMessages: (updater: React.SetStateAction<ChatMessage[]>) => void;

  /** Typed dispatch for new code. */
  dispatch: React.Dispatch<MessageStoreAction>;

  /** Direct access to the layered state (for debugging / sidebar). */
  storeState: MessageStoreState;

  /** Set persisted messages from a server history load. Reconciles optimistic. */
  setPersistedMessages: (messages: ChatMessage[]) => void;

  /** Prepend older history (pagination). */
  prependPersistedMessages: (messages: ChatMessage[]) => void;

  /** Add an optimistic user message. */
  addOptimisticMessage: (message: ChatMessage) => void;

  /** Append a streaming chunk to the streaming layer. */
  appendStreamingChunk: (chunk: string, newline?: boolean) => void;

  /** Finalize streaming: move finalized messages to persisted, clear streaming. */
  finalizeStreaming: (finalMessages: ChatMessage[]) => void;

  /** Clear streaming layer. */
  clearStreaming: () => void;

  /** Clear all layers. */
  clearAll: () => void;

  /** Bind to a new session (clears state if session changed). */
  bindSession: (sessionId: string | null, provider: string | null) => void;

  /** Persist current state to localStorage for crash recovery. */
  persist: (sessionId: string) => void;

  /** Load persisted state from localStorage. Returns true if found. */
  loadPersisted: (sessionId: string) => boolean;

  /** Clear persisted state from localStorage. */
  clearPersisted: (sessionId: string) => void;
}

export function useSessionMessageStore(): UseSessionMessageStoreReturn {
  const [storeState, dispatch] = useReducer(messageStoreReducer, initialMessageStoreState);

  // Keep a ref to the latest merged view for the functional updater path
  const mergedRef = useRef<ChatMessage[]>([]);

  const chatMessages = useMemo(() => {
    const merged = selectMergedMessages(storeState);
    mergedRef.current = merged;
    return merged;
  }, [storeState]);

  // Ensure every message has a stable ID (mirrors the old setChatMessages wrapper)
  const ensureIds = useCallback((messages: ChatMessage[]): ChatMessage[] => {
    let hasChanges = false;
    const result = messages.map((msg) => {
      if (
        !msg.id && !msg.messageId && !msg.toolId && !msg.toolCallId &&
        !msg.blobId && msg.rowid === undefined && msg.sequence === undefined
      ) {
        hasChanges = true;
        return {
          ...msg,
          messageId:
            typeof crypto !== 'undefined' && crypto.randomUUID
              ? crypto.randomUUID()
              : Math.random().toString(36).substring(2, 15),
        };
      }
      return msg;
    });
    return hasChanges ? result : messages;
  }, []);

  const setChatMessages = useCallback(
    (updater: React.SetStateAction<ChatMessage[]>) => {
      if (typeof updater === 'function') {
        // Functional updater: compute from current merged view, then set as compat
        const next = ensureIds(updater(mergedRef.current));
        dispatch({ type: 'SET_CHAT_MESSAGES_COMPAT', messages: next });
      } else {
        // Direct array: treat as persisted reload (the key behavioral change)
        dispatch({ type: 'SET_PERSISTED', messages: ensureIds(updater) });
      }
    },
    [ensureIds],
  );

  const setPersistedMessages = useCallback(
    (messages: ChatMessage[]) => {
      dispatch({ type: 'SET_PERSISTED', messages: ensureIds(messages) });
    },
    [ensureIds],
  );

  const prependPersistedMessages = useCallback(
    (messages: ChatMessage[]) => {
      dispatch({ type: 'PREPEND_PERSISTED', messages: ensureIds(messages) });
    },
    [ensureIds],
  );

  const addOptimisticMessage = useCallback(
    (message: ChatMessage) => {
      const [withId] = ensureIds([message]);
      dispatch({ type: 'ADD_OPTIMISTIC', message: withId });
    },
    [ensureIds],
  );

  const appendStreamingChunk = useCallback((chunk: string, newline?: boolean) => {
    dispatch({ type: 'APPEND_STREAMING_CHUNK', chunk, newline });
  }, []);

  const finalizeStreaming = useCallback(
    (finalMessages: ChatMessage[]) => {
      dispatch({ type: 'FINALIZE_STREAMING', finalMessages: ensureIds(finalMessages) });
    },
    [ensureIds],
  );

  const clearStreaming = useCallback(() => {
    dispatch({ type: 'CLEAR_STREAMING' });
  }, []);

  const clearAll = useCallback(() => {
    dispatch({ type: 'CLEAR_ALL' });
  }, []);

  const bindSession = useCallback((sessionId: string | null, provider: string | null) => {
    dispatch({ type: 'BIND_SESSION', sessionId, provider });
  }, []);

  const persist = useCallback(
    (sessionId: string) => {
      persistSessionStore(sessionId, storeState);
    },
    [storeState],
  );

  const loadPersisted = useCallback(
    (sessionId: string): boolean => {
      const saved = loadSessionStore(sessionId);
      if (!saved || !saved.persisted) return false;
      dispatch({
        type: 'SET_PERSISTED',
        messages: ensureIds(saved.persisted),
      });
      if (saved.optimistic && saved.optimistic.length > 0) {
        // Re-add optimistic messages that weren't yet confirmed
        for (const msg of saved.optimistic) {
          dispatch({ type: 'ADD_OPTIMISTIC', message: ensureIds([msg])[0] });
        }
      }
      return true;
    },
    [ensureIds],
  );

  const clearPersisted = useCallback((sessionId: string) => {
    clearSessionStore(sessionId);
  }, []);

  return {
    chatMessages,
    setChatMessages,
    dispatch,
    storeState,
    setPersistedMessages,
    prependPersistedMessages,
    addOptimisticMessage,
    appendStreamingChunk,
    finalizeStreaming,
    clearStreaming,
    clearAll,
    bindSession,
    persist,
    loadPersisted,
    clearPersisted,
  };
}
