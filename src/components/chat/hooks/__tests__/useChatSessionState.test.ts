import { describe, expect, it } from 'vitest';

import {
  hasPendingOptimisticSessionState,
  hasTemporaryProcessingSessionKeys,
} from '../useChatSessionState';
import { reconcileSessionQueueId } from '../../utils/codexQueue';

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

  it('keeps queue ownership stable when provisional session id is rebound after reconnect', () => {
    const provisionalSessionId = 'new-session-123';
    const actualSessionId = 'session-abc';
    const queue = {
      [provisionalSessionId]: [
        {
          id: 'turn-1',
          sessionId: provisionalSessionId,
          text: 'queued turn',
          kind: 'normal',
          status: 'queued',
          createdAt: Date.now(),
        },
      ],
    };

    const reconciled = reconcileSessionQueueId(
      queue as any,
      provisionalSessionId,
      actualSessionId,
    );

    expect(reconciled[provisionalSessionId]).toBeUndefined();
    expect(reconciled[actualSessionId]?.[0]?.sessionId).toBe(actualSessionId);
    expect(reconciled[actualSessionId]?.[0]?.id).toBe('turn-1');
  });
});
