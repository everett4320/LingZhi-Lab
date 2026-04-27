import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const packageJsonPath = path.join(repoRoot, 'package.json');
const preloadPath = path.join(repoRoot, 'electron', 'preload.cjs');
const mainPath = path.join(repoRoot, 'electron', 'main.mjs');
const playbookPath = path.join(repoRoot, 'docs', 'custom-branch-playbook.zh-CN.md');

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const preloadSource = fs.readFileSync(preloadPath, 'utf8');
const mainSource = fs.readFileSync(mainPath, 'utf8');
const playbookSource = fs.readFileSync(playbookPath, 'utf8');

function expectContains(source, text) {
  expect(source.includes(text)).toBe(true);
}

describe('desktop packaging: security and anti-reverse-engineering hardening', () => {
  describe('fuse-level hardening policy', () => {
    it('keeps ASAR enabled as baseline hardening layer', () => {
      expect(packageJson.build.asar).toBe(true);
    });

    it('keeps onlyLoadAppFromAsar enabled', () => {
      expect(packageJson.build.electronFuses.onlyLoadAppFromAsar).toBe(true);
    });

    it('keeps embedded ASAR integrity validation enabled', () => {
      expect(packageJson.build.electronFuses.enableEmbeddedAsarIntegrityValidation).toBe(true);
    });

    it('keeps cookie encryption enabled', () => {
      expect(packageJson.build.electronFuses.enableCookieEncryption).toBe(true);
    });

    it('disables NODE_OPTIONS-based process tampering', () => {
      expect(packageJson.build.electronFuses.enableNodeOptionsEnvironmentVariable).toBe(false);
    });

    it('disables node inspector arguments fuse', () => {
      expect(packageJson.build.electronFuses.enableNodeCliInspectArguments).toBe(false);
    });
  });

  describe('renderer isolation and navigation containment', () => {
    it('creates BrowserWindow with contextIsolation enabled', () => {
      expectContains(mainSource, 'contextIsolation: true');
    });

    it('creates BrowserWindow with sandbox enabled', () => {
      expectContains(mainSource, 'sandbox: true');
    });

    it('denies renderer window.open and forwards externally', () => {
      expectContains(mainSource, 'setWindowOpenHandler(({ url }) =>');
      expectContains(mainSource, "return { action: 'deny' };");
    });

    it('blocks in-app navigation to non-local origins', () => {
      expectContains(mainSource, "mainWindow.webContents.on('will-navigate'");
      expectContains(mainSource, 'if (!url.startsWith(baseUrl))');
      expectContains(mainSource, 'event.preventDefault();');
      expectContains(mainSource, 'shell.openExternal(url);');
    });
  });

  describe('desktop-mode execution gates', () => {
    it('forces desktop child server to run with LINGZHI_LAB_DESKTOP=1', () => {
      expectContains(mainSource, "LINGZHI_LAB_DESKTOP: '1'");
    });

    it('forces desktop child server host to loopback 127.0.0.1', () => {
      expectContains(mainSource, "HOST: '127.0.0.1'");
    });

    it('starts backend as node child via ELECTRON_RUN_AS_NODE=1', () => {
      expectContains(mainSource, "ELECTRON_RUN_AS_NODE: '1'");
    });

    it('enforces single-instance lock to reduce duplicate process surface', () => {
      expectContains(mainSource, 'const singleInstanceLock = app.requestSingleInstanceLock();');
      expectContains(mainSource, 'if (!singleInstanceLock) {');
    });
  });

  describe('preload IPC allowlist constraints', () => {
    it('uses channel allowlist for invoke API', () => {
      expectContains(preloadSource, 'const ALLOWED_CHANNELS_INVOKE = new Set([');
      expectContains(preloadSource, 'if (!ALLOWED_CHANNELS_INVOKE.has(channel))');
    });

    it('uses channel allowlist for event subscription API', () => {
      expectContains(preloadSource, 'const ALLOWED_CHANNELS_ON = new Set([');
      expectContains(preloadSource, 'if (!ALLOWED_CHANNELS_ON.has(channel))');
    });

    it('exposes API through contextBridge instead of direct node integration', () => {
      expectContains(preloadSource, "contextBridge.exposeInMainWorld('electronAPI'");
    });

    it('marks renderer runtime with explicit electron flags', () => {
      expectContains(preloadSource, "contextBridge.exposeInMainWorld('isElectron', true);");
      expectContains(preloadSource, "root.dataset.electron = 'true';");
      expectContains(preloadSource, "window.addEventListener('DOMContentLoaded'");
    });
  });

  describe('explicit anti-reverse-engineering posture documentation', () => {
    it('documents ASAR and fuse hardening strategy in custom playbook', () => {
      expectContains(playbookSource, 'asar');
      expectContains(playbookSource, 'electronFuses');
    });

    it('documents that anti-reversing is cost-raising rather than absolute protection', () => {
      expectContains(playbookSource, '防逆向');
      expectContains(playbookSource, '不可');
    });

    it('documents code-signing posture and current compatibility trade-off', () => {
      expectContains(playbookSource, 'signAndEditExecutable');
      expectContains(playbookSource, 'signtoolOptions');
    });
  });
});
