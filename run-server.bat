@echo off
rem WIESPL CRM in server mode (office mini PC): no browser window, restarts by itself if it ever stops,
rem and trusts the Cloudflare tunnel in front of it. Started at boot by install-server.bat; do not run
rem start-crm.bat on the same PC at the same time.
title WIESPL CRM (server)
cd /d "%~dp0"
set TRUST_PROXY=1
if not exist data mkdir data
if not exist node_modules call npm install --no-fund --no-audit >> data\server.log 2>&1
:loop
echo %date% %time% starting WIESPL CRM >> data\server.log
node server/index.js >> data\server.log 2>&1
echo %date% %time% CRM stopped, restarting in 5 seconds >> data\server.log
ping -n 6 127.0.0.1 >nul
goto loop
