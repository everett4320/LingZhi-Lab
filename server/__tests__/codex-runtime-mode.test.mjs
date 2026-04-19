import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CODEX_RUNTIME_MODE,
  normalizeCodexRuntimeMode,
  getCodexRuntimeModeFromEnv,
} from '../utils/codexRuntimeMode.js';

describe('codex runtime mode', () => {
  it('defaults to bridge mode', () => {
    expect(DEFAULT_CODEX_RUNTIME_MODE).toBe('bridge');
    expect(normalizeCodexRuntimeMode(undefined)).toBe('bridge');
    expect(normalizeCodexRuntimeMode('')).toBe('bridge');
    expect(normalizeCodexRuntimeMode('invalid')).toBe('bridge');
  });

  it('normalizes legacy shadow bridge modes', () => {
    expect(normalizeCodexRuntimeMode('legacy')).toBe('legacy');
    expect(normalizeCodexRuntimeMode('shadow')).toBe('shadow');
    expect(normalizeCodexRuntimeMode('bridge')).toBe('bridge');
    expect(normalizeCodexRuntimeMode('BRIDGE')).toBe('bridge');
  });

  it('reads mode from env', () => {
    expect(getCodexRuntimeModeFromEnv({ CODEX_RUNTIME_MODE: 'shadow' })).toBe('shadow');
    expect(getCodexRuntimeModeFromEnv({ CODEX_RUNTIME_MODE: 'bridge' })).toBe('bridge');
    expect(getCodexRuntimeModeFromEnv({ CODEX_RUNTIME_MODE: 'unknown' })).toBe('bridge');
  });
});
