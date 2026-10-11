; Extra step for the MB Store installer.
; People who first installed with the old zip/install.bat have a "resources\app" FOLDER.
; Electron loads that folder BEFORE app.asar, which would hide every new version.
; The installer removes it, so the new version (and all future auto-updates) really run.
; Shop data lives in %APPDATA%\MB Store and is never touched here.
!macro customInstall
  RMDir /r "$INSTDIR\resources\app"
!macroend
