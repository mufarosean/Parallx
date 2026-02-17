@echo off
rem If launched directly (e.g. from a shortcut), re-launch hidden via VBS
if not defined PARALLX_HIDDEN (
  set PARALLX_HIDDEN=1
  wscript.exe "%~dp0Parallx.vbs"
  exit /b
)
cd /d "%~dp0"
npm run start
