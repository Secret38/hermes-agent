@echo off
setlocal
echo Hermes vorher vollstaendig schliessen. Dieselbe Testversion wird erneut eingerichtet.
pause
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0agent_os_user_test.ps1" -Mode Repair -PackageDir "%~dp0."
pause
