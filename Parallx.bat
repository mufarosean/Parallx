@echo off
rem Parallx portable launcher.
rem
rem The repo folder is a self-contained app: node_modules carries the Electron
rem runtime and all rebuilt natives (same-arch Windows), so copying the whole
rem folder to another machine and double-clicking this file runs Parallx with
rem NOTHING installed on that machine - no Node, no npm, no toolchain.
rem
rem Requires a build to exist (run `npm run build:prod` before copying).
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
  echo node_modules is missing - copy the FULL repo folder, including node_modules.
  pause
  exit /b 1
)
start "" "node_modules\electron\dist\electron.exe" .
