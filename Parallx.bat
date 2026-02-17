@echo off
cd /d "%~dp0"
start "" /B cmd /c "npm run start" >nul 2>&1
exit
