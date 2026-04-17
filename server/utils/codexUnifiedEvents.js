function buildCodexScope(projectName, sessionId) {
  if (!projectName || !sessionId) {
    return null;
  }
  return {
    projectName,
    provider: 'codex',
    sessionId,
  };
}

function compactObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).filter(([, current]) => current !== undefined),
  );
}

export function buildUnifiedCodexEvent({
  event,
  transformed,
  sessionId,
  projectName,
  clientTurnId = null,
  provisionalSessionId = null,
}) {
  const scope = buildCodexScope(projectName, sessionId);
  if (!scope || !event?.type) {
    return null;
  }

  if (event.type === 'thread.started') {
    return {
      type: 'chat-session-created',
      scope,
      provisionalSessionId: provisionalSessionId || undefined,
      displayName: null,
      mode: 'research',
      createdAt: Date.now(),
      model: null,
    };
  }

  if (event.type === 'turn.started') {
    return {
      type: 'chat-turn-accepted',
      scope,
      clientTurnId: clientTurnId || sessionId,
      provisionalSessionId: provisionalSessionId || undefined,
      queued: false,
    };
  }

  if (event.type === 'turn.completed') {
    return {
      type: 'chat-turn-complete',
      scope,
      clientTurnId: clientTurnId || sessionId,
      usage: event.usage,
    };
  }

  if (event.type === 'turn.failed') {
    return {
      type: 'chat-turn-error',
      scope,
      clientTurnId: clientTurnId || sessionId,
      error: event.error?.message || 'Turn failed',
      errorType: event.error?.type || event.error?.code,
      isRetryable: true,
    };
  }

  if (event.type === 'error') {
    return {
      type: 'chat-turn-error',
      scope,
      clientTurnId: clientTurnId || sessionId,
      error: event.message || 'Codex error',
      isRetryable: true,
    };
  }

  if (!transformed || transformed.type !== 'item') {
    return null;
  }

  const itemId = transformed.itemId || event.item?.id || `${sessionId}-${Date.now()}`;
  const lifecycle = transformed.lifecycle === 'started'
    ? 'started'
    : transformed.lifecycle === 'completed'
      ? 'completed'
      : 'updated';

  if (transformed.itemType === 'agent_message') {
    const content = transformed.message?.content;
    if (!content || !String(content).trim()) {
      return null;
    }
    return {
      type: 'chat-turn-delta',
      scope,
      clientTurnId: clientTurnId || sessionId,
      messageId: itemId,
      role: 'assistant',
      partKind: transformed.isSystemPrompt ? 'thinking' : 'text',
      textDelta: String(content),
    };
  }

  let input;
  let output;

  if (transformed.itemType === 'command_execution') {
    input = compactObject({
      command: transformed.command || undefined,
    });
    output = compactObject({
      output: transformed.output,
      exitCode: Number.isFinite(transformed.exitCode)
        ? transformed.exitCode
        : undefined,
      status: transformed.status,
    });
  } else if (transformed.itemType === 'file_change') {
    input = compactObject({
      changes: Array.isArray(transformed.changes) ? transformed.changes : undefined,
    });
    output = compactObject({
      status: transformed.status,
    });
  } else if (transformed.itemType === 'mcp_tool_call') {
    input = compactObject({
      server: transformed.server,
      tool: transformed.tool,
      arguments: transformed.arguments,
    });
    output = transformed.error
      ? { error: transformed.error }
      : transformed.result !== undefined
        ? { result: transformed.result }
        : undefined;
  } else if (transformed.itemType === 'web_search') {
    input = compactObject({
      query: transformed.query,
    });
    output = undefined;
  } else {
    input = transformed.command
      || transformed.arguments
      || transformed.query
      || transformed.changes
      || transformed.item
      || undefined;
    output = transformed.output || transformed.result || transformed.message || undefined;
  }

  return {
    type: 'chat-turn-item',
    scope,
    clientTurnId: clientTurnId || sessionId,
    itemId,
    itemType: transformed.itemType || 'item',
    lifecycle,
    title: transformed.itemType || undefined,
    input,
    output,
    status: transformed.status || undefined,
    isError: transformed.itemType === 'error' || Boolean(transformed.error),
  };
}
