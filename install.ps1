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
