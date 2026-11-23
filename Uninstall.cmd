@echo off
REM Usage Dashboard
REM Copyright (c) 2026 ItanBlackwell.
REM SPDX-License-Identifier: MPL-2.0
REM Source: https://github.com/ItanBlackwell/usage-dashboard
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0installer\Uninstall-UsageDashboard.ps1"
set "RESULT=%ERRORLEVEL%"
echo.
if not "%RESULT%"=="0" (echo Removal failed. See the message above.) else (echo Removal complete. Restart OpenCode Desktop.)
pause
exit /b %RESULT%
