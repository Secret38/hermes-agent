@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0agent_os_user_test.ps1" -Mode Continue -PackageDir "%~dp0."
pause
