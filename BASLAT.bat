@echo off
title ATİK VİEWER — Sunucu Baslatiliyor
color 0B
echo.
echo  ╔══════════════════════════════════════════╗
echo  ║   ATİK VİEWER - Başlatılıyor...          ║
echo  ╚══════════════════════════════════════════╝
echo.

:: Node.js kontrolü
where node >nul 2>&1
if %errorlevel% neq 0 (
    color 0C
    echo  [HATA] Node.js bulunamadı!
    echo  Lütfen https://nodejs.org adresinden LTS sürümünü indirin.
    echo.
    pause
    start https://nodejs.org
    exit /b 1
)

echo  [OK] Node.js bulundu.

:: node_modules kontrolü
if not exist "node_modules" (
    echo  [BİLGİ] İlk kurulum yapılıyor, lütfen bekleyin...
    echo.
    call npm install
    if %errorlevel% neq 0 (
        color 0C
        echo  [HATA] npm install başarısız oldu!
        pause
        exit /b 1
    )
    echo.
    echo  [OK] Bağımlılıklar kuruldu.
)

:: Sunucuyu başlat
echo  [OK] Sunucu başlatılıyor...
echo.
echo  Tarayıcınızda açın: http://localhost:3000
echo.

:: Tarayıcıyı 2 saniye sonra aç
start /b cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:3000"

:: Sunucuyu başlat (ön planda)
node server.js

pause
