@echo off
chcp 65001 >nul
echo This removes the MB Store PROGRAM only. Your data and backups are kept.
pause
taskkill /f /im "MB Store.exe" >nul 2>&1
rmdir /s /q "%LOCALAPPDATA%\Programs\MB Store"
del "%USERPROFILE%\Desktop\MB Store.lnk" >nul 2>&1
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\MB Store.lnk" >nul 2>&1
echo Done.
pause
