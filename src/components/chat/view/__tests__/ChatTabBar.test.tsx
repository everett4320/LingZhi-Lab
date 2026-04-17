import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import ChatTabBar from '../ChatTabBar';

describe('ChatTabBar', () => {
  it('renders a stable placeholder when there are no tabs', () => {
    const html = renderToStaticMarkup(
      <ChatTabBar
        tabs={[]}
        processingSessions={new Set()}
        onSwitchTab={() => {}}
        onCloseTab={() => {}}
        onNewTab={() => {}}
      />,
    );

    expect(html).toContain('aria-hidden="true"');
  });

  it('shows processing indicator when scoped processing key is present', () => {
    const html = renderToStaticMarkup(
      <ChatTabBar
        tabs={[
          {
            id: 'tab-1',
            sessionId: 'sess-1',
            provider: 'codex',
            projectName: 'proj-a',
            title: 'Session A',
            isActive: true,
          },
        ]}
        processingSessions={new Set(['proj-a::codex::sess-1'])}
        onSwitchTab={() => {}}
        onCloseTab={() => {}}
        onNewTab={() => {}}
      />,
    );

    expect(html).toContain('animate-pulse');
  });
});
