@echo off
chcp 65001 >nul
echo ===== MB Store installer =====
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
echo.
pause
