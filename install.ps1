# MB Store - per-user installer (no admin rights, no Node.js needed)
# Downloads the official Electron runtime from GitHub, verifies its checksum,
# then puts the MB Store files next to it. Your DATA is never touched by this script.
$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'   # the progress bar makes Invoke-WebRequest MUCH slower in Windows PowerShell
$ver  = '44.7.0'
$name = "electron-v$ver-win32-x64.zip"
$base = "https://github.com/electron/electron/releases/download/v$ver"
$root = Join-Path $env:LOCALAPPDATA 'Programs\MB Store'
$tmp  = Join-Path $env:TEMP $name
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Get-Text($url) {
  # GitHub serves SHASUMS256.txt as application/octet-stream, so Windows PowerShell 5.1
  # returns .Content as a byte[] (not text). Always convert to a string ourselves.
  $r = Invoke-WebRequest -Uri $url -UseBasicParsing
  if ($r.Content -is [byte[]]) { return [Text.Encoding]::UTF8.GetString($r.Content) }
  return [string]$r.Content
}

# ---- shared helpers: find the REAL install on this PC instead of assuming a fixed path ----
function Get-MbInstallDirs {
  $dirs = @()
  try { Get-Process -Name 'MB Store' -ErrorAction SilentlyContinue | ForEach-Object { if ($_.Path) { $dirs += (Split-Path $_.Path -Parent) } } } catch {}
  $ws = New-Object -ComObject WScript.Shell
  # GetFolderPath returns the REAL folders (also when Desktop/Documents are redirected to OneDrive)
  foreach ($f in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('CommonDesktopDirectory'), [Environment]::GetFolderPath('CommonPrograms'))) {
    if (-not $f) { continue }
    $l = Join-Path $f 'MB Store.lnk'
    if (Test-Path -LiteralPath $l) { try { $t = $ws.CreateShortcut($l).TargetPath; if ($t -and (Test-Path -LiteralPath $t)) { $dirs += (Split-Path $t -Parent) } } catch {} }
  }
  $def = Join-Path $env:LOCALAPPDATA 'Programs\MB Store'
  if (Test-Path -LiteralPath (Join-Path $def 'MB Store.exe')) { $dirs += $def }
  # only folders that really are an MB Store install (safety: never delete anything else)
  $dirs | Where-Object { $_ -and (Test-Path -LiteralPath (Join-Path $_ 'MB Store.exe')) -and (Test-Path -LiteralPath (Join-Path $_ 'resources')) } | Select-Object -Unique
}
function Test-MbSetupInstall {
  foreach ($k in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall')) {
    if (Test-Path $k) {
      foreach ($c in Get-ChildItem $k -ErrorAction SilentlyContinue) {
        try { if ((Get-ItemProperty $c.PSPath).DisplayName -eq 'MB Store') { return $true } } catch {}
      }
    }
  }
  return $false
}
function Stop-MbGracefully {
  $p = Get-Process -Name 'MB Store' -ErrorAction SilentlyContinue
  if (-not $p) { return }
  Write-Host 'Closing MB Store (it saves a backup first)...'
  $p | ForEach-Object { try { [void]$_.CloseMainWindow() } catch {} }
  $end = (Get-Date).AddSeconds(20)
  while ((Get-Process -Name 'MB Store' -ErrorAction SilentlyContinue) -and ((Get-Date) -lt $end)) { Start-Sleep -Milliseconds 500 }
  Get-Process -Name 'MB Store' -ErrorAction SilentlyContinue | Stop-Process -Force
}

if (Test-MbSetupInstall) {
  Write-Host 'MB Store is already installed with Setup.exe and updates itself from inside the app. Nothing to do.'
  exit 0
}
$existing = @(Get-MbInstallDirs) | Select-Object -First 1
if ($existing) { $root = $existing; Write-Host ('Found your current install, updating it in place: ' + $root) }

try {
  if (-not (Test-Path $tmp)) {
    Write-Host "Downloading Electron $ver (about 120 MB), please wait..."
    $part = "$tmp.part"
    if (Test-Path $part) { Remove-Item $part -Force }
    Invoke-WebRequest -Uri "$base/$name" -OutFile $part -UseBasicParsing
    Move-Item $part $tmp -Force
  } else {
    Write-Host 'Using the file already downloaded.'
  }

  Write-Host 'Verifying download...'
  $sums = Get-Text "$base/SHASUMS256.txt"
  $line = $sums -split "\r?\n" | Where-Object { $_ -match ([regex]::Escape($name) + '\s*$') } | Select-Object -First 1
  if (-not $line) { throw 'Could not find the checksum for this file.' }
  $want = ($line.Trim() -split '\s+')[0].ToLower()
  $got  = (Get-FileHash $tmp -Algorithm SHA256).Hash.ToLower()
  if ($want -ne $got) { Remove-Item $tmp -Force; throw 'Checksum mismatch - the download is corrupted. Run the installer again.' }
  Write-Host 'Checksum OK.'

  Write-Host 'Installing...'
  Get-Process -Name 'MB Store' -ErrorAction SilentlyContinue | Stop-Process -Force
  if (Test-Path $root) { Remove-Item $root -Recurse -Force }   # program files only
  New-Item -ItemType Directory -Path $root | Out-Null
  Expand-Archive -Path $tmp -DestinationPath $root -Force
  Rename-Item (Join-Path $root 'electron.exe') 'MB Store.exe'

  $app = Join-Path $root 'resources\app'
  New-Item -ItemType Directory -Path $app -Force | Out-Null
  Copy-Item -Path (Join-Path $PSScriptRoot 'main.js'), (Join-Path $PSScriptRoot 'preload.js'), (Join-Path $PSScriptRoot 'package.json') -Destination $app
  Copy-Item -Path (Join-Path $PSScriptRoot 'app'), (Join-Path $PSScriptRoot 'build') -Destination $app -Recurse

  $ws = New-Object -ComObject WScript.Shell
  $targets = @([Environment]::GetFolderPath('Desktop'), (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'))
  foreach ($d in $targets) {
    $s = $ws.CreateShortcut((Join-Path $d 'MB Store.lnk'))
    $s.TargetPath = Join-Path $root 'MB Store.exe'
    $s.WorkingDirectory = $root
    $s.IconLocation = (Join-Path $app 'build\icon.ico')
    $s.Save()
  }
  Write-Host ''
  Write-Host 'Done. Use the "MB Store" shortcut on your Desktop.'
  Write-Host "Program: $root"
  Write-Host 'Data:    %APPDATA%\MB Store   (kept if you reinstall or uninstall)'
  Write-Host 'Backups: Documents\MB Store Backups'
} catch {
  Write-Host ''
  Write-Host ('ERROR: ' + $_.Exception.Message) -ForegroundColor Red
  exit 1
}
