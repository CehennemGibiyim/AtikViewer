@echo off
title ATIK VIEWER - Sunucu Baslatiliyor
color 0B
echo.
echo  ╔══════════════════════════════════════════╗
echo  ║   ATİK VİEWER - Başlatılıyor...          ║
echo  ╚══════════════════════════════════════════╝
echo.

:: Node.js kontrolu
where node >nul 2>&1
if %errorlevel% neq 0 (
    color 0C
    echo  [HATA] Node.js bulunamadi!
    echo  Lutfen https://nodejs.org adresinden LTS surumunu indirin.
    echo.
    pause
    start https://nodejs.org
    exit /b 1
)

echo  [OK] Node.js bulundu.

:: Dosya adi uyumlulugu: Dicom_cfind.js -> dicom-cfind.js
if exist "Dicom_cfind.js" (
    if not exist "dicom-cfind.js" (
        copy "Dicom_cfind.js" "dicom-cfind.js" >nul
        echo  [OK] dicom-cfind.js olusturuldu.
    )
)

:: node_modules kontrolu
if not exist "node_modules" (
    echo  [BILGI] Ilk kurulum yapiliyor, lutfen bekleyin...
    echo.
    call npm install --fund=false --audit=false
    if %errorlevel% neq 0 (
        color 0C
        echo  [HATA] npm install basarisiz oldu!
        pause
        exit /b 1
    )
    echo.
    echo  [OK] Bagimliliklar kuruldu.
)

:: Sunucuyu baslat
echo  [OK] Sunucu baslatiliyor...
echo.
echo  Tarayicinizda acin: http://localhost:3000
echo.

:: Tarayiciyi 2 saniye sonra ac
start /b cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:3000"

:: Sunucuyu baslat (on planda)
node server.js

pause
