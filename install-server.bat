@echo off
rem One-time setup of the office mini PC as the WIESPL CRM server.
rem Right-click -> "Run as administrator". Safe to run again (it just updates the setup).
title WIESPL CRM - server setup
cd /d "%~dp0"

net session >nul 2>&1
if errorlevel 1 (
  echo.
  echo  Please right-click install-server.bat and choose "Run as administrator".
  echo.
  pause
  exit /b 1
)

set "NODE="
for /f "delims=" %%i in ('where node 2^>nul') do if not defined NODE set "NODE=%%i"
if not defined NODE (
  echo.
  echo  Node.js is not installed. Install "Node.js 24 LTS" from https://nodejs.org and run this again.
  echo.
  pause
  exit /b 1
)
echo Using Node: %NODE%

echo Installing dependencies...
call npm install --no-fund --no-audit

echo Starting the CRM automatically when the PC starts (no login needed)...
schtasks /Create /F /TN "WIESPL CRM" /SC ONSTART /RU SYSTEM /RL HIGHEST /TR "\"%~dp0run-server.bat\"" >nul
if errorlevel 1 ( echo  Could not create the start-up task. & pause & exit /b 1 )

echo Daily backup at 1:30 am (data\backups\daily, last 30 days kept)...
schtasks /Create /F /TN "WIESPL CRM backup" /SC DAILY /ST 01:30 /RU SYSTEM /TR "\"%NODE%\" \"%~dp0tools\daily-backup.mjs\"" >nul

echo Keeping the PC awake on mains power (it is now a server)...
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0

echo Starting the CRM now...
schtasks /Run /TN "WIESPL CRM" >nul

echo.
echo  Done. The CRM is running at http://localhost:3000 and starts by itself after every restart.
echo  Log file: data\server.log     Backups: data\backups\daily
echo  The first admin password is in data\initial-admin-password.txt (on a new install).
echo.
pause
