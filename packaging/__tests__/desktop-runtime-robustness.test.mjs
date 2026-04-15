import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const cliPath = path.join(repoRoot, 'electron', 'cli.mjs');
const nativeRuntimePath = path.join(repoRoot, 'scripts', 'native-runtime.mjs');
const fixNodePtyPath = path.join(repoRoot, 'scripts', 'fix-node-pty.js');

const cliSource = fs.readFileSync(cliPath, 'utf8');
const nativeRuntimeSource = fs.readFileSync(nativeRuntimePath, 'utf8');
const fixNodePtySource = fs.readFileSync(fixNodePtyPath, 'utf8');

function expectContains(source, text) {
  expect(source.includes(text)).toBe(true);
}

function extractFunctionSource(source, functionName) {
  const signature = `function ${functionName}(`;
  const startIndex = source.indexOf(signature);
  if (startIndex === -1) {
    throw new Error(`Unable to locate function ${functionName}`);
  }

  const bodyStart = source.indexOf('{', startIndex);
  if (bodyStart === -1) {
    throw new Error(`Unable to locate body start for function ${functionName}`);
  }

  let depth = 0;
  let endIndex = -1;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        endIndex = index;
        break;
      }
    }
  }

  if (endIndex === -1) {
    throw new Error(`Unable to locate body end for function ${functionName}`);
  }

  return source.slice(startIndex, endIndex + 1);
}

function loadFunction(source, functionName) {
  const functionSource = extractFunctionSource(source, functionName);
  return new Function(`${functionSource}; return ${functionName};`)();
}

describe('desktop packaging: runtime script robustness', () => {
  describe('electron/cli.mjs bootstrap contracts', () => {
    it('defaults command to dev when no arg is provided', () => {
      expectContains(cliSource, "const [command = 'dev', ...rawArgs] = process.argv.slice(2);");
    });

    it('creates dedicated electron-gyp cache directory', () => {
      expectContains(cliSource, "const electronGypDir = path.join(projectRoot, '.electron-gyp');");
      expectContains(cliSource, 'fs.mkdirSync(electronGypDir, { recursive: true });');
    });

    it('creates dedicated electron download cache directory', () => {
      expectContains(cliSource, "const electronCacheDir = path.join(projectRoot, '.electron-cache');");
      expectContains(cliSource, 'fs.mkdirSync(electronCacheDir, { recursive: true });');
    });

    it('creates dedicated electron HOME directory', () => {
      expectContains(cliSource, "const electronHomeDir = path.join(projectRoot, '.electron-home');");
      expectContains(cliSource, 'fs.mkdirSync(electronHomeDir, { recursive: true });');
    });

    it('injects npm_config_devdir into child environment', () => {
      expectContains(cliSource, 'npm_config_devdir: electronGypDir');
    });

    it('injects ELECTRON_GYP_DIR into child environment', () => {
      expectContains(cliSource, 'ELECTRON_GYP_DIR: electronGypDir');
    });

    it('injects ELECTRON_CACHE into child environment', () => {
      expectContains(cliSource, 'ELECTRON_CACHE: electronCacheDir');
    });

    it('uses local node_modules/.bin when available for tool commands', () => {
      expectContains(cliSource, "const localPath = path.join(projectRoot, 'node_modules', '.bin'");
    });

    it('falls back to npx when local electron-builder is unavailable', () => {
      expectContains(cliSource, "resolveCommand('electron-builder', npxBin(), ['electron-builder'])");
    });

    it('runs desktop icons generation before runtime prep', () => {
      expectContains(cliSource, "await run(npmBin(), ['run', 'desktop:icons']);");
    });

    it('converts iconset to icns on macOS', () => {
      expectContains(cliSource, "await run('iconutil', ['-c', 'icns', 'build/icon.iconset', '-o', 'build/icon.icns']);");
    });

    it('ensures dev flow uses native:node before launching electron shell', () => {
      expectContains(cliSource, "await run(npmBin(), ['run', 'native:node']);");
      expectContains(cliSource, "await run(npxBin(), ['electron', 'electron/main.mjs']);");
    });

    it('ensures dist/pack flow uses native:electron runtime', () => {
      expectContains(cliSource, "await run(npmBin(), ['run', 'native:electron']);");
    });

    it('ensures pack mode adds --dir builder flag', () => {
      expectContains(cliSource, "await run(commandInfo.bin, [...commandInfo.args, '--dir', ...builderArgs], builderEnv);");
    });

    it('ensures dist mode does not force --dir flag', () => {
      expectContains(cliSource, 'await run(commandInfo.bin, [...commandInfo.args, ...builderArgs], builderEnv);');
    });

    it('prunes unpacked windows payload after pack/dist on windows targets', () => {
      expectContains(cliSource, "await run(npmBin(), ['run', 'desktop:prune:unpacked']);");
      expectContains(cliSource, 'if (isWindowsBuild)');
    });

    it('throws explicit error for unknown desktop command', () => {
      expectContains(cliSource, 'throw new Error(`Unknown desktop command: ${command}`);');
    });

    it('uses numeric exit code from thrown errors when available', () => {
      expectContains(cliSource, "process.exit(typeof error?.code === 'number' ? error.code : 1);");
    });
  });

  describe('electron/cli.mjs argument and env parsing behavior', () => {
    const parseBuilderArgs = loadFunction(cliSource, 'parseBuilderArgs');
    const parseBooleanEnv = loadFunction(cliSource, 'parseBooleanEnv');
    const hasWindowsTarget = loadFunction(cliSource, 'hasWindowsTarget');

    it('parseBuilderArgs appends --publish never when publish is absent', () => {
      expect(parseBuilderArgs(['--mac', 'dmg'])).toEqual(['--mac', 'dmg', '--publish', 'never']);
    });

    it('parseBuilderArgs preserves explicit publish flag and value', () => {
      expect(parseBuilderArgs(['--publish', 'always'])).toEqual(['--publish', 'always']);
    });

    it('parseBuilderArgs keeps explicit publish=never unchanged', () => {
      expect(parseBuilderArgs(['--win', 'nsis', '--publish', 'never'])).toEqual(['--win', 'nsis', '--publish', 'never']);
    });

    it('parseBuilderArgs does not duplicate publish flag when explicitly set', () => {
      const args = parseBuilderArgs(['--win', '--publish', 'onTag']);
      expect(args.filter((item) => item === '--publish').length).toBe(1);
    });

    it('parseBuilderArgs handles empty input', () => {
      expect(parseBuilderArgs([])).toEqual(['--publish', 'never']);
    });

    it('parseBuilderArgs retains unrelated builder arguments', () => {
      expect(parseBuilderArgs(['--config', 'foo=bar'])).toEqual(['--config', 'foo=bar', '--publish', 'never']);
    });

    it('parseBuilderArgs supports standalone publish token at tail', () => {
      expect(parseBuilderArgs(['--publish'])).toEqual(['--publish', 'never']);
    });

    it('parseBuilderArgs auto-fills publish value when next token is another flag', () => {
      expect(parseBuilderArgs(['--publish', '--win', 'nsis'])).toEqual(['--publish', 'never', '--win', 'nsis']);
    });

    it('parseBuilderArgs keeps explicit publish value even when value starts with onTag', () => {
      expect(parseBuilderArgs(['--publish', 'onTagOrDraft', '--win'])).toEqual(['--publish', 'onTagOrDraft', '--win']);
    });

    it('parseBooleanEnv returns true for 1', () => {
      const previous = process.env.TEST_BOOL_ENV;
      process.env.TEST_BOOL_ENV = '1';
      expect(parseBooleanEnv('TEST_BOOL_ENV')).toBe(true);
      process.env.TEST_BOOL_ENV = previous;
    });

    it('parseBooleanEnv returns true for yes', () => {
      const previous = process.env.TEST_BOOL_ENV;
      process.env.TEST_BOOL_ENV = 'yes';
      expect(parseBooleanEnv('TEST_BOOL_ENV')).toBe(true);
      process.env.TEST_BOOL_ENV = previous;
    });

    it('parseBooleanEnv returns false for 0', () => {
      const previous = process.env.TEST_BOOL_ENV;
      process.env.TEST_BOOL_ENV = '0';
      expect(parseBooleanEnv('TEST_BOOL_ENV')).toBe(false);
      process.env.TEST_BOOL_ENV = previous;
    });

    it('parseBooleanEnv returns false for off', () => {
      const previous = process.env.TEST_BOOL_ENV;
      process.env.TEST_BOOL_ENV = 'off';
      expect(parseBooleanEnv('TEST_BOOL_ENV')).toBe(false);
      process.env.TEST_BOOL_ENV = previous;
    });

    it('parseBooleanEnv trims and lowercases values', () => {
      const previous = process.env.TEST_BOOL_ENV;
      process.env.TEST_BOOL_ENV = '  TrUe  ';
      expect(parseBooleanEnv('TEST_BOOL_ENV')).toBe(true);
      process.env.TEST_BOOL_ENV = previous;
    });

    it('parseBooleanEnv returns null for unknown values', () => {
      const previous = process.env.TEST_BOOL_ENV;
      process.env.TEST_BOOL_ENV = 'maybe';
      expect(parseBooleanEnv('TEST_BOOL_ENV')).toBe(null);
      process.env.TEST_BOOL_ENV = previous;
    });

    it('parseBooleanEnv returns null when variable is unset', () => {
      const previous = process.env.TEST_BOOL_ENV;
      delete process.env.TEST_BOOL_ENV;
      expect(parseBooleanEnv('TEST_BOOL_ENV')).toBe(null);
      process.env.TEST_BOOL_ENV = previous;
    });

    it('hasWindowsTarget matches --win token on non-Windows', () => {
      const result = hasWindowsTarget(['--win', 'nsis']);
      expect(result).toBe(true);
    });

    it('hasWindowsTarget matches --windows token on non-Windows', () => {
      const result = hasWindowsTarget(['--windows', 'nsis']);
      expect(result).toBe(true);
    });

    it('hasWindowsTarget reflects host platform when no explicit windows arg is present', () => {
      const result = hasWindowsTarget(['--mac', 'dmg']);
      if (process.platform === 'win32') {
        expect(result).toBe(true);
      } else {
        expect(result).toBe(false);
      }
    });
  });

  describe('electron/cli.mjs windows compatibility hardening', () => {
    it('supports environment override for signAndEditExecutable decision', () => {
      expectContains(cliSource, "const envOverride = parseBooleanEnv('LINGZHI_WIN_SIGN_AND_EDIT_EXECUTABLE');");
    });

    it('checks whether symlink creation is available on Windows', () => {
      expectContains(cliSource, 'function canCreateSymlinkOnWindows()');
      expectContains(cliSource, "fs.symlinkSync(targetPath, linkPath, 'file');");
    });

    it('uses ProgramFiles roots to search Windows signtool', () => {
      expectContains(cliSource, "process.env['ProgramFiles(x86)']");
      expectContains(cliSource, 'process.env.ProgramFiles');
    });

    it('searches Windows Kits v10 bin folder for signtool', () => {
      expectContains(cliSource, "'Windows Kits', '10', 'bin'");
    });

    it('prefers x64 signtool and falls back to x86', () => {
      expectContains(cliSource, "'x64', 'signtool.exe'");
      expectContains(cliSource, "'x86', 'signtool.exe'");
    });

    it('injects win.signAndEditExecutable at build time for Windows', () => {
      expectContains(cliSource, '--config.win.signAndEditExecutable=');
    });

    it('auto-sets SIGNTOOL_PATH when available and not preconfigured', () => {
      expectContains(cliSource, 'if (!process.env.SIGNTOOL_PATH && detectedSignToolPath)');
      expectContains(cliSource, 'builderEnv.SIGNTOOL_PATH = detectedSignToolPath;');
    });

    it('pins ELECTRON_BUILDER_CACHE to repo-local folder on Windows builds', () => {
      expectContains(cliSource, "const localBuilderCache = path.join(projectRoot, '.electron-builder-cache');");
      expectContains(cliSource, 'builderEnv.ELECTRON_BUILDER_CACHE = localBuilderCache;');
    });
  });

  describe('scripts/native-runtime.mjs contracts', () => {
    it('tracks runtime state via .native-runtime.json', () => {
      expectContains(nativeRuntimeSource, "const statePath = path.join(projectRoot, '.native-runtime.json');");
    });

    it('defines native module set explicitly', () => {
      expectContains(nativeRuntimeSource, "const nativeModules = ['better-sqlite3', 'sqlite3', 'node-pty'];");
    });

    it('stores target and runtime metadata in state file', () => {
      expectContains(nativeRuntimeSource, 'target,');
      expectContains(nativeRuntimeSource, 'updatedAt: new Date().toISOString(),');
      expectContains(nativeRuntimeSource, 'modules: process.versions.modules,');
      expectContains(nativeRuntimeSource, 'electronVersion,');
    });

    it('verifies Node runtime by requiring all native modules', () => {
      expectContains(nativeRuntimeSource, 'for (const moduleName of nativeModules)');
      expectContains(nativeRuntimeSource, 'require(moduleName);');
    });

    it('rebuilds native modules for node runtime via npm rebuild', () => {
      expectContains(nativeRuntimeSource, "await run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['rebuild', ...nativeModules]);");
    });

    it('runs fix-node-pty patch before electron-rebuild', () => {
      expectContains(nativeRuntimeSource, "await run(process.platform === 'win32' ? 'node.exe' : 'node', ['scripts/fix-node-pty.js']);");
    });

    it('prefers local electron-rebuild binary when available', () => {
      expectContains(nativeRuntimeSource, "const localBin = path.join(projectRoot, 'node_modules', '.bin', `electron-rebuild${ext}`);");
    });

    it('falls back to npx electron-rebuild when local binary is unavailable', () => {
      expectContains(nativeRuntimeSource, "args: ['electron-rebuild'],");
    });

    it('forces electron-rebuild for selected native modules only', () => {
      expectContains(nativeRuntimeSource, "'--force',");
      expectContains(nativeRuntimeSource, "'--module-dir', projectRoot,");
      expectContains(nativeRuntimeSource, "'--only', nativeModules.join(','),");
    });

    it('throws explicit error for unknown native-runtime command', () => {
      expectContains(nativeRuntimeSource, 'throw new Error(`Unknown native runtime command: ${command}`);');
    });

    it('uses numeric exit code on runtime command failure', () => {
      expectContains(nativeRuntimeSource, "process.exit(typeof error?.code === 'number' ? error.code : 1);");
    });
  });

  describe('scripts/fix-node-pty.js contracts', () => {
    it('keeps macOS spawn-helper chmod fix path', () => {
      expectContains(fixNodePtySource, "if (process.platform !== \"darwin\") return;");
      expectContains(fixNodePtySource, 'await fs.chmod(spawnHelperPath, 0o755);');
    });

    it('patches both darwin-arm64 and darwin-x64 prebuilds', () => {
      expectContains(fixNodePtySource, 'const darwinDirs = ["darwin-arm64", "darwin-x64"];');
    });

    it('keeps Windows-only SpectreMitigation patch guard', () => {
      expectContains(fixNodePtySource, 'if (process.platform !== "win32") return;');
    });

    it('patches both node-pty binding.gyp and winpty.gyp', () => {
      expectContains(fixNodePtySource, '"node_modules"');
      expectContains(fixNodePtySource, '"node-pty"');
      expectContains(fixNodePtySource, '"binding.gyp"');
      expectContains(fixNodePtySource, '"winpty.gyp"');
    });

    it('replaces SpectreMitigation Disabled with false', () => {
      expectContains(fixNodePtySource, "/'SpectreMitigation'\\s*:\\s*'Disabled'/g");
      expectContains(fixNodePtySource, "\"'SpectreMitigation': 'false'\"");
    });

    it('keeps warnings non-fatal for missing files', () => {
      expectContains(fixNodePtySource, 'if (err.code !== "ENOENT")');
    });

    it('executes both platform-specific fix routines from main()', () => {
      expectContains(fixNodePtySource, 'await fixSpawnHelper();');
      expectContains(fixNodePtySource, 'await fixWindowsSpectreMitigation();');
    });
  });
});
