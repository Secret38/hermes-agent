@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0agent_os_user_test.ps1" -Mode Check -PackageDir "%~dp0."
pause
