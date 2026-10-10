@echo off
title WIESPL CRM - reset admin password
cd /d "%~dp0"
node server\reset-admin.js
echo.
echo Open data\initial-admin-password.txt for the new temporary password.
pause
