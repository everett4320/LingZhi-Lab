import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');
const packageJsonPath = path.join(repoRoot, 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

describe('desktop packaging: package.json contracts', () => {
  describe('desktop scripts', () => {
    it.each([
      ['native:node', 'node scripts/native-runtime.mjs node'],
      ['native:electron', 'node scripts/native-runtime.mjs electron'],
      ['desktop:icons', 'node scripts/build-electron-icons.mjs'],
      ['desktop:prepare', 'node electron/cli.mjs prepare'],
      ['desktop:dev', 'node electron/cli.mjs dev'],
      ['desktop:pack', 'node electron/cli.mjs pack'],
      ['desktop:dist', 'node electron/cli.mjs dist'],
      ['desktop:pack:mac', 'node electron/cli.mjs pack --mac'],
      ['desktop:pack:win', 'node electron/cli.mjs pack --win'],
      ['desktop:dist:mac', 'node electron/cli.mjs dist --mac dmg --publish never'],
      ['desktop:dist:win', 'node electron/cli.mjs dist --win nsis --publish never'],
      ['desktop:prune:unpacked', 'node packaging/prune-windows-unpacked.mjs'],
      ['desktop:audit:artifact', 'node packaging/audit-desktop-artifact.mjs'],
      ['desktop:ci:gate', 'npm run test -- packaging/__tests__/desktop-package-config.test.mjs packaging/__tests__/desktop-runtime-robustness.test.mjs packaging/__tests__/desktop-security-hardening.test.mjs packaging/__tests__/desktop-workflow-contract.test.mjs && npm run desktop:audit:artifact'],
      ['prepublishOnly', 'npm run build'],
      ['postinstall', 'node scripts/fix-node-pty.js'],
    ])('defines script %s', (scriptName, expectedCommand) => {
      expect(packageJson.scripts[scriptName]).toBe(expectedCommand);
    });
  });

  describe('build metadata', () => {
    it('writes release artifacts to release/', () => {
      expect(packageJson.build.directories.output).toBe('release');
    });

    it('packs app resources into ASAR', () => {
      expect(packageJson.build.asar).toBe(true);
    });

    it('keeps Electron main entry in extraMetadata', () => {
      expect(packageJson.build.extraMetadata.main).toBe('electron/main.mjs');
    });

    it('pins desktop app identity', () => {
      expect(packageJson.build.appId).toBe('io.openlair.lingzhilab');
      expect(packageJson.build.productName).toBe('Lingzhi Lab');
    });

    it('pins winCodeSign helper toolset version', () => {
      expect(packageJson.build.toolsets.winCodeSign).toBe('1.1.0');
    });

    it('targets dmg on macOS', () => {
      expect(packageJson.build.mac.target).toContain('dmg');
    });

    it('targets nsis on Windows', () => {
      expect(packageJson.build.win.target).toContain('nsis');
    });

    it('uses explicit artifact naming for mac builds', () => {
      expect(packageJson.build.mac.artifactName).toBe('${productName}-${version}-mac-${arch}.${ext}');
    });

    it('uses explicit artifact naming for Windows builds', () => {
      expect(packageJson.build.win.artifactName).toBe('${productName}-${version}-win-${arch}.${ext}');
    });

    it('keeps NSIS installer interactive (not one-click)', () => {
      expect(packageJson.build.nsis.oneClick).toBe(false);
      expect(packageJson.build.nsis.perMachine).toBe(false);
      expect(packageJson.build.nsis.allowToChangeInstallationDirectory).toBe(true);
    });
  });

  describe('electron fuse hardening', () => {
    it('keeps runAsNode enabled for current desktop bootstrap model', () => {
      expect(packageJson.build.electronFuses.runAsNode).toBe(true);
    });

    it('disables NODE_OPTIONS environment injection fuse', () => {
      expect(packageJson.build.electronFuses.enableNodeOptionsEnvironmentVariable).toBe(false);
    });

    it('disables node cli inspect arguments fuse', () => {
      expect(packageJson.build.electronFuses.enableNodeCliInspectArguments).toBe(false);
    });

    it('forces app loading from ASAR only', () => {
      expect(packageJson.build.electronFuses.onlyLoadAppFromAsar).toBe(true);
    });

    it('enables embedded ASAR integrity validation', () => {
      expect(packageJson.build.electronFuses.enableEmbeddedAsarIntegrityValidation).toBe(true);
    });

    it('enables cookie encryption fuse', () => {
      expect(packageJson.build.electronFuses.enableCookieEncryption).toBe(true);
    });
  });

  describe('windows signing skeleton', () => {
    it('defaults win.signAndEditExecutable to false for compatibility', () => {
      expect(packageJson.build.win.signAndEditExecutable).toBe(false);
    });

    it('keeps signtool timestamp server configured', () => {
      expect(packageJson.build.win.signtoolOptions.timeStampServer).toContain('digicert.com');
      expect(packageJson.build.win.signtoolOptions.rfc3161TimeStampServer).toContain('digicert.com');
    });

    it('pins signing hash algorithms to sha256', () => {
      expect(packageJson.build.win.signtoolOptions.signingHashAlgorithms).toContain('sha256');
    });

    it('has at least one signing hash algorithm configured', () => {
      expect(packageJson.build.win.signtoolOptions.signingHashAlgorithms.length).toBeGreaterThan(0);
    });
  });

  describe('packaged file allowlist', () => {
    it.each([
      'dist/**/*',
      'public/**/*',
      'server/**/*',
      'shared/**/*',
      'skills/**/*',
      'electron/**/*',
      'package.json',
    ])('includes %s in electron-builder files allowlist', (allowedEntry) => {
      expect(packageJson.build.files).toContain(allowedEntry);
    });
  });
});
