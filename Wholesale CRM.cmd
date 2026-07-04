@echo off
title Wholesale CRM
cd /d "%~dp0"
echo Starting Wholesale CRM live app...
node "%~dp0crm-app.mjs" %*
if errorlevel 1 (
  echo.
  echo [Wholesale CRM] stopped with an error. Review the log above.
  pause
)
