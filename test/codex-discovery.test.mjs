import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import { mkdtemp, rm } from 'node:fs/promises';

import { checkCodexCredentials } from '../server/routes/cli-auth.js';
import { collectCodexProjectCandidates, encodeProjectPath } from '../server/projects.js';

async function withTempHome(t, fn) {
  const tempHome = await mkdtemp(path.join(os.tmpdir(), 'dr-claw-codex-test-'));
  const originalEnv = {
    CODEX_CLI_PATH: process.env.CODEX_CLI_PATH,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    MOCK_MISSING_CLIS: process.env.MOCK_MISSING_CLIS,
  };

  // Use Node binary as Codex CLI stand-in — it passes the existence check
  // in resolveAvailableCliCommand. If that function adds version verification,
  // this will need a proper mock.
  process.env.CODEX_CLI_PATH = process.execPath;
  delete process.env.OPENAI_API_KEY;
  delete process.env.MOCK_MISSING_CLIS;

  t.mock.method(os, 'homedir', () => tempHome);

  t.after(async () => {
    if (originalEnv.CODEX_CLI_PATH === undefined) delete process.env.CODEX_CLI_PATH;
    else process.env.CODEX_CLI_PATH = originalEnv.CODEX_CLI_PATH;

    if (originalEnv.OPENAI_API_KEY === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalEnv.OPENAI_API_KEY;

    if (originalEnv.MOCK_MISSING_CLIS === undefined) delete process.env.MOCK_MISSING_CLIS;
    else process.env.MOCK_MISSING_CLIS = originalEnv.MOCK_MISSING_CLIS;

    await rm(tempHome, { recursive: true, force: true });
  });

  await fn(tempHome);
}

test('checkCodexCredentials accepts server OPENAI_API_KEY when auth.json is absent', async (t) => {
  await withTempHome(t, async () => {
    process.env.OPENAI_API_KEY = 'sk-test';

    const result = await checkCodexCredentials();

    assert.equal(result.authenticated, true);
    assert.equal(result.email, 'API Key (Env)');
    assert.equal(result.cliAvailable, true);
    assert.equal(result.cliCommand, process.execPath);
  });
});

test('checkCodexCredentials keeps cliAvailable true when codex is installed but not configured', async (t) => {
  await withTempHome(t, async () => {
    const result = await checkCodexCredentials();

    assert.equal(result.authenticated, false);
    assert.equal(result.error, 'Codex not configured');
    assert.equal(result.cliAvailable, true);
    assert.equal(result.cliCommand, process.execPath);
  });
});

test('collectCodexProjectCandidates derives project candidates from codex session index data', () => {
  const projectPath = path.join('/tmp', 'workspace', 'codex-only-project');
  const sessionsByProject = new Map([
    ['normalized-a', [
      {
        id: 'codex-session-1',
        cwd: projectPath,
        summary: 'Inspect repository structure',
        messageCount: 2,
      },
    ]],
    ['normalized-b', [
      {
        id: 'codex-session-2',
        cwd: projectPath,
        summary: 'Explain the build pipeline',
        messageCount: 4,
      },
    ]],
  ]);

  const candidates = collectCodexProjectCandidates(sessionsByProject);

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].projectName, encodeProjectPath(projectPath));
  assert.equal(candidates[0].projectPath, projectPath);
  assert.deepEqual(candidates[0].sessions.map((session) => session.id), [
    'codex-session-1',
    'codex-session-2',
  ]);
});
