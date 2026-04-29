import os from 'os';
import path from 'path';

const DEFAULT_LINGZHI_CODEX_HOME = path.join(os.homedir(), '.codex');

function normalizePath(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return path.resolve(trimmed);
}

export function getLingzhiCodexHome(env = process.env) {
  const fromLingzhiEnv = normalizePath(env?.LINGZHI_CODEX_HOME);
  if (fromLingzhiEnv) {
    return fromLingzhiEnv;
  }

  return DEFAULT_LINGZHI_CODEX_HOME;
}

export function getLingzhiCodexSessionsRoot(env = process.env) {
  return path.join(getLingzhiCodexHome(env), 'sessions');
}

export function getLingzhiCodexConfigPath(env = process.env) {
  return path.join(getLingzhiCodexHome(env), 'config.toml');
}

export function buildLingzhiCodexRuntimeEnv(baseEnv = process.env) {
  const codexHome = getLingzhiCodexHome(baseEnv);
  return {
    ...baseEnv,
    CODEX_HOME: codexHome,
  };
}
