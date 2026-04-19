import { beforeEach, describe, expect, it } from 'vitest';

import {
  getCodexShadowParitySnapshot,
  recordCodexShadowParityComparison,
  resetCodexShadowParityMetrics,
} from '../utils/codexShadowParity.js';

describe('codex shadow parity metrics', () => {
  beforeEach(() => {
    resetCodexShadowParityMetrics();
  });

  it('records match/warning/blocking classifications and lane metrics', () => {
    recordCodexShadowParityComparison({
      operation: 'query',
      primary: {
        ok: true,
        status: 200,
        terminalState: 'completed',
        accepted: true,
        hasTerminalEvent: true,
        latencyMs: 500,
        sessionId: 's-1',
        provisionalSessionId: 'new-session-1',
      },
      secondary: {
        ok: true,
        status: 200,
        terminalState: 'completed',
        accepted: true,
        hasTerminalEvent: true,
        latencyMs: 650,
        sessionId: 's-1',
        provisionalSessionId: 'new-session-1',
      },
    });

    recordCodexShadowParityComparison({
      operation: 'query',
      primary: {
        ok: true,
        status: 200,
        terminalState: 'completed',
        latencyMs: 400,
        sessionId: 's-2',
      },
      secondary: {
        ok: true,
        status: 200,
        terminalState: 'completed',
        latencyMs: 420,
        sessionId: 's-2-drift',
      },
    });

    recordCodexShadowParityComparison({
      operation: 'interrupt',
      primary: {
        ok: true,
        status: 200,
        terminalState: 'interrupted',
        interrupted: true,
        hasTerminalEvent: true,
        latencyMs: 300,
        sessionId: 's-3',
      },
      secondary: {
        ok: false,
        status: 500,
        terminalState: 'failed',
        interrupted: false,
        hasTerminalEvent: false,
        latencyMs: 900,
        sessionId: 's-3',
      },
    });

    const snapshot = getCodexShadowParitySnapshot();
    expect(snapshot.comparisons).toBe(3);
    expect(snapshot.diffCounts.match).toBe(1);
    expect(snapshot.diffCounts.warning).toBe(1);
    expect(snapshot.diffCounts.blocking).toBe(1);

    expect(snapshot.operations.query).toEqual(expect.objectContaining({
      count: 2,
      match: 1,
      warning: 1,
      blocking: 0,
    }));
    expect(snapshot.operations.interrupt).toEqual(expect.objectContaining({
      count: 1,
      blocking: 1,
    }));

    expect(snapshot.lanes.primary.count).toBe(3);
    expect(snapshot.lanes.secondary.count).toBe(3);
    expect(snapshot.lanes.primary.successRate).toBeCloseTo(1);
    expect(snapshot.lanes.secondary.successRate).toBeCloseTo(2 / 3);
    expect(snapshot.recentComparisons.length).toBe(3);
  });

  it('derives go/no-go gates from recorded metrics', () => {
    recordCodexShadowParityComparison({
      operation: 'query',
      primary: {
        ok: true,
        status: 200,
        terminalState: 'completed',
        latencyMs: 100,
      },
      secondary: {
        ok: true,
        status: 200,
        terminalState: 'completed',
        latencyMs: 120,
      },
    });

    const healthy = getCodexShadowParitySnapshot();
    expect(healthy.goNoGo.blockingDiffGatePassed).toBe(true);
    expect(healthy.goNoGo.latencyGatePassed).toBe(true);
    expect(healthy.goNoGo.successGatePassed).toBe(true);
    expect(healthy.goNoGo.passed).toBe(true);

    recordCodexShadowParityComparison({
      operation: 'query',
      primary: {
        ok: true,
        status: 200,
        terminalState: 'completed',
        latencyMs: 90,
      },
      secondary: {
        ok: false,
        status: 500,
        terminalState: 'failed',
        latencyMs: 3000,
      },
    });

    const degraded = getCodexShadowParitySnapshot();
    expect(degraded.goNoGo.blockingDiffGatePassed).toBe(false);
    expect(degraded.goNoGo.passed).toBe(false);
  });
});

