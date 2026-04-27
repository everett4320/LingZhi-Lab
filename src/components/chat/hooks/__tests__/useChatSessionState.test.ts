import { describe, expect, it } from 'vitest';

import {
  hasPendingOptimisticSessionState,
  hasTemporaryProcessingSessionKeys,
} from '../useChatSessionState';
import { reconcileSessionInputStateId } from '../../utils/codexQueue';

describe('useChatSessionState temporary session helpers', () => {
  it('treats temp sessions as pending optimistic sessions', () => {
    expect(hasPendingOptimisticSessionState(null, 'new-session-123')).toBe(true);
    expect(hasPendingOptimisticSessionState(null, 'temp-123')).toBe(true);
    expect(hasPendingOptimisticSessionState({ sessionId: null, startedAt: Date.now() }, null)).toBe(true);
    expect(hasPendingOptimisticSessionState(null, 'sess-123')).toBe(false);
  });

  it('detects temporary processing keys for both raw and scoped temp ids', () => {
    expect(hasTemporaryProcessingSessionKeys(new Set(['new-session-1']))).toBe(true);
    expect(hasTemporaryProcessingSessionKeys(new Set(['temp-1']))).toBe(true);
    expect(hasTemporaryProcessingSessionKeys(new Set(['proj-a::codex::new-session-2']))).toBe(true);
    expect(hasTemporaryProcessingSessionKeys(new Set(['proj-a::codex::temp-2']))).toBe(true);
    expect(hasTemporaryProcessingSessionKeys(new Set(['proj-a::codex::sess-2']))).toBe(false);
    expect(hasTemporaryProcessingSessionKeys(new Set(['sess-2']))).toBe(false);
  });

  it('keeps input-state ownership stable when provisional session id is rebound after reconnect', () => {
    const provisionalSessionId = 'new-session-123';
    const actualSessionId = 'session-abc';
    const stateBySession = {
      [provisionalSessionId]: {
        composerDraft: null,
        queuedUserMessages: [
          {
            id: 'turn-1',
            text: 'queued turn',
            textElements: [],
            localImages: [],
            remoteImageUrls: [],
            mentionBindings: [],
            createdAt: Date.now(),
          },
        ],
        pendingSteers: [],
        rejectedSteersQueue: [],
        recentSteerRejections: [],
        activeTurnId: null,
        taskRunning: false,
        sessionBinding: {
          provisionalSessionId,
          sessionId: null,
        },
        interruptRequestedForPendingSteers: false,
      },
    };

    const reconciled = reconcileSessionInputStateId(
      stateBySession as any,
      provisionalSessionId,
      actualSessionId,
    );

    expect(reconciled[provisionalSessionId]).toBeUndefined();
    expect(reconciled[actualSessionId]?.queuedUserMessages?.[0]?.id).toBe('turn-1');
  });
});
