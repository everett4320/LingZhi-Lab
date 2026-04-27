import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const releaseDir = path.join(repoRoot, 'release');
const unpackedDir = path.join(releaseDir, 'win-unpacked');
const unpackedExe = path.join(unpackedDir, 'Lingzhi Lab.exe');
const installDir = path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'lingzhi-lab');
const installExe = path.join(installDir, 'Lingzhi Lab.exe');
const desktopNames = ['Lingzhi Lab.lnk', '\u7075\u667aLab.lnk'];
const healthPortStart = 3001;
const healthPortEnd = 3020;

function log(message, details = null) {
  if (details == null) {
    console.log(`[desktop:fresh:win] ${message}`);
    return;
  }
  console.log(`[desktop:fresh:win] ${message}`, details);
}

function runPowerShell(script, { allowFailure = false, okExitCodes = [0], stdio = 'inherit' } = {}) {
  const result = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    cwd: repoRoot,
    stdio,
  });

  const status = result.status ?? 1;
  if (!okExitCodes.includes(status) && !allowFailure) {
    throw new Error(`PowerShell command failed with exit code ${result.status ?? 'unknown'}`);
  }
}

function toPowerShellLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sleepMs(milliseconds) {
  const safeMs = Math.max(0, Math.trunc(milliseconds));
  runPowerShell(`Start-Sleep -Milliseconds ${safeMs}`, { allowFailure: true, stdio: 'ignore' });
}

function stopLingzhiProcesses() {
  runPowerShell(
    `
$targetExe = ${toPowerShellLiteral(installExe)};
$targetRoot = ${toPowerShellLiteral(`${installDir}${path.sep}`)};
$processes = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
  ($_.ExecutablePath -eq $targetExe) -or
  ($_.ExecutablePath -like ($targetRoot + '*')) -or
  ($_.Name -like 'Lingzhi Lab*') -or
  ($_.Name -like 'lingzhi-lab*') -or
  ($_.Name -like '*Lingzhi*')
};
foreach ($p in $processes) {
  try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop } catch {}
}
`,
    { allowFailure: true },
  );
}

function removeInstallDirWithRetries(targetDir, maxAttempts = 8) {
  const literalDir = toPowerShellLiteral(targetDir);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (!fs.existsSync(targetDir)) {
      return;
    }

    stopLingzhiProcesses();

    try {
      fs.rmSync(targetDir, { recursive: true, force: true });
    } catch (error) {
      log('Node delete attempt failed', {
        attempt,
        message: error instanceof Error ? error.message : String(error),
      });
    }

    if (!fs.existsSync(targetDir)) {
      return;
    }

    runPowerShell(
      `if (Test-Path -LiteralPath ${literalDir}) { Remove-Item -LiteralPath ${literalDir} -Recurse -Force -ErrorAction SilentlyContinue }`,
      { allowFailure: true },
    );

    if (!fs.existsSync(targetDir)) {
      return;
    }

    log('Install directory still locked; retrying cleanup', { attempt, installDir: targetDir });
    sleepMs(Math.min(400 * attempt, 2000));
  }

  if (fs.existsSync(targetDir)) {
    throw new Error(`Failed to delete old install directory: ${targetDir}`);
  }
}

function removeOldInstall() {
  log('Removing previous installation (if any)');
  stopLingzhiProcesses();

  const uninstallCandidates = fs.existsSync(installDir)
    ? fs.readdirSync(installDir)
      .filter((name) => name.toLowerCase().startsWith('uninstall ') && name.toLowerCase().endsWith('.exe'))
      .map((name) => path.join(installDir, name))
    : [];

  for (const uninstaller of uninstallCandidates) {
    log('Running previous uninstaller', uninstaller);
    runPowerShell(`& "${uninstaller}" /S`, { allowFailure: true });
  }

  if (fs.existsSync(installDir)) {
    log('Deleting install directory', installDir);
    removeInstallDirWithRetries(installDir);
  }
}

function deployFreshBuild() {
  if (!fs.existsSync(unpackedExe)) {
    throw new Error(`Packaged executable not found: ${unpackedExe}. Run desktop packaging first.`);
  }

  log('Deploying fresh win-unpacked build', { from: unpackedDir, to: installDir });
  fs.mkdirSync(installDir, { recursive: true });

  runPowerShell(`robocopy "${unpackedDir}" "${installDir}" /MIR /R:1 /W:1`, {
    okExitCodes: [0, 1, 2, 3, 4, 5, 6, 7],
  });
}

function createDesktopShortcut() {
  log('Creating desktop shortcuts on user desktop');
  const shortcutNames = desktopNames.map((name) => toPowerShellLiteral(name)).join(',');
  const script = `
$exe = "${installExe}";
$desktop = [Environment]::GetFolderPath('Desktop');
$wsh = New-Object -ComObject WScript.Shell;
foreach ($name in @(${shortcutNames})) {
  $lnk = Join-Path $desktop $name;
  $shortcut = $wsh.CreateShortcut($lnk);
  $shortcut.TargetPath = $exe;
  $shortcut.WorkingDirectory = "${installDir}";
  $shortcut.IconLocation = "$exe,0";
  $shortcut.Save();
}
`;
  runPowerShell(script);
}

function verifyAndOpen() {
  if (!fs.existsSync(installExe)) {
    throw new Error(`Installed executable not found: ${installExe}`);
  }

  const hash = spawnSync(
    'powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', `(Get-FileHash -LiteralPath "${installExe}" -Algorithm SHA256).Hash`],
    { cwd: repoRoot, encoding: 'utf8' },
  );

  if (hash.status !== 0) {
    throw new Error('Failed to compute installed executable hash.');
  }

  log('Installed executable hash', hash.stdout.trim());

  const launchScript = `
$exe = "${installExe}";
[Environment]::SetEnvironmentVariable('ELECTRON_RUN_AS_NODE', $null, 'Process');
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue;
$p = Start-Process -FilePath $exe -PassThru;
$ok = $false;
$healthPort = $null;
for ($i = 0; $i -lt 20; $i++) {
  Start-Sleep -Milliseconds 500;
  foreach ($port in ${healthPortStart}..${healthPortEnd}) {
    try {
      $resp = Invoke-WebRequest -Uri ("http://127.0.0.1:" + $port + "/health") -UseBasicParsing -TimeoutSec 1;
      if ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 500) {
        $ok = $true;
        $healthPort = $port;
        break;
      }
    } catch {
      # keep polling
    }
  }
  if ($ok) {
    break;
  }
  if ($p.HasExited) {
    break;
  }
}
$running = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe } | Select-Object -ExpandProperty Id);
if (-not $ok -or $running.Count -eq 0) {
  $exitCode = $null;
  if ($p.HasExited) { $exitCode = $p.ExitCode; }
  Write-Output ("LAUNCH_EXIT_CODE=" + $exitCode);
  Write-Output ("RUNNING_PIDS=" + ($running -join ','));
  exit 1;
}
Write-Output ("HEALTH_PORT=" + $healthPort);
Write-Output ("LAUNCH_OK_PIDS=" + ($running -join ','));
`;

  const result = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', launchScript], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  if (result.status !== 0) {
    throw new Error('Installed app failed launch verification.');
  }

  log('App launch verification passed and app left open for user.');
}

function main() {
  if (process.platform !== 'win32') {
    throw new Error('desktop:fresh:win can only run on Windows.');
  }

  removeOldInstall();
  deployFreshBuild();
  createDesktopShortcut();
  verifyAndOpen();

  log('Fresh install completed', {
    installExe,
    desktopShortcuts: desktopNames,
  });
}

try {
  main();
} catch (error) {
  console.error('[desktop:fresh:win] failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
}
