@echo off
setlocal
cd /d "%~dp0"
where node.exe >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 or newer is required. Install it from https://nodejs.org/ and start again.
  pause
  exit /b 1
)
node scripts\windows-launcher.mjs
if errorlevel 1 (
  echo Higher Frequency did not start. Review the error above.
  pause
  exit /b 1
)
endlocal
