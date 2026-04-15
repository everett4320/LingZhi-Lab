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
const auditScript = path.join(repoRoot, 'packaging', 'audit-desktop-artifact.mjs');

const tempDirs = [];

function makeTempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingzhi-audit-test-'));
  tempDirs.push(dir);
  fs.mkdirSync(path.join(dir, 'packaging'), { recursive: true });
  fs.copyFileSync(auditScript, path.join(dir, 'packaging', 'audit-desktop-artifact.mjs'));
  fs.mkdirSync(path.join(dir, 'release', 'win-unpacked', 'resources', 'app.asar.unpacked'), { recursive: true });
  return dir;
}

function runAudit(cwd) {
  return spawnSync(process.execPath, [path.join(cwd, 'packaging', 'audit-desktop-artifact.mjs')], {
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

describe('desktop packaging: artifact audit script', () => {
  it('fails when unpacked root is missing', () => {
    const tempRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'lingzhi-audit-missing-'));
    tempDirs.push(tempRepo);
    fs.mkdirSync(path.join(tempRepo, 'packaging'), { recursive: true });
    fs.copyFileSync(auditScript, path.join(tempRepo, 'packaging', 'audit-desktop-artifact.mjs'));
    const result = runAudit(tempRepo);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Missing unpacked directory');
  });

  it('passes when unpacked files are clean', () => {
    const tempRepo = makeTempRepo();
    fs.mkdirSync(path.join(tempRepo, 'release', 'win-unpacked', 'resources', 'app.asar.unpacked', 'node_modules', 'native-mod'), { recursive: true });
    fs.writeFileSync(
      path.join(tempRepo, 'release', 'win-unpacked', 'resources', 'app.asar.unpacked', 'node_modules', 'native-mod', 'index.js'),
      'module.exports = {};\n',
      'utf8',
    );
    const result = runAudit(tempRepo);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Passed');
  });

  it('fails on sourcemap leakage', () => {
    const tempRepo = makeTempRepo();
    fs.mkdirSync(path.join(tempRepo, 'release', 'win-unpacked', 'resources', 'app.asar.unpacked', 'node_modules', 'native-mod'), { recursive: true });
    fs.writeFileSync(
      path.join(tempRepo, 'release', 'win-unpacked', 'resources', 'app.asar.unpacked', 'node_modules', 'native-mod', 'index.js.map'),
      '{}\n',
      'utf8',
    );
    const result = runAudit(tempRepo);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('index.js.map');
  });

  it('fails on test file leakage', () => {
    const tempRepo = makeTempRepo();
    fs.mkdirSync(path.join(tempRepo, 'release', 'win-unpacked', 'resources', 'app.asar.unpacked', 'node_modules', 'native-mod'), { recursive: true });
    fs.writeFileSync(
      path.join(tempRepo, 'release', 'win-unpacked', 'resources', 'app.asar.unpacked', 'node_modules', 'native-mod', 'feature.test.js'),
      'test content\n',
      'utf8',
    );
    const result = runAudit(tempRepo);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('feature.test.js');
  });

  it('fails on source TypeScript leakage under src', () => {
    const tempRepo = makeTempRepo();
    fs.mkdirSync(path.join(tempRepo, 'release', 'win-unpacked', 'resources', 'app.asar.unpacked', 'node_modules', 'native-mod', 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(tempRepo, 'release', 'win-unpacked', 'resources', 'app.asar.unpacked', 'node_modules', 'native-mod', 'src', 'index.ts'),
      'export const x = 1;\n',
      'utf8',
    );
    const result = runAudit(tempRepo);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('src/index.ts');
  });
});
