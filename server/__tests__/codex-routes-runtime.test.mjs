import { describe, expect, it, vi } from 'vitest';

vi.mock('../utils/codexRuntimeMode.js', () => ({
  getCodexRuntimeModeFromEnv: vi.fn(() => 'shadow'),
}));

vi.mock('../utils/codexShadowParity.js', () => ({
  getCodexShadowParitySnapshot: vi.fn(() => ({
    comparisons: 12,
    diffCounts: {
      match: 10,
      warning: 2,
      blocking: 0,
    },
    goNoGo: {
      passed: true,
    },
  })),
  resetCodexShadowParityMetrics: vi.fn(() => {}),
}));

async function resolveRouteHandler(path, method) {
  const mod = await import('../routes/codex.js');
  const stack = mod.default?.stack || [];
  const layer = stack.find((entry) => entry?.route?.path === path && entry.route?.methods?.[method]);
  if (!layer) {
    throw new Error(`Route ${method.toUpperCase()} ${path} not found`);
  }
  return layer.route.stack[0].handle;
}

function createMockResponse() {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.payload = data;
      return this;
    },
  };
}

describe('codex runtime/parity routes', () => {
  it('returns runtime mode from /runtime-mode', async () => {
    const handler = await resolveRouteHandler('/runtime-mode', 'get');
    const res = createMockResponse();

    await handler({}, res);
    expect(res.statusCode).toBe(200);
    expect(res.payload).toEqual({
      success: true,
      runtimeMode: 'shadow',
    });
  });

  it('returns parity snapshot from /parity', async () => {
    const handler = await resolveRouteHandler('/parity', 'get');
    const res = createMockResponse();

    await handler({}, res);
    expect(res.statusCode).toBe(200);
    expect(res.payload).toEqual(expect.objectContaining({
      success: true,
      runtimeMode: 'shadow',
      parity: expect.objectContaining({
        comparisons: 12,
      }),
    }));
  });

  it('resets parity snapshot from /parity/reset', async () => {
    const { resetCodexShadowParityMetrics } = await import('../utils/codexShadowParity.js');
    const handler = await resolveRouteHandler('/parity/reset', 'post');
    const res = createMockResponse();

    await handler({}, res);
    expect(resetCodexShadowParityMetrics).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
    expect(res.payload).toEqual(expect.objectContaining({
      success: true,
      runtimeMode: 'shadow',
    }));
  });
});

