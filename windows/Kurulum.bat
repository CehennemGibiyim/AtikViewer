@echo off
rem ATIKVIEWER — Windows kurulum (çift tıklamayla çalıştırın)
rem Git, Node.js, Python paketleri ve yapay zekâ modellerini kendisi kurar.
setlocal
cd /d "%~dp0.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Kurulum.ps1" %*
echo.
if errorlevel 1 (
    echo KURULUM BASARISIZ - ayrintilar windows\kurulum.log dosyasinda.
) else (
    echo KURULUM TAMAM. Simdi "windows\Baslat.bat" ile programi baslatabilirsiniz.
)
pause
exit /b %errorlevel%
