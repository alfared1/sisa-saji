@echo off
setlocal
rem Sisa-Saji: stops the demo processes started from THIS folder
rem (npm run demo, next start/dev, PGlite database, worker). Other node
rem processes on this computer are not touched.
rem   stop-demo.cmd            stop them
rem   stop-demo.cmd --dry-run  only list what would be stopped

cd /d "%~dp0"
set "PS_ARGS="
if /i "%~1"=="--dry-run" set "PS_ARGS=-DryRun"
if /i "%~1"=="/dry-run" set "PS_ARGS=-DryRun"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-demo.ps1" %PS_ARGS%
set "RC=%ERRORLEVEL%"

rem Keep the window open when started by double-click.
echo %CMDCMDLINE% | "%SystemRoot%\System32\find.exe" /i "%~nx0" >nul && pause
exit /b %RC%
