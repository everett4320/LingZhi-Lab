import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import ChatMessagesPane from '../subcomponents/ChatMessagesPane';
import type { ChatMessage } from '../../types/types';
import type { Project } from '../../../../types/app';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (!params) {
        return key;
      }
      const serialized = Object.entries(params)
        .map(([paramKey, value]) => `${paramKey}:${String(value)}`)
        .join(',');
      return `${key}[${serialized}]`;
    },
  }),
}));

vi.mock('../../../SessionProviderLogo', () => ({
  __esModule: true,
  default: ({ provider }: { provider?: string }) => (
    <span data-testid="session-provider-logo">{provider || 'codex'}</span>
  ),
}));

const NOOP = () => {};

const baseProject: Project = {
  name: 'proj-a',
  displayName: 'Project A',
  fullPath: 'C:/workspace/proj-a',
  codexSessions: [],
};

const buildToolMessage = ({
  id,
  toolId,
  toolName = 'McpToolCall',
  command,
  output,
}: {
  id: string;
  toolId: string;
  toolName?: string;
  command: string;
  output: string;
}): ChatMessage => ({
  id,
  type: 'assistant',
  content: '',
  timestamp: new Date('2026-04-16T00:00:00.000Z'),
  isToolUse: true,
  toolName,
  toolId,
  toolInput: { command },
  toolResult: {
    content: output,
    isError: false,
  },
  displayText: '',
});

function renderPane({
  chatMessages,
  visibleMessages,
}: {
  chatMessages: ChatMessage[];
  visibleMessages: ChatMessage[];
}) {
  return renderToStaticMarkup(
    <ChatMessagesPane
      scrollContainerRef={{ current: null }}
      onWheel={NOOP}
      onTouchMove={NOOP}
      isLoadingSessionMessages={false}
      chatMessages={chatMessages}
      selectedSession={null}
      currentSessionId={null}
      provider="codex"
      isLoadingMoreMessages={false}
      hasMoreMessages={false}
      totalMessages={visibleMessages.length}
      sessionMessagesCount={visibleMessages.length}
      visibleMessageCount={visibleMessages.length}
      visibleMessages={visibleMessages}
      loadEarlierMessages={NOOP}
      loadAllMessages={NOOP}
      allMessagesLoaded={false}
      isLoadingAllMessages={false}
      loadAllJustFinished={false}
      showLoadAllOverlay={false}
      createDiff={() => []}
      onGrantToolPermission={() => ({ success: true })}
      selectedProject={baseProject}
      isLoading={false}
      onRetry={NOOP}
    />,
  );
}

describe('ChatMessagesPane tool UI session safety', () => {
  it('renders tool input and result fields for chat-turn-item style messages', () => {
    const toolMessage = buildToolMessage({
      id: 'active-tool',
      toolId: 'tool-active-1',
      toolName: 'McpToolCall',
      command: 'Get-ChildItem -Force',
      output: 'Mode LastWriteTime Length Name',
    });

    const html = renderPane({
      chatMessages: [toolMessage],
      visibleMessages: [toolMessage],
    });

    expect(html).toContain('Get-ChildItem -Force');
    expect(html).toContain('Mode LastWriteTime Length Name');
    expect(html).toContain('tool-result-tool-active-1');
  });

  it('does not render tool cards from messages outside visible session scope', () => {
    const activeSessionTool = buildToolMessage({
      id: 'active-tool',
      toolId: 'tool-active-1',
      toolName: 'McpToolCall',
      command: 'echo active-session',
      output: 'active-output',
    });

    const otherSessionTool = buildToolMessage({
      id: 'other-tool',
      toolId: 'tool-other-1',
      toolName: 'McpToolCall',
      command: 'echo leaked-session',
      output: 'leaked-output',
    });

    const html = renderPane({
      chatMessages: [activeSessionTool, otherSessionTool],
      visibleMessages: [activeSessionTool],
    });

    expect(html).toContain('echo active-session');
    expect(html).toContain('active-output');

    expect(html).not.toContain('echo leaked-session');
    expect(html).not.toContain('leaked-output');
    expect(html).not.toContain('tool-result-tool-other-1');
  });
});
