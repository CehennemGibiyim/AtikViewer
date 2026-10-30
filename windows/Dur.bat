@echo off
rem ATIKVIEWER — çalışan worker ve görüntüleyiciyi kapatır
setlocal
cd /d "%~dp0.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Dur.ps1" %*
echo.
pause
exit /b 0
