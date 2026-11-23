@echo off
rem ATIKVIEWER — Windows başlatıcı (çift tıklamayla çalışır)
rem Yapay zekâ worker'ını ve görüntüleyiciyi birlikte açar.
setlocal
cd /d "%~dp0.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Baslat.ps1" %*
if errorlevel 1 (
    echo.
    echo Kurulum eksik olabilir. Once "windows\Kurulum.bat" dosyasini calistirin.
    pause
)
exit /b %errorlevel%
