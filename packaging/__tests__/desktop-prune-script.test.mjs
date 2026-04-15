import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');
const pruneScript = path.join(repoRoot, 'packaging', 'prune-windows-unpacked.mjs');

const tempDirs = [];

function makeTempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingzhi-prune-test-'));
  tempDirs.push(dir);
  fs.mkdirSync(path.join(dir, 'packaging'), { recursive: true });
  fs.copyFileSync(pruneScript, path.join(dir, 'packaging', 'prune-windows-unpacked.mjs'));
  fs.mkdirSync(path.join(dir, 'release', 'win-unpacked', 'resources', 'app.asar.unpacked'), { recursive: true });
  return dir;
}

function runPrune(cwd) {
  return spawnSync(process.execPath, [path.join(cwd, 'packaging', 'prune-windows-unpacked.mjs')], {
    cwd,
    encoding: 'utf8',
  });
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('desktop packaging: prune unpacked script', () => {
  it('skips when unpacked directory does not exist', () => {
    const tempRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'lingzhi-prune-missing-'));
    tempDirs.push(tempRepo);
    fs.mkdirSync(path.join(tempRepo, 'packaging'), { recursive: true });
    fs.copyFileSync(pruneScript, path.join(tempRepo, 'packaging', 'prune-windows-unpacked.mjs'));
    const result = runPrune(tempRepo);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Skip: missing unpacked directory');
  });

  it('removes map/test/src-ts leakage files and keeps runtime js files', () => {
    const tempRepo = makeTempRepo();
    const modRoot = path.join(tempRepo, 'release', 'win-unpacked', 'resources', 'app.asar.unpacked', 'node_modules', 'node-pty');
    fs.mkdirSync(path.join(modRoot, 'lib'), { recursive: true });
    fs.mkdirSync(path.join(modRoot, 'src'), { recursive: true });
    fs.writeFileSync(path.join(modRoot, 'lib', 'index.js.map'), '{}\n', 'utf8');
    fs.writeFileSync(path.join(modRoot, 'lib', 'terminal.test.js'), 'test\n', 'utf8');
    fs.writeFileSync(path.join(modRoot, 'src', 'terminal.ts'), 'export const t = 1;\n', 'utf8');
    fs.writeFileSync(path.join(modRoot, 'lib', 'index.js'), 'module.exports = {};\n', 'utf8');

    const result = runPrune(tempRepo);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Removed 3 files');

    expect(fs.existsSync(path.join(modRoot, 'lib', 'index.js'))).toBe(true);
    expect(fs.existsSync(path.join(modRoot, 'lib', 'index.js.map'))).toBe(false);
    expect(fs.existsSync(path.join(modRoot, 'lib', 'terminal.test.js'))).toBe(false);
    expect(fs.existsSync(path.join(modRoot, 'src', 'terminal.ts'))).toBe(false);
  });
});
