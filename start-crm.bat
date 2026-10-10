@echo off
title WIESPL CRM
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies...
  call npm install --no-fund --no-audit
)
echo Starting WIESPL CRM... keep this window open while people are using it.
start "" http://localhost:3000
node server/index.js
pause
