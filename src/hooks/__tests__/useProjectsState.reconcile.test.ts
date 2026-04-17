import { describe, expect, it } from 'vitest';

describe('projects reconciliation policy', () => {
  it('keeps selected session on first missing snapshot and clears on second when inactive', () => {
    const missingCounts = new Map<string, number>();
    const identity = 'proj-a::codex::sess-1';

    const applyMissing = (isActive: boolean) => {
      const next = (missingCounts.get(identity) || 0) + 1;
      missingCounts.set(identity, next);
      if (isActive) {
        return false;
      }
      return next >= 2;
    };

    expect(applyMissing(false)).toBe(false);
    expect(applyMissing(false)).toBe(true);
  });

  it('never clears selected session while the scope is active', () => {
    const missingCounts = new Map<string, number>();
    const identity = 'proj-a::codex::sess-1';

    const applyMissing = (isActive: boolean) => {
      const next = (missingCounts.get(identity) || 0) + 1;
      missingCounts.set(identity, next);
      if (isActive) {
        return false;
      }
      return next >= 2;
    };

    expect(applyMissing(true)).toBe(false);
    expect(applyMissing(true)).toBe(false);
    expect(applyMissing(true)).toBe(false);
  });
});

