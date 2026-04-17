import { describe, expect, it } from 'vitest';

import { buildUnifiedCodexEvent } from '../utils/codexUnifiedEvents.js';

describe('buildUnifiedCodexEvent', () => {
  it('maps command_execution item with structured input/output', () => {
    const result = buildUnifiedCodexEvent({
      event: { type: 'item.completed' },
      transformed: {
        type: 'item',
        itemType: 'command_execution',
        itemId: 'item-cmd-1',
        command: 'ls -la',
        output: 'ok',
        exitCode: 0,
        status: 'completed',
        lifecycle: 'completed',
      },
      sessionId: 'sess-1',
      projectName: 'proj-1',
      clientTurnId: 'turn-1',
    });

    expect(result).toMatchObject({
      type: 'chat-turn-item',
      scope: {
        projectName: 'proj-1',
        provider: 'codex',
        sessionId: 'sess-1',
      },
      clientTurnId: 'turn-1',
      itemId: 'item-cmd-1',
      itemType: 'command_execution',
      lifecycle: 'completed',
      input: { command: 'ls -la' },
      output: { output: 'ok', exitCode: 0, status: 'completed' },
      status: 'completed',
      isError: false,
    });
  });

  it('maps mcp_tool_call input and output payloads', () => {
    const result = buildUnifiedCodexEvent({
      event: { type: 'item.completed' },
      transformed: {
        type: 'item',
        itemType: 'mcp_tool_call',
        itemId: 'item-mcp-1',
        server: 'fs',
        tool: 'read',
        arguments: { path: '/tmp/a.txt' },
        result: { text: 'hello' },
        lifecycle: 'completed',
      },
      sessionId: 'sess-2',
      projectName: 'proj-2',
      clientTurnId: 'turn-2',
    });

    expect(result).toMatchObject({
      type: 'chat-turn-item',
      itemType: 'mcp_tool_call',
      input: {
        server: 'fs',
        tool: 'read',
        arguments: { path: '/tmp/a.txt' },
      },
      output: {
        result: { text: 'hello' },
      },
    });
  });

  it('maps mcp_tool_call errors into output.error and marks isError', () => {
    const result = buildUnifiedCodexEvent({
      event: { type: 'item.completed' },
      transformed: {
        type: 'item',
        itemType: 'mcp_tool_call',
        itemId: 'item-mcp-err',
        server: 'fs',
        tool: 'read',
        arguments: { path: '/tmp/missing.txt' },
        error: { message: 'file not found' },
        lifecycle: 'completed',
      },
      sessionId: 'sess-3',
      projectName: 'proj-3',
      clientTurnId: 'turn-3',
    });

    expect(result).toMatchObject({
      type: 'chat-turn-item',
      itemType: 'mcp_tool_call',
      input: {
        server: 'fs',
        tool: 'read',
        arguments: { path: '/tmp/missing.txt' },
      },
      output: {
        error: { message: 'file not found' },
      },
      isError: true,
    });
  });
});
