const SUPPORTED_CODEX_RUNTIME_MODES = new Set(['legacy', 'shadow', 'bridge']);
const DEFAULT_CODEX_RUNTIME_MODE = 'bridge';
const CODEX_RUNTIME_MODE_ENV = 'CODEX_RUNTIME_MODE';

export function normalizeCodexRuntimeMode(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (SUPPORTED_CODEX_RUNTIME_MODES.has(normalized)) {
    return normalized;
  }
  return DEFAULT_CODEX_RUNTIME_MODE;
}

export function getCodexRuntimeModeFromEnv(env = process.env) {
  return normalizeCodexRuntimeMode(env?.[CODEX_RUNTIME_MODE_ENV]);
}

export {
  CODEX_RUNTIME_MODE_ENV,
  DEFAULT_CODEX_RUNTIME_MODE,
  SUPPORTED_CODEX_RUNTIME_MODES,
};
