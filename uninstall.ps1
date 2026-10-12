# MB Store - uninstall the PROGRAM only. Your data and backups are never touched.
$ErrorActionPreference = 'Stop'
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

try {
  Write-Host '===== MB Store uninstall (program only; your data and backups are kept) ====='
  if (Test-MbSetupInstall) {
    Write-Host ''
    Write-Host 'MB Store was installed with Setup.exe, so Windows manages it.'
    Write-Host 'Remove it from: Settings > Apps > Installed apps > MB Store > Uninstall.'
    Write-Host 'Your data is kept.'
    exit 0
  }
  $dirs = @(Get-MbInstallDirs)
  if ($dirs.Count -eq 0) {
    Write-Host ''
    Write-Host 'Could not find an installed MB Store program on this PC. Nothing was removed.' -ForegroundColor Yellow
    Write-Host 'Looked in: running programs, the Desktop and Start menu shortcuts, and %LOCALAPPDATA%\Programs\MB Store'
    exit 0
  }
  Stop-MbGracefully
  foreach ($d in $dirs) {
    Write-Host ('Removing program folder: ' + $d)
    for ($i = 0; $i -lt 5; $i++) { try { Remove-Item -LiteralPath $d -Recurse -Force; break } catch { Start-Sleep -Seconds 1 } }
    if (Test-Path -LiteralPath $d) { Write-Host '  could not remove everything: close MB Store and run this again' -ForegroundColor Yellow } else { Write-Host '  removed' }
  }
  foreach ($f in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('CommonDesktopDirectory'), [Environment]::GetFolderPath('CommonPrograms'))) {
    if (-not $f) { continue }
    $l = Join-Path $f 'MB Store.lnk'
    if (Test-Path -LiteralPath $l) { try { Remove-Item -LiteralPath $l -Force; Write-Host ('Removed shortcut: ' + $l) } catch { Write-Host ('Could not remove shortcut: ' + $l) } }
  }
  Write-Host ''
  Write-Host 'Kept (not touched):'
  Write-Host ('  Data:    ' + (Join-Path $env:APPDATA 'MB Store'))
  Write-Host ('  Backups: ' + (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'MB Store Backups'))
} catch {
  Write-Host ''
  Write-Host ('ERROR: ' + $_.Exception.Message) -ForegroundColor Red
  exit 1
}
