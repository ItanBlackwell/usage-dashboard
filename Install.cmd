@echo off
REM Usage Dashboard
REM Copyright (c) 2026 ItanBlackwell.
REM SPDX-License-Identifier: MPL-2.0
REM Source: https://github.com/ItanBlackwell/usage-dashboard
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0installer\Install-UsageDashboard.ps1" -PackageRoot "%~dp0."
set "RESULT=%ERRORLEVEL%"
echo.
if not "%RESULT%"=="0" (echo Installation failed. See the message above.) else (echo Installation complete. Restart OpenCode Desktop.)
pause
exit /b %RESULT%
