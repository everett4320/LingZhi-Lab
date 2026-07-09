$ErrorActionPreference = 'Continue'

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$desktop = [Environment]::GetFolderPath('Desktop')
if ([string]::IsNullOrWhiteSpace($desktop) -or -not (Test-Path -LiteralPath $desktop)) {
  $desktop = (Get-Location).Path
}

$workDir = Join-Path $env:TEMP "Lingzhi-Lab-logs-$timestamp"
$zipPath = Join-Path $desktop "Lingzhi-Lab-logs-$timestamp.zip"
$summaryPath = Join-Path $workDir 'diagnostics.txt'
$utf8NoBom = New-Object System.Text.UTF8Encoding -ArgumentList $false

New-Item -ItemType Directory -Force -Path $workDir | Out-Null

function Add-DiagnosticLine {
  param([string]$Line)
  Add-Content -LiteralPath $summaryPath -Value $Line -Encoding UTF8
}

function Copy-IfExists {
  param(
    [string]$Source,
    [string]$Destination
  )

  if (Test-Path -LiteralPath $Source) {
    Copy-Item -LiteralPath $Source -Destination $Destination -Recurse -Force -ErrorAction SilentlyContinue
    Add-DiagnosticLine "COPIED: $Source"
  } else {
    Add-DiagnosticLine "MISSING: $Source"
  }
}

function Protect-LogFile {
  param([string]$Path)

  try {
    $content = [System.IO.File]::ReadAllText($Path)
    $content = [regex]::Replace($content, '(?i)\bsk-[A-Za-z0-9_-]{16,}\b', '[REDACTED_API_KEY]')
    $content = [regex]::Replace($content, '(?i)([?&]token=)[^&\s"''\\]+', '$1[REDACTED_TOKEN]')
    $content = [regex]::Replace($content, '(?i)\bBearer\s+[A-Za-z0-9._~+/\-=]{16,}', 'Bearer [REDACTED_TOKEN]')
    $content = [regex]::Replace($content, '\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b', '[REDACTED_JWT]')
    [System.IO.File]::WriteAllText($Path, $content, $utf8NoBom)
    Add-DiagnosticLine "REDACTED: $Path"
  } catch {
    Add-DiagnosticLine "REDACTION_FAILED: $Path ($($_.Exception.Message))"
  }
}

Add-DiagnosticLine "Lingzhi Lab diagnostics"
Add-DiagnosticLine "CollectedAt=$((Get-Date).ToString('o'))"
Add-DiagnosticLine "User=$env:USERNAME"
Add-DiagnosticLine "Computer=$env:COMPUTERNAME"
Add-DiagnosticLine "OS=$((Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue).Caption)"
Add-DiagnosticLine "OSVersion=$([Environment]::OSVersion.VersionString)"
Add-DiagnosticLine "PowerShell=$($PSVersionTable.PSVersion)"
Add-DiagnosticLine "APPDATA=$env:APPDATA"
Add-DiagnosticLine "LOCALAPPDATA=$env:LOCALAPPDATA"
Add-DiagnosticLine ""

$userDataDir = Join-Path $env:APPDATA 'Lingzhi Lab'
$desktopLog = Join-Path $userDataDir 'desktop.log'
$runLogsDir = Join-Path $userDataDir 'run-logs'

Copy-IfExists $desktopLog (Join-Path $workDir 'desktop.log')
Copy-IfExists $runLogsDir (Join-Path $workDir 'run-logs')

Get-ChildItem -LiteralPath $workDir -Recurse -File -Filter '*.log' -ErrorAction SilentlyContinue |
  ForEach-Object { Protect-LogFile $_.FullName }

$programFilesX86 = [Environment]::GetEnvironmentVariable('ProgramFiles(x86)')
$installCandidates = @(
  (Join-Path $env:LOCALAPPDATA 'Programs\Lingzhi Lab'),
  (Join-Path $env:LOCALAPPDATA 'Programs\lingzhi-lab'),
  (Join-Path $env:ProgramFiles 'Lingzhi Lab')
)
if (-not [string]::IsNullOrWhiteSpace($programFilesX86)) {
  $installCandidates += Join-Path $programFilesX86 'Lingzhi Lab'
}

$installReport = Join-Path $workDir 'install-state.txt'
"Install candidate directories" | Out-File -LiteralPath $installReport -Encoding UTF8
foreach ($dir in $installCandidates) {
  "" | Out-File -LiteralPath $installReport -Append -Encoding UTF8
  "DIR: $dir" | Out-File -LiteralPath $installReport -Append -Encoding UTF8
  if (Test-Path -LiteralPath $dir) {
    Get-ChildItem -LiteralPath $dir -Recurse -ErrorAction SilentlyContinue |
      Select-Object -First 500 FullName, Length, LastWriteTime |
      Format-Table -AutoSize |
      Out-String -Width 240 |
      Out-File -LiteralPath $installReport -Append -Encoding UTF8
  } else {
    "MISSING" | Out-File -LiteralPath $installReport -Append -Encoding UTF8
  }
}

$processReport = Join-Path $workDir 'processes.txt'
Get-Process -ErrorAction SilentlyContinue |
  Where-Object { $_.ProcessName -like '*Lingzhi*' -or $_.ProcessName -like '*lingzhi*' } |
  Select-Object Id, ProcessName, Path, StartTime |
  Format-List |
  Out-File -LiteralPath $processReport -Encoding UTF8

$registryReport = Join-Path $workDir 'uninstall-registry.txt'
$uninstallRoots = @(
  'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
)
foreach ($root in $uninstallRoots) {
  "ROOT: $root" | Out-File -LiteralPath $registryReport -Append -Encoding UTF8
  Get-ItemProperty $root -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -like '*Lingzhi*' -or $_.DisplayName -like '*Lingzhi Lab*' } |
    Format-List * |
    Out-File -LiteralPath $registryReport -Append -Encoding UTF8
}

if (Test-Path -LiteralPath $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue
}

Compress-Archive -Path (Join-Path $workDir '*') -DestinationPath $zipPath -Force

Write-Host "Created diagnostics zip:"
Write-Host $zipPath
