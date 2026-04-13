import { describe, it, expect, beforeEach } from 'vitest';
import {
  messageStoreReducer,
  initialMessageStoreState,
  selectMergedMessages,
  getMessageStableKey,
  persistSessionStore,
  loadSessionStore,
  clearSessionStore,
  type MessageStoreState,
  type MessageStoreAction,
} from '../../store/SessionMessageStore';
import type { ChatMessage } from '../../types/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeUserMsg = (content: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  type: 'user',
  content,
  timestamp: new Date('2025-01-01T00:00:00Z'),
  ...extra,
});

const makeAssistantMsg = (content: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  type: 'assistant',
  content,
  timestamp: new Date('2025-01-01T00:00:01Z'),
  ...extra,
});

const makeToolMsg = (toolName: string, toolId: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  type: 'assistant',
  content: '',
  timestamp: new Date('2025-01-01T00:00:02Z'),
  isToolUse: true,
  toolName,
  toolId,
  toolCallId: toolId,
  ...extra,
});

const dispatch = (state: MessageStoreState, action: MessageStoreAction): MessageStoreState =>
  messageStoreReducer(state, action);

// ---------------------------------------------------------------------------
// getMessageStableKey
// ---------------------------------------------------------------------------

describe('getMessageStableKey', () => {
  it('prefers server-assigned id', () => {
    const msg = makeUserMsg('hello', { id: 'srv-123' } as any);
    expect(getMessageStableKey(msg)).toBe('id:srv-123');
  });

  it('uses toolId for tool messages', () => {
    const msg = makeToolMsg('Read', 'tool_abc');
    expect(getMessageStableKey(msg)).toBe('tool:tool_abc');
  });

  it('uses toolCallId when toolId is absent', () => {
    const msg = makeAssistantMsg('', { isToolUse: true, toolCallId: 'tc_1' });
    expect(getMessageStableKey(msg)).toBe('toolcall:tc_1');
  });

  it('uses blobId for cursor messages', () => {
    const msg = makeAssistantMsg('hi', { blobId: 'blob-42' } as any);
    expect(getMessageStableKey(msg)).toBe('blob:blob-42');
  });

  it('uses rowid for cursor messages', () => {
    const msg = makeAssistantMsg('hi', { rowid: 7 } as any);
    expect(getMessageStableKey(msg)).toBe('rowid:7');
  });

  it('uses sequence for cursor messages', () => {
    const msg = makeAssistantMsg('hi', { sequence: 3 } as any);
    expect(getMessageStableKey(msg)).toBe('seq:3');
  });

  it('falls back to content fingerprint for user messages', () => {
    const msg = makeUserMsg('hello world');
    const key = getMessageStableKey(msg);
    expect(key).toContain('user:');
    expect(key).toContain('hello world');
  });

  it('uses messageId as last resort', () => {
    const msg = makeAssistantMsg('', { messageId: 'uuid-xyz' });
    expect(getMessageStableKey(msg)).toBe('mid:uuid-xyz');
  });

  it('returns null for completely anonymous messages', () => {
    const msg: ChatMessage = { type: 'error', content: 'oops', timestamp: 'invalid' };
    // timestamp is invalid, no IDs — should return null
    expect(getMessageStableKey(msg)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// messageStoreReducer — SET_PERSISTED
// ---------------------------------------------------------------------------

describe('messageStoreReducer — SET_PERSISTED', () => {
  it('sets persisted messages', () => {
    const msgs = [makeUserMsg('a'), makeAssistantMsg('b')];
    const state = dispatch(initialMessageStoreState, { type: 'SET_PERSISTED', messages: msgs });
    expect(state.persisted).toEqual(msgs);
    expect(state.optimistic).toEqual([]);
    expect(state.streaming).toEqual([]);
  });

  it('reconciles optimistic messages when persisted arrives', () => {
    // Add an optimistic user message
    let state = dispatch(initialMessageStoreState, {
      type: 'ADD_OPTIMISTIC',
      message: makeUserMsg('hello'),
    });
    expect(state.optimistic).toHaveLength(1);

    // Server reload includes the same user message
    state = dispatch(state, {
      type: 'SET_PERSISTED',
      messages: [makeUserMsg('hello')],
    });

    // Optimistic should be reconciled (removed)
    expect(state.optimistic).toHaveLength(0);
    expect(state.persisted).toHaveLength(1);
  });

  it('keeps optimistic messages that are NOT in persisted', () => {
    let state = dispatch(initialMessageStoreState, {
      type: 'ADD_OPTIMISTIC',
      message: makeUserMsg('new message'),
    });

    // Server reload with different messages
    state = dispatch(state, {
      type: 'SET_PERSISTED',
      messages: [makeUserMsg('old message')],
    });

    // Optimistic should survive
    expect(state.optimistic).toHaveLength(1);
    expect(state.optimistic[0].content).toBe('new message');
  });

  it('reconciles by content match even with different IDs', () => {
    let state = dispatch(initialMessageStoreState, {
      type: 'ADD_OPTIMISTIC',
      message: makeUserMsg('same content', { messageId: 'client-1' }),
    });

    // Server assigns a different ID but same content
    state = dispatch(state, {
      type: 'SET_PERSISTED',
      messages: [makeUserMsg('same content', { id: 'server-1' } as any)],
    });

    expect(state.optimistic).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// messageStoreReducer — PREPEND_PERSISTED
// ---------------------------------------------------------------------------

describe('messageStoreReducer — PREPEND_PERSISTED', () => {
  it('prepends older messages to persisted', () => {
    let state = dispatch(initialMessageStoreState, {
      type: 'SET_PERSISTED',
      messages: [makeAssistantMsg('recent')],
    });

    state = dispatch(state, {
      type: 'PREPEND_PERSISTED',
      messages: [makeUserMsg('old')],
    });

    expect(state.persisted).toHaveLength(2);
    expect(state.persisted[0].content).toBe('old');
    expect(state.persisted[1].content).toBe('recent');
  });
});

// ---------------------------------------------------------------------------
// messageStoreReducer — ADD_OPTIMISTIC
// ---------------------------------------------------------------------------

describe('messageStoreReducer — ADD_OPTIMISTIC', () => {
  it('adds to optimistic layer', () => {
    const msg = makeUserMsg('optimistic');
    const state = dispatch(initialMessageStoreState, { type: 'ADD_OPTIMISTIC', message: msg });
    expect(state.optimistic).toHaveLength(1);
    expect(state.optimistic[0].content).toBe('optimistic');
  });
});

// ---------------------------------------------------------------------------
// messageStoreReducer — streaming actions
// ---------------------------------------------------------------------------

describe('messageStoreReducer — streaming', () => {
  it('APPEND_STREAMING_CHUNK creates new streaming message', () => {
    const state = dispatch(initialMessageStoreState, {
      type: 'APPEND_STREAMING_CHUNK',
      chunk: 'Hello',
    });
    expect(state.streaming).toHaveLength(1);
    expect(state.streaming[0].content).toBe('Hello');
    expect(state.streaming[0].isStreaming).toBe(true);
  });

  it('APPEND_STREAMING_CHUNK appends to existing streaming message', () => {
    let state = dispatch(initialMessageStoreState, {
      type: 'APPEND_STREAMING_CHUNK',
      chunk: 'Hello',
    });
    state = dispatch(state, {
      type: 'APPEND_STREAMING_CHUNK',
      chunk: ' world',
    });
    expect(state.streaming).toHaveLength(1);
    expect(state.streaming[0].content).toBe('Hello world');
  });

  it('APPEND_STREAMING_CHUNK with newline', () => {
    let state = dispatch(initialMessageStoreState, {
      type: 'APPEND_STREAMING_CHUNK',
      chunk: 'line1',
    });
    state = dispatch(state, {
      type: 'APPEND_STREAMING_CHUNK',
      chunk: 'line2',
      newline: true,
    });
    expect(state.streaming[0].content).toBe('line1\nline2');
  });

  it('APPEND_STREAMING_CHUNK ignores empty chunks', () => {
    const state = dispatch(initialMessageStoreState, {
      type: 'APPEND_STREAMING_CHUNK',
      chunk: '',
    });
    expect(state.streaming).toHaveLength(0);
  });

  it('FINALIZE_STREAMING moves to persisted and clears streaming', () => {
    let state = dispatch(initialMessageStoreState, {
      type: 'SET_PERSISTED',
      messages: [makeUserMsg('user msg')],
    });
    state = dispatch(state, {
      type: 'APPEND_STREAMING_CHUNK',
      chunk: 'streaming...',
    });

    const finalMsg = makeAssistantMsg('final answer');
    state = dispatch(state, {
      type: 'FINALIZE_STREAMING',
      finalMessages: [finalMsg],
    });

    expect(state.streaming).toHaveLength(0);
    expect(state.persisted).toHaveLength(2);
    expect(state.persisted[1].content).toBe('final answer');
  });

  it('CLEAR_STREAMING clears streaming layer', () => {
    let state = dispatch(initialMessageStoreState, {
      type: 'APPEND_STREAMING_CHUNK',
      chunk: 'data',
    });
    state = dispatch(state, { type: 'CLEAR_STREAMING' });
    expect(state.streaming).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// messageStoreReducer — session binding
// ---------------------------------------------------------------------------

describe('messageStoreReducer — BIND_SESSION', () => {
  it('clears state when session changes', () => {
    let state = dispatch(initialMessageStoreState, {
      type: 'SET_PERSISTED',
      messages: [makeUserMsg('old session')],
    });
    state = dispatch(state, {
      type: 'BIND_SESSION',
      sessionId: 'new-session',
      provider: 'claude',
    });

    expect(state.persisted).toHaveLength(0);
    expect(state.sessionId).toBe('new-session');
    expect(state.provider).toBe('claude');
  });

  it('is a no-op when session is the same', () => {
    let state = dispatch(initialMessageStoreState, {
      type: 'BIND_SESSION',
      sessionId: 'sess-1',
      provider: 'claude',
    });
    state = dispatch(state, {
      type: 'SET_PERSISTED',
      messages: [makeUserMsg('data')],
    });

    const state2 = dispatch(state, {
      type: 'BIND_SESSION',
      sessionId: 'sess-1',
      provider: 'claude',
    });

    expect(state2).toBe(state); // Same reference — no change
  });
});

// ---------------------------------------------------------------------------
// messageStoreReducer — CLEAR_ALL
// ---------------------------------------------------------------------------

describe('messageStoreReducer — CLEAR_ALL', () => {
  it('clears all layers', () => {
    let state = dispatch(initialMessageStoreState, {
      type: 'SET_PERSISTED',
      messages: [makeUserMsg('a')],
    });
    state = dispatch(state, { type: 'ADD_OPTIMISTIC', message: makeUserMsg('b') });
    state = dispatch(state, { type: 'APPEND_STREAMING_CHUNK', chunk: 'c' });
    state = dispatch(state, { type: 'CLEAR_ALL' });

    expect(state.persisted).toHaveLength(0);
    expect(state.optimistic).toHaveLength(0);
    expect(state.streaming).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// messageStoreReducer — SET_CHAT_MESSAGES_COMPAT
// ---------------------------------------------------------------------------

describe('messageStoreReducer — SET_CHAT_MESSAGES_COMPAT', () => {
  it('replaces all layers with the given messages', () => {
    let state = dispatch(initialMessageStoreState, {
      type: 'ADD_OPTIMISTIC',
      message: makeUserMsg('opt'),
    });
    state = dispatch(state, {
      type: 'SET_CHAT_MESSAGES_COMPAT',
      messages: [makeUserMsg('compat')],
    });

    expect(state.persisted).toHaveLength(1);
    expect(state.persisted[0].content).toBe('compat');
    expect(state.optimistic).toHaveLength(0);
    expect(state.streaming).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// messageStoreReducer — RECONCILE
// ---------------------------------------------------------------------------

describe('messageStoreReducer — RECONCILE', () => {
  it('removes optimistic messages that now exist in persisted', () => {
    let state = dispatch(initialMessageStoreState, {
      type: 'ADD_OPTIMISTIC',
      message: makeUserMsg('hello'),
    });
    // Manually set persisted to include the same content
    state = { ...state, persisted: [makeUserMsg('hello')] };
    state = dispatch(state, { type: 'RECONCILE' });

    expect(state.optimistic).toHaveLength(0);
  });

  it('is a no-op when nothing to reconcile', () => {
    let state = dispatch(initialMessageStoreState, {
      type: 'ADD_OPTIMISTIC',
      message: makeUserMsg('unique'),
    });
    const state2 = dispatch(state, { type: 'RECONCILE' });
    expect(state2).toBe(state); // Same reference
  });
});

// ---------------------------------------------------------------------------
// selectMergedMessages
// ---------------------------------------------------------------------------

describe('selectMergedMessages', () => {
  it('returns persisted when no optimistic or streaming', () => {
    const msgs = [makeUserMsg('a')];
    const state: MessageStoreState = { ...initialMessageStoreState, persisted: msgs };
    expect(selectMergedMessages(state)).toBe(msgs); // Same reference for perf
  });

  it('merges persisted + optimistic', () => {
    const state: MessageStoreState = {
      ...initialMessageStoreState,
      persisted: [makeUserMsg('a')],
      optimistic: [makeUserMsg('b')],
    };
    const merged = selectMergedMessages(state);
    expect(merged).toHaveLength(2);
    expect(merged[0].content).toBe('a');
    expect(merged[1].content).toBe('b');
  });

  it('merges persisted + streaming', () => {
    const state: MessageStoreState = {
      ...initialMessageStoreState,
      persisted: [makeUserMsg('a')],
      streaming: [makeAssistantMsg('stream', { isStreaming: true })],
    };
    const merged = selectMergedMessages(state);
    expect(merged).toHaveLength(2);
    expect(merged[1].isStreaming).toBe(true);
  });

  it('merges all three layers in order', () => {
    const state: MessageStoreState = {
      ...initialMessageStoreState,
      persisted: [makeUserMsg('persisted')],
      optimistic: [makeUserMsg('optimistic')],
      streaming: [makeAssistantMsg('streaming', { isStreaming: true })],
    };
    const merged = selectMergedMessages(state);
    expect(merged).toHaveLength(3);
    expect(merged[0].content).toBe('persisted');
    expect(merged[1].content).toBe('optimistic');
    expect(merged[2].content).toBe('streaming');
  });
});

// ---------------------------------------------------------------------------
// Scenario: "blue bubble disappears" regression test
// ---------------------------------------------------------------------------

describe('Scenario: optimistic user message survives server reload', () => {
  it('user sends message, server reloads history without it, message persists', () => {
    // 1. User sends a message (optimistic)
    let state = dispatch(initialMessageStoreState, {
      type: 'ADD_OPTIMISTIC',
      message: makeUserMsg('my new question'),
    });

    // 2. Server reloads history (doesn't include the new message yet)
    state = dispatch(state, {
      type: 'SET_PERSISTED',
      messages: [
        makeUserMsg('old question'),
        makeAssistantMsg('old answer'),
      ],
    });

    // 3. Merged view should show both old history AND the optimistic message
    const merged = selectMergedMessages(state);
    expect(merged).toHaveLength(3);
    expect(merged[2].content).toBe('my new question');
  });

  it('user sends message, server eventually includes it, optimistic is reconciled', () => {
    // 1. User sends a message (optimistic)
    let state = dispatch(initialMessageStoreState, {
      type: 'ADD_OPTIMISTIC',
      message: makeUserMsg('my new question'),
    });

    // 2. Server reloads history and NOW includes the message
    state = dispatch(state, {
      type: 'SET_PERSISTED',
      messages: [
        makeUserMsg('old question'),
        makeAssistantMsg('old answer'),
        makeUserMsg('my new question'),
      ],
    });

    // 3. Optimistic should be reconciled — no duplicate
    const merged = selectMergedMessages(state);
    expect(merged).toHaveLength(3);
    expect(state.optimistic).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Scenario: streaming + reload interaction
// ---------------------------------------------------------------------------

describe('Scenario: streaming message survives server reload', () => {
  it('streaming in progress, server reloads, streaming continues', () => {
    // 1. Some persisted history
    let state = dispatch(initialMessageStoreState, {
      type: 'SET_PERSISTED',
      messages: [makeUserMsg('question')],
    });

    // 2. Streaming starts
    state = dispatch(state, { type: 'APPEND_STREAMING_CHUNK', chunk: 'The answer is' });

    // 3. Server reload happens (e.g. projects_updated)
    state = dispatch(state, {
      type: 'SET_PERSISTED',
      messages: [makeUserMsg('question')],
    });

    // 4. Streaming should still be there
    const merged = selectMergedMessages(state);
    expect(merged).toHaveLength(2);
    expect(merged[1].content).toBe('The answer is');
    expect(merged[1].isStreaming).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Scenario: multi-provider compatibility
// ---------------------------------------------------------------------------

describe('Scenario: provider-neutral message handling', () => {
  it('handles Cursor blob-style messages', () => {
    const cursorMsg = makeAssistantMsg('cursor response', {
      blobId: 'blob-1',
      sequence: 5,
      rowid: 10,
    } as any);

    const state = dispatch(initialMessageStoreState, {
      type: 'SET_PERSISTED',
      messages: [cursorMsg],
    });

    expect(getMessageStableKey(state.persisted[0])).toBe('blob:blob-1');
  });

  it('handles Codex tool messages', () => {
    const codexTool = makeToolMsg('bash', 'toolu_abc123');
    const state = dispatch(initialMessageStoreState, {
      type: 'SET_PERSISTED',
      messages: [codexTool],
    });

    expect(getMessageStableKey(state.persisted[0])).toBe('tool:toolu_abc123');
  });

  it('handles Gemini messages without IDs', () => {
    const geminiMsg = makeAssistantMsg('gemini response', { messageId: 'gem-uuid' });
    const state = dispatch(initialMessageStoreState, {
      type: 'SET_PERSISTED',
      messages: [geminiMsg],
    });

    expect(getMessageStableKey(state.persisted[0])).toBe('mid:gem-uuid');
  });
});

// ---------------------------------------------------------------------------
// localStorage persistence
// ---------------------------------------------------------------------------

const hasLocalStorage = typeof globalThis.localStorage !== 'undefined';

// Provide a minimal in-memory localStorage shim for Node test environments.
// Must support Object.keys(localStorage) because the store uses it for eviction.
const storageShim = new Map<string, string>();
if (!hasLocalStorage) {
  const handler: ProxyHandler<Record<string, any>> = {
    get(_target, prop) {
      if (prop === 'getItem') return (key: string) => storageShim.get(key) ?? null;
      if (prop === 'setItem') return (key: string, value: string) => { storageShim.set(key, value); };
      if (prop === 'removeItem') return (key: string) => { storageShim.delete(key); };
      if (prop === 'clear') return () => { storageShim.clear(); };
      if (prop === 'length') return storageShim.size;
      if (prop === 'key') return (index: number) => [...storageShim.keys()][index] ?? null;
      return undefined;
    },
    ownKeys() {
      return [...storageShim.keys()];
    },
    getOwnPropertyDescriptor(_target, prop) {
      if (storageShim.has(prop as string)) {
        return { configurable: true, enumerable: true, value: storageShim.get(prop as string) };
      }
      return undefined;
    },
  };
  (globalThis as any).localStorage = new Proxy({}, handler);
}

describe('localStorage persistence', () => {
  beforeEach(() => {
    if (hasLocalStorage) {
      localStorage.clear();
    } else {
      storageShim.clear();
    }
  });

  it('persists and loads session store', () => {
    const state: MessageStoreState = {
      ...initialMessageStoreState,
      sessionId: 'test-session',
      provider: 'claude',
      persisted: [makeUserMsg('saved msg')],
      optimistic: [makeUserMsg('pending msg')],
    };

    persistSessionStore('test-session', state);
    const loaded = loadSessionStore('test-session');

    expect(loaded).not.toBeNull();
    expect(loaded!.persisted).toHaveLength(1);
    expect(loaded!.persisted![0].content).toBe('saved msg');
    expect(loaded!.optimistic).toHaveLength(1);
    expect(loaded!.optimistic![0].content).toBe('pending msg');
  });

  it('clears session store', () => {
    const state: MessageStoreState = {
      ...initialMessageStoreState,
      sessionId: 'test-session',
      provider: 'claude',
      persisted: [makeUserMsg('data')],
    };

    persistSessionStore('test-session', state);
    clearSessionStore('test-session');
    const loaded = loadSessionStore('test-session');

    expect(loaded).toBeNull();
  });

  it('returns null for non-existent session', () => {
    expect(loadSessionStore('nonexistent')).toBeNull();
  });

  it('truncates persisted messages to max limit', () => {
    const manyMessages = Array.from({ length: 50 }, (_, i) => makeUserMsg(`msg-${i}`));
    const state: MessageStoreState = {
      ...initialMessageStoreState,
      sessionId: 'big-session',
      provider: 'claude',
      persisted: manyMessages,
    };

    persistSessionStore('big-session', state);
    const loaded = loadSessionStore('big-session');

    // Should be truncated to MAX_PERSISTED_MESSAGES (30)
    expect(loaded!.persisted!.length).toBeLessThanOrEqual(30);
  });

  it('evicts old sessions when too many are stored', () => {
    for (let i = 0; i < 8; i++) {
      const state: MessageStoreState = {
        ...initialMessageStoreState,
        sessionId: `session-${i}`,
        provider: 'claude',
        persisted: [makeUserMsg(`msg-${i}`)],
      };
      persistSessionStore(`session-${i}`, state);
    }

    // Only MAX_PERSISTED_SESSIONS (5) should remain
    const allKeys = hasLocalStorage
      ? Object.keys(localStorage)
      : [...storageShim.keys()];
    const keys = allKeys.filter((k) => k.startsWith('msg_store_'));
    expect(keys.length).toBeLessThanOrEqual(5);
  });
});

// ---------------------------------------------------------------------------
// Scenario: session switch clears state
// ---------------------------------------------------------------------------

describe('Scenario: session switching', () => {
  it('switching sessions clears all layers', () => {
    let state = dispatch(initialMessageStoreState, {
      type: 'BIND_SESSION',
      sessionId: 'session-1',
      provider: 'claude',
    });
    state = dispatch(state, {
      type: 'SET_PERSISTED',
      messages: [makeUserMsg('session 1 data')],
    });
    state = dispatch(state, {
      type: 'ADD_OPTIMISTIC',
      message: makeUserMsg('pending'),
    });

    // Switch to new session
    state = dispatch(state, {
      type: 'BIND_SESSION',
      sessionId: 'session-2',
      provider: 'gemini',
    });

    expect(state.persisted).toHaveLength(0);
    expect(state.optimistic).toHaveLength(0);
    expect(state.streaming).toHaveLength(0);
    expect(state.sessionId).toBe('session-2');
    expect(state.provider).toBe('gemini');
  });
});

// ---------------------------------------------------------------------------
// Scenario: backward compatibility (SET_CHAT_MESSAGES_COMPAT)
// ---------------------------------------------------------------------------

describe('Scenario: backward compatibility via functional updater', () => {
  it('functional updater path works for legacy code', () => {
    let state = dispatch(initialMessageStoreState, {
      type: 'SET_PERSISTED',
      messages: [makeUserMsg('existing')],
    });

    // Simulate legacy setChatMessages((prev) => [...prev, errorMsg])
    const errorMsg = makeAssistantMsg('Error occurred');
    state = dispatch(state, {
      type: 'SET_CHAT_MESSAGES_COMPAT',
      messages: [makeUserMsg('existing'), errorMsg],
    });

    expect(state.persisted).toHaveLength(2);
    expect(state.optimistic).toHaveLength(0);
  });
});
