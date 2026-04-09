# P0 Stability Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix four silent failure modes that cause degraded UX: provider crash hangs, session-busy silent drops, WebSocket reconnect hammering, and missing DB indexes.

**Architecture:** All server changes are in `server/index.js` (provider error reporting and session-busy notifications). One frontend change in `WebSocketContext.tsx` (exponential backoff). One DB migration in `server/database/db.js` (indexes). Frontend already handles all error message types — no new UI components needed for Tasks 1 and 2.

**Tech Stack:** Node.js/Express, React, better-sqlite3, WebSocket

---

### Task 1: Provider crash error reporting (Fix 1.1)

**Problem:** When a provider (Claude, Cursor, Codex, etc.) throws during query, the `.catch()` only calls `console.error()`. The browser never receives an error message, so `isLoading` stays true forever — infinite spinner.

**Key insight:** The frontend already handles `claude-error`, `cursor-error`, `codex-error`, `gemini-error`, `openrouter-error`, `localgpu-error` at `useChatRealtimeHandlers.ts:795-839` and `:871-881` and `:1290-1297`. It clears loading state, shows error in chat, and supports retry. We only need the server to send these messages.

**Files:**
- Modify: `server/index.js:1553-1554` (Claude), `:1582-1584` (Cursor), `:1611-1613` (Codex), `:1653-1655` (Gemini final), `:1682-1684` (OpenRouter), `:1712-1714` (Local GPU), `:1730-1732` (Cursor resume)

**Step 1: Fix Claude catch block**

In `server/index.js`, find line 1553:

```js
// BEFORE (line 1553-1555):
queryClaudeSDK(data.command, { ...data.options, userId, env: sessionEnv }, writer).catch(error => {
    console.error('[ERROR] Claude query error:', error);
});
```

Replace with:

```js
// AFTER:
queryClaudeSDK(data.command, { ...data.options, userId, env: sessionEnv }, writer).catch(error => {
    console.error('[ERROR] Claude query error:', error);
    if (ws.readyState === WebSocket.OPEN) {
        writer.send({ type: 'claude-error', error: error.message || 'Claude query failed', sessionId });
    }
});
```

**Step 2: Fix Cursor catch block**

In `server/index.js`, find line 1582:

```js
// BEFORE (line 1582-1584):
spawnCursor(data.command, { ...data.options, env: sessionEnv }, writer).catch(error => {
    console.error('[ERROR] Cursor spawn error:', error);
});
```

Replace with:

```js
// AFTER:
spawnCursor(data.command, { ...data.options, env: sessionEnv }, writer).catch(error => {
    console.error('[ERROR] Cursor spawn error:', error);
    if (ws.readyState === WebSocket.OPEN) {
        writer.send({ type: 'cursor-error', error: error.message || 'Cursor spawn failed', sessionId });
    }
});
```

**Step 3: Fix Codex catch block**

In `server/index.js`, find line 1611:

```js
// BEFORE (line 1611-1613):
queryCodex(data.command, { ...data.options, env: sessionEnv }, writer).catch(error => {
    console.error('[ERROR] Codex query error:', error);
});
```

Replace with:

```js
// AFTER:
queryCodex(data.command, { ...data.options, env: sessionEnv }, writer).catch(error => {
    console.error('[ERROR] Codex query error:', error);
    if (ws.readyState === WebSocket.OPEN) {
        writer.send({ type: 'codex-error', error: error.message || 'Codex query failed', sessionId });
    }
});
```

**Step 4: Fix Gemini final catch block**

In `server/index.js`, find line 1653. This is the final `.catch()` in the Gemini chain — it fires only when both Gemini API AND CLI fallback fail:

```js
// BEFORE (line 1653-1655):
                    .catch(error => {
                        console.error('[ERROR] Gemini CLI fallback error:', error);
                    });
```

Replace with:

```js
// AFTER:
                    .catch(error => {
                        console.error('[ERROR] Gemini CLI fallback error:', error);
                        if (ws.readyState === WebSocket.OPEN) {
                            writer.send({ type: 'gemini-error', error: error.message || 'Gemini query failed (API + CLI)', sessionId });
                        }
                    });
```

**Step 5: Fix OpenRouter catch block**

In `server/index.js`, find line 1682:

```js
// BEFORE (line 1682-1684):
queryOpenRouter(data.command, { ...data.options, userId, env: sessionEnv }, writer).catch(error => {
    console.error('[ERROR] OpenRouter query error:', error);
});
```

Replace with:

```js
// AFTER:
queryOpenRouter(data.command, { ...data.options, userId, env: sessionEnv }, writer).catch(error => {
    console.error('[ERROR] OpenRouter query error:', error);
    if (ws.readyState === WebSocket.OPEN) {
        writer.send({ type: 'openrouter-error', error: error.message || 'OpenRouter query failed', sessionId });
    }
});
```

**Step 6: Fix Local GPU catch block**

In `server/index.js`, find line 1712:

```js
// BEFORE (line 1712-1714):
queryLocalGPU(data.command, { ...data.options, userId, env: sessionEnv }, writer).catch(error => {
    console.error('[ERROR] Local GPU query error:', error);
});
```

Replace with:

```js
// AFTER:
queryLocalGPU(data.command, { ...data.options, userId, env: sessionEnv }, writer).catch(error => {
    console.error('[ERROR] Local GPU query error:', error);
    if (ws.readyState === WebSocket.OPEN) {
        writer.send({ type: 'localgpu-error', error: error.message || 'Local GPU query failed', sessionId });
    }
});
```

**Step 7: Fix Cursor resume catch block**

In `server/index.js`, find line 1730:

```js
// BEFORE (line 1730-1732):
                }, writer).catch(error => {
                    console.error('[ERROR] Cursor resume error:', error);
                });
```

Replace with:

```js
// AFTER:
                }, writer).catch(error => {
                    console.error('[ERROR] Cursor resume error:', error);
                    if (ws.readyState === WebSocket.OPEN) {
                        writer.send({ type: 'cursor-error', error: error.message || 'Cursor resume failed', sessionId });
                    }
                });
```

**Step 8: Verify — no frontend changes needed**

Confirm the frontend already handles all error types. The switch statement at `useChatRealtimeHandlers.ts:795-839` handles `claude-error`, `gemini-error`, `openrouter-error`, `localgpu-error` as a fallthrough group. `cursor-error` is handled at `:871-881`. `codex-error` is handled at `:1290-1297`. All three handlers: flush pending stream, clear loading indicators, mark sessions completed, clear permission requests, and show error in chat.

**Step 9: Commit**

```bash
git add server/index.js
git commit -m "fix: send error messages to client when provider crashes mid-stream

Previously, .catch() blocks only called console.error(), leaving the
browser with an infinite loading spinner. The frontend already handles
all provider error message types - this commit adds the missing
writer.send() calls so the browser receives them."
```

---

### Task 2: Session-busy notification (Fix 1.2)

**Problem:** When a session is already active and the user sends another message to it, the server silently returns. The user's message disappears with no feedback.

**Files:**
- Modify: `server/index.js:1548-1551` (Claude), `:1564-1567` (Cursor), `:1593-1596` (Codex), `:1622-1625` (Gemini), `:1664-1667` (OpenRouter), `:1694-1697` (Local GPU), `:1720-1723` (Cursor resume)
- Modify: `src/components/chat/hooks/useChatRealtimeHandlers.ts` — add `session-busy` handler

**Step 1: Fix Claude session guard**

In `server/index.js`, find line 1548:

```js
// BEFORE (line 1548-1551):
if (sessionId && isClaudeSDKSessionActive(sessionId)) {
    console.log(`[WARN] Session ${sessionId} is already active. Ignoring concurrent request.`);
    return;
}
```

Replace with:

```js
// AFTER:
if (sessionId && isClaudeSDKSessionActive(sessionId)) {
    console.log(`[WARN] Session ${sessionId} is already active. Ignoring concurrent request.`);
    if (ws.readyState === WebSocket.OPEN) {
        writer.send({ type: 'session-busy', sessionId, provider: 'claude' });
    }
    return;
}
```

**Step 2: Fix Cursor session guard**

In `server/index.js`, find line 1564:

```js
// BEFORE (line 1564-1567):
if (sessionId && isCursorSessionActive(sessionId)) {
    console.log(`[WARN] Cursor session ${sessionId} is already active. Ignoring concurrent request.`);
    return;
}
```

Replace with:

```js
// AFTER:
if (sessionId && isCursorSessionActive(sessionId)) {
    console.log(`[WARN] Cursor session ${sessionId} is already active. Ignoring concurrent request.`);
    if (ws.readyState === WebSocket.OPEN) {
        writer.send({ type: 'session-busy', sessionId, provider: 'cursor' });
    }
    return;
}
```

**Step 3: Fix Codex session guard**

In `server/index.js`, find line 1593:

```js
// BEFORE (line 1593-1596):
if (sessionId && isCodexSessionActive(sessionId)) {
    console.log(`[WARN] Codex session ${sessionId} is already active. Ignoring concurrent request.`);
    return;
}
```

Replace with:

```js
// AFTER:
if (sessionId && isCodexSessionActive(sessionId)) {
    console.log(`[WARN] Codex session ${sessionId} is already active. Ignoring concurrent request.`);
    if (ws.readyState === WebSocket.OPEN) {
        writer.send({ type: 'session-busy', sessionId, provider: 'codex' });
    }
    return;
}
```

**Step 4: Fix Gemini session guard**

In `server/index.js`, find line 1622:

```js
// BEFORE (line 1622-1625):
if (sessionId && (isGeminiApiSessionActive(sessionId) || isGeminiSessionActive(sessionId))) {
    console.log(`[WARN] Gemini session ${sessionId} is already active. Ignoring concurrent request.`);
    return;
}
```

Replace with:

```js
// AFTER:
if (sessionId && (isGeminiApiSessionActive(sessionId) || isGeminiSessionActive(sessionId))) {
    console.log(`[WARN] Gemini session ${sessionId} is already active. Ignoring concurrent request.`);
    if (ws.readyState === WebSocket.OPEN) {
        writer.send({ type: 'session-busy', sessionId, provider: 'gemini' });
    }
    return;
}
```

**Step 5: Fix OpenRouter session guard**

In `server/index.js`, find line 1664:

```js
// BEFORE (line 1664-1667):
if (sessionId && isOpenRouterSessionActive(sessionId)) {
    console.log(`[WARN] OpenRouter session ${sessionId} is already active. Ignoring concurrent request.`);
    return;
}
```

Replace with:

```js
// AFTER:
if (sessionId && isOpenRouterSessionActive(sessionId)) {
    console.log(`[WARN] OpenRouter session ${sessionId} is already active. Ignoring concurrent request.`);
    if (ws.readyState === WebSocket.OPEN) {
        writer.send({ type: 'session-busy', sessionId, provider: 'openrouter' });
    }
    return;
}
```

**Step 6: Fix Local GPU session guard**

In `server/index.js`, find line 1694:

```js
// BEFORE (line 1694-1697):
if (sessionId && isLocalGPUSessionActive(sessionId)) {
    console.log(`[WARN] Local GPU session ${sessionId} is already active. Ignoring concurrent request.`);
    return;
}
```

Replace with:

```js
// AFTER:
if (sessionId && isLocalGPUSessionActive(sessionId)) {
    console.log(`[WARN] Local GPU session ${sessionId} is already active. Ignoring concurrent request.`);
    if (ws.readyState === WebSocket.OPEN) {
        writer.send({ type: 'session-busy', sessionId, provider: 'local' });
    }
    return;
}
```

**Step 7: Fix Cursor resume session guard**

In `server/index.js`, find line 1720:

```js
// BEFORE (line 1720-1723):
if (sessionId && isCursorSessionActive(sessionId)) {
    console.log(`[WARN] Cursor session ${sessionId} is already active. Ignoring concurrent request.`);
    return;
}
```

Replace with:

```js
// AFTER:
if (sessionId && isCursorSessionActive(sessionId)) {
    console.log(`[WARN] Cursor session ${sessionId} is already active. Ignoring concurrent request.`);
    if (ws.readyState === WebSocket.OPEN) {
        writer.send({ type: 'session-busy', sessionId, provider: 'cursor' });
    }
    return;
}
```

**Step 8: Add session-busy handler in frontend**

In `src/components/chat/hooks/useChatRealtimeHandlers.ts`, find the `lifecycleMessageTypes` Set (around line 381) and add `'session-busy'`:

```ts
// Add to the lifecycleMessageTypes Set:
'session-busy',
```

Then add a new case in the switch statement (after the `session-aborted` case around line 1315):

```ts
case 'session-busy':
    console.warn(`[session-busy] Session ${latestMessage.sessionId} is already processing (${latestMessage.provider})`);
    setChatMessages((previous) => {
        const busyMsg = 'This session is still processing. Please wait for the current response to complete.';
        const last = previous[previous.length - 1];
        if (last?.type === 'error' && last.content === busyMsg) return previous;
        return [...previous, { type: 'error', content: busyMsg, timestamp: new Date() }];
    });
    break;
```

**Step 9: Commit**

```bash
git add server/index.js src/components/chat/hooks/useChatRealtimeHandlers.ts
git commit -m "fix: notify client when session is busy instead of silently dropping messages

Previously, concurrent requests to an active session were silently
ignored with only a server-side console.log. Now sends a session-busy
WebSocket message so the browser can show an inline notification."
```

---

### Task 3: WebSocket exponential backoff (Fix 1.3)

**Problem:** On disconnect, the WebSocket reconnects every 3 seconds forever. If the server is down for 10 minutes, that's 200 connection attempts.

**Files:**
- Modify: `src/contexts/WebSocketContext.tsx:77-120`

**Step 1: Add retry state and implement exponential backoff**

In `src/contexts/WebSocketContext.tsx`, modify the `useWebSocketProviderState` function.

Find line 41 (the `reconnectTimeoutRef` declaration) and add a retry counter after it:

```ts
const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
const retryCountRef = useRef(0);
```

Find the `onopen` handler (line 86-89) and add retry reset:

```ts
// BEFORE:
websocket.onopen = () => {
    setIsConnected(true);
    wsRef.current = websocket;
};

// AFTER:
websocket.onopen = () => {
    retryCountRef.current = 0;
    setIsConnected(true);
    wsRef.current = websocket;
};
```

Find the `onclose` handler (line 103-111) and replace the fixed timeout:

```ts
// BEFORE:
websocket.onclose = () => {
    setIsConnected(false);
    wsRef.current = null;
    
    reconnectTimeoutRef.current = setTimeout(() => {
        if (unmountedRef.current) return;
        connect();
    }, 3000);
};

// AFTER:
websocket.onclose = () => {
    setIsConnected(false);
    wsRef.current = null;
    
    const delay = Math.min(3000 * Math.pow(2, retryCountRef.current), 30000);
    retryCountRef.current++;
    reconnectTimeoutRef.current = setTimeout(() => {
        if (unmountedRef.current) return;
        connect();
    }, delay);
};
```

**Step 2: Reset retry count on cleanup**

In the `useEffect` cleanup (line 63-74), add retry reset:

```ts
return () => {
    unmountedRef.current = true;
    retryCountRef.current = 0;
    if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
    }
    if (drainTimerRef.current) {
        clearTimeout(drainTimerRef.current);
    }
    if (wsRef.current) {
        wsRef.current.close();
    }
};
```

**Step 3: Commit**

```bash
git add src/contexts/WebSocketContext.tsx
git commit -m "fix: use exponential backoff for WebSocket reconnection

Replaces fixed 3-second reconnect interval with exponential backoff:
3s -> 6s -> 12s -> 24s -> 30s (cap). Resets to 3s on successful
connection. Prevents hammering the server during extended outages."
```

---

### Task 4: Add missing database indexes (Fix 1.4)

**Problem:** `session_metadata` sorts by `last_activity` but has no index on that column. The hot query at `db.js:1084` does a full table scan.

**Files:**
- Modify: `server/database/db.js` (add indexes in `runMigrations()`)

**Step 1: Add index migration**

In `server/database/db.js`, find the end of the `runMigrations()` function (look for the last `db.exec(` block before the closing `} catch`). Add the following migration before the catch:

```js
    // Migration: add performance indexes for session_metadata sorting
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_session_metadata_last_activity ON session_metadata(last_activity);
      CREATE INDEX IF NOT EXISTS idx_session_metadata_project_activity ON session_metadata(project_name, last_activity);
    `);
```

Using `CREATE INDEX IF NOT EXISTS` makes this idempotent — safe to run on both new and existing databases.

**Step 2: Commit**

```bash
git add server/database/db.js
git commit -m "perf: add indexes for session_metadata last_activity sorting

The hot query in getSessionsByProjects() sorts by last_activity DESC
but had no index, requiring a full table scan. Adds single-column
and composite (project_name, last_activity) indexes."
```
