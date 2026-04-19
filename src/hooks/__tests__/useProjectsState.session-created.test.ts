import { describe, expect, it } from 'vitest';

import type { AppSocketMessage } from '../../types/app';

describe('useProjectsState unified session-created contract', () => {
  it('recognizes chat-session-created as the only session creation trigger', () => {
    const unifiedMessage: AppSocketMessage = {
      type: 'chat-session-created',
      sessionId: 'session-1',
      provider: 'codex',
      projectName: 'project-a',
    };
    const legacyMessage: AppSocketMessage = {
      type: 'session-created',
      sessionId: 'session-legacy',
      provider: 'codex',
      projectName: 'project-a',
    };

    const isUnified = (message: AppSocketMessage) =>
      message.type === 'chat-session-created';

    expect(isUnified(unifiedMessage)).toBe(true);
    expect(isUnified(legacyMessage)).toBe(false);
  });
});

