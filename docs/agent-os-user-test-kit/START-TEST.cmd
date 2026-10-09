@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0agent_os_user_test.ps1" -Mode Prepare -PackageDir "%~dp0." -StartInstaller
if errorlevel 1 echo Teststart fehlgeschlagen. Bitte LIES-MICH.txt lesen.
pause
