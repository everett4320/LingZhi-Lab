import { spawn } from 'node:child_process';
import crossSpawn from 'cross-spawn';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const [command = 'dev', ...rawArgs] = process.argv.slice(2);
const projectRoot = process.cwd();
const electronGypDir = path.join(projectRoot, '.electron-gyp');
const electronCacheDir = path.join(projectRoot, '.electron-cache');
const electronHomeDir = path.join(projectRoot, '.electron-home');
const spawnFunction = process.platform === 'win32' ? crossSpawn : spawn;

fs.mkdirSync(electronGypDir, { recursive: true });
fs.mkdirSync(electronCacheDir, { recursive: true });
fs.mkdirSync(electronHomeDir, { recursive: true });

const env = {
  ...process.env,
  npm_config_devdir: electronGypDir,
  ELECTRON_GYP_DIR: electronGypDir,
  ELECTRON_CACHE: electronCacheDir,
};

function npmBin() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function npxBin() {
  return process.platform === 'win32' ? 'npx.cmd' : 'npx';
}

function resolveLocalBin(name) {
  const ext = process.platform === 'win32' ? '.cmd' : '';
  const localPath = path.join(projectRoot, 'node_modules', '.bin', `${name}${ext}`);
  return fs.existsSync(localPath) ? localPath : null;
}

function resolveCommand(preferredBinName, fallbackBin, fallbackArgs = []) {
  const localBin = resolveLocalBin(preferredBinName);
  if (localBin) {
    return { bin: localBin, args: [] };
  }
  return { bin: fallbackBin, args: fallbackArgs };
}

function hasWindowsTarget(args) {
  if (process.platform === 'win32') {
    return true;
  }
  return args.includes('--win') || args.includes('--windows');
}

function parseBooleanEnv(name) {
  const value = process.env[name];
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return null;
}

function canCreateSymlinkOnWindows() {
  if (process.platform !== 'win32') {
    return true;
  }

  const probeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingzhi-symlink-check-'));
  const targetPath = path.join(probeDir, 'target.txt');
  const linkPath = path.join(probeDir, 'link.txt');

  try {
    fs.writeFileSync(targetPath, 'ok', 'utf8');
    fs.symlinkSync(targetPath, linkPath, 'file');
    return true;
  } catch {
    return false;
  } finally {
    try {
      if (fs.existsSync(linkPath)) fs.unlinkSync(linkPath);
    } catch {
      // ignore cleanup errors
    }
    try {
      if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
    } catch {
      // ignore cleanup errors
    }
    try {
      fs.rmdirSync(probeDir);
    } catch {
      // ignore cleanup errors
    }
  }
}

function resolveSignAndEditExecutableForWindows() {
  const envOverride = parseBooleanEnv('LINGZHI_WIN_SIGN_AND_EDIT_EXECUTABLE');
  if (envOverride !== null) {
    return {
      enabled: envOverride,
      reason: `via LINGZHI_WIN_SIGN_AND_EDIT_EXECUTABLE=${envOverride}`,
    };
  }

  const symlinkSupported = canCreateSymlinkOnWindows();
  if (!symlinkSupported) {
    return {
      enabled: false,
      reason: 'symbolic links are not available on this machine',
    };
  }

  return {
    enabled: true,
    reason: 'symbolic links are available',
  };
}

function findLatestWindowsSigntool() {
  if (process.platform !== 'win32') {
    return null;
  }

  const roots = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles]
    .filter(Boolean)
    .map((base) => path.join(base, 'Windows Kits', '10', 'bin'))
    .filter((binRoot) => fs.existsSync(binRoot));

  const versionWeight = (version) => version.split('.')
    .map((part) => Number.parseInt(part, 10) || 0)
    .reduce((acc, part, index) => acc + part * (10 ** Math.max(0, 8 - index * 2)), 0);

  let best = null;

  for (const binRoot of roots) {
    const entries = fs.readdirSync(binRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^\d+(\.\d+)*$/.test(entry.name))
      .sort((a, b) => versionWeight(b.name) - versionWeight(a.name));

    for (const entry of entries) {
      const candidate = path.join(binRoot, entry.name, 'x64', 'signtool.exe');
      if (fs.existsSync(candidate)) {
        return candidate;
      }
      const fallback = path.join(binRoot, entry.name, 'x86', 'signtool.exe');
      if (fs.existsSync(fallback)) {
        best = fallback;
      }
    }
  }

  return best;
}

function run(bin, args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnFunction(bin, args, {
      cwd: projectRoot,
      env: {
        ...env,
        ...extraEnv,
      },
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      const error = new Error(`${bin} ${args.join(' ')} failed`);
      error.code = code;
      error.signal = signal;
      reject(error);
    });
  });
}

async function buildIcons() {
  await run(npmBin(), ['run', 'desktop:icons']);

  if (process.platform === 'darwin') {
    await run('iconutil', ['-c', 'icns', 'build/icon.iconset', '-o', 'build/icon.icns']);
  }
}

async function prepareElectronRuntime() {
  await buildIcons();
  await run(npmBin(), ['run', 'native:electron']);
}

async function prepareNodeDevRuntime() {
  await buildIcons();
  await run(npmBin(), ['run', 'native:node']);
}

function parseBuilderArgs(args) {
  const builderArgs = [];
  let hasPublishFlag = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--publish') {
      hasPublishFlag = true;
      builderArgs.push(arg);
      const publishValue = args[index + 1];
      if (publishValue && !publishValue.startsWith('--')) {
        builderArgs.push(publishValue);
        index += 1;
      } else {
        builderArgs.push('never');
      }
      continue;
    }

    builderArgs.push(arg);
  }

  if (!hasPublishFlag) {
    builderArgs.push('--publish', 'never');
  }

  return builderArgs;
}

async function main() {
  if (command === 'prepare') {
    await prepareElectronRuntime();
    return;
  }

  if (command === 'dev') {
    await prepareNodeDevRuntime();
    await run(npmBin(), ['run', 'build']);
    await run(npxBin(), ['electron', 'electron/main.mjs']);
    return;
  }

  await prepareElectronRuntime();
  await run(npmBin(), ['run', 'build']);

  const builderArgs = parseBuilderArgs(rawArgs);
  const isWindowsBuild = hasWindowsTarget(builderArgs);
  const builderEnv = {
    HOME: electronHomeDir,
    USERPROFILE: electronHomeDir,
  };

  if (isWindowsBuild && process.platform === 'win32') {
    const signAndEditDecision = resolveSignAndEditExecutableForWindows();
    builderArgs.push(`--config.win.signAndEditExecutable=${signAndEditDecision.enabled}`);
    console.log(`[desktop:dist] win.signAndEditExecutable=${signAndEditDecision.enabled} (${signAndEditDecision.reason})`);

    const detectedSignToolPath = findLatestWindowsSigntool();
    if (!process.env.SIGNTOOL_PATH && detectedSignToolPath) {
      builderEnv.SIGNTOOL_PATH = detectedSignToolPath;
      console.log(`[desktop:dist] using local signtool: ${detectedSignToolPath}`);
    }

    const localBuilderCache = path.join(projectRoot, '.electron-builder-cache');
    fs.mkdirSync(localBuilderCache, { recursive: true });
    builderEnv.ELECTRON_BUILDER_CACHE = localBuilderCache;
  }

  if (command === 'pack') {
    const commandInfo = resolveCommand('electron-builder', npxBin(), ['electron-builder']);
    await run(commandInfo.bin, [...commandInfo.args, '--dir', ...builderArgs], builderEnv);
    if (isWindowsBuild) {
      await run(npmBin(), ['run', 'desktop:prune:unpacked']);
    }
    return;
  }

  if (command === 'dist') {
    const commandInfo = resolveCommand('electron-builder', npxBin(), ['electron-builder']);
    await run(commandInfo.bin, [...commandInfo.args, ...builderArgs], builderEnv);
    if (isWindowsBuild) {
      await run(npmBin(), ['run', 'desktop:prune:unpacked']);
    }
    return;
  }

  throw new Error(`Unknown desktop command: ${command}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(typeof error?.code === 'number' ? error.code : 1);
});
