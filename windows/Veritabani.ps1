#Requires -Version 5.1
<#
  ATIKVIEWER — yerel PostgreSQL (yönetici izni GEREKMEZ)
  =======================================================
  Yönetici hakları olmadan, servis kurmadan ve sisteme dokunmadan çalışan bir
  PostgreSQL örneği hazırlar:

    powershell -ExecutionPolicy Bypass -File windows\Veritabani.ps1

  Yaptıkları:
    1. PostgreSQL 16 ikili dosyalarını (≈300 MB) %LOCALAPPDATA%\atikviewer-pg içine indirir
    2. initdb ile veri kümesini oluşturur (yalnız 127.0.0.1, parola: postgres)
    3. pg_ctl ile sunucuyu başlatır (varsayılan port 5432)
    4. app_db veritabanını oluşturur
    5. .env dosyasına DATABASE_URL yazar (yoksa .env.example'dan üretir)

  Ardından şema uygulanır:
    npx drizzle-kit push --config=drizzle.config.ts

  Seçenekler:
    -Port N        Farklı port (varsayılan 5432)
    -Database ad   Farklı veritabanı adı (varsayılan app_db)
    -Password s    Yerel postgres parolası (varsayılan postgres)

  Durdurmak için: windows\Veritabani.ps1 -Stop   (ya da pg_ctl -D <veri dizini> stop)
#>
param(
    [int]$Port = 5432,
    [string]$Database = 'app_db',
    [string]$Password = 'postgres',
    [switch]$Stop
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # Invoke-WebRequest indirmesini hızlandırır

$Root     = Split-Path -Parent $PSScriptRoot
$Base     = Join-Path $env:LOCALAPPDATA 'atikviewer-pg'
$PgHome   = Join-Path $Base 'pgsql'
$Bin      = Join-Path $PgHome 'bin'
$DataDir  = Join-Path $Base 'data'
$LogFile  = Join-Path $Base 'postgres.log'
$ZipPath  = Join-Path $Base 'pg.zip'
$ZipUrl   = 'https://get.enterprisedb.com/postgresql/postgresql-16.16-2-windows-x64-binaries.zip'

try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

function Write-Step([string]$Text) { Write-Host ""; Write-Host "==> $Text" -ForegroundColor Cyan }
function Write-Ok([string]$Text)   { Write-Host "    OK  $Text" -ForegroundColor Green }
function Write-Warn2([string]$Text){ Write-Host "    !   $Text" -ForegroundColor Yellow }

function Test-PortListening([int]$PortNo) {
    try {
        $c = New-Object System.Net.Sockets.TcpClient
        $c.Connect('127.0.0.1', $PortNo)
        $c.Close()
        return $true
    } catch { return $false }
}

if (-not (Test-Path $Base)) { New-Item -ItemType Directory -Path $Base -Force | Out-Null }

# ── Durdurma ───────────────────────────────────────────────────────────────
if ($Stop) {
    if (-not (Test-Path (Join-Path $Bin 'pg_ctl.exe'))) { Write-Warn2 "PostgreSQL kurulu değil ($Bin)"; exit 1 }
    & (Join-Path $Bin 'pg_ctl.exe') -D $DataDir stop -m fast
    Write-Ok "PostgreSQL durduruldu"
    exit 0
}

# ── 1) İkili dosyalar ──────────────────────────────────────────────────────
Write-Step "1/5 PostgreSQL 16 ikili dosyaları"
if (Test-Path (Join-Path $Bin 'pg_ctl.exe')) {
    Write-Ok "mevcut kurulum kullanılacak: $PgHome"
} else {
    if (-not (Test-Path $ZipPath) -or ((Get-Item $ZipPath).Length -lt 50MB)) {
        Write-Host "    indiriliyor: $ZipUrl"
        if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
            & curl.exe -L --fail --retry 3 -o $ZipPath $ZipUrl
            if ($LASTEXITCODE -ne 0) { throw "İndirme başarısız (curl kodu $LASTEXITCODE)" }
        } else {
            Invoke-WebRequest -Uri $ZipUrl -OutFile $ZipPath -UseBasicParsing
        }
    } else {
        Write-Ok "indirilmiş arşiv bulundu, yeniden indirilmiyor"
    }
    Write-Host "    arşiv açılıyor..."
    Expand-Archive -Path $ZipPath -DestinationPath $Base -Force
    if (-not (Test-Path (Join-Path $Bin 'pg_ctl.exe'))) { throw "Arşiv beklenen yapıda değil: $Bin" }
    Write-Ok "ikili dosyalar hazır"
}

# ── 2) Veri kümesi ─────────────────────────────────────────────────────────
Write-Step "2/5 Veri kümesi (initdb)"
if (Test-Path (Join-Path $DataDir 'PG_VERSION')) {
    Write-Ok "mevcut veri kümesi kullanılacak: $DataDir"
} else {
    $pwFile = Join-Path $env:TEMP 'atikviewer-pg-pw.txt'
    Set-Content -Path $pwFile -Value $Password -Encoding ASCII -NoNewline
    try {
        & (Join-Path $Bin 'initdb.exe') -D $DataDir -U postgres --pwfile=$pwFile `
            --auth-host=scram-sha-256 --auth-local=scram-sha-256 -E UTF8 --locale=C
        if ($LASTEXITCODE -ne 0) { throw "initdb başarısız (kod $LASTEXITCODE)" }
    } finally {
        Remove-Item $pwFile -Force -ErrorAction SilentlyContinue
    }
    Write-Ok "veri kümesi oluşturuldu (yalnız 127.0.0.1, SCRAM kimlik doğrulama)"
}

# ── 3) Sunucuyu başlat ─────────────────────────────────────────────────────
Write-Step "3/5 Sunucu (127.0.0.1:$Port)"
$started = $false
if (Test-PortListening $Port) {
    Write-Ok "port $Port zaten dinleniyor — mevcut sunucu kullanılacak"
} else {
    & (Join-Path $Bin 'pg_ctl.exe') -D $DataDir -l $LogFile -o "-p $Port -c listen_addresses=127.0.0.1" -w start
    if ($LASTEXITCODE -ne 0) {
        Write-Host "    son günlük satırları:" -ForegroundColor Yellow
        if (Test-Path $LogFile) { Get-Content $LogFile -Tail 15 | ForEach-Object { Write-Host "      $_" } }
        throw "PostgreSQL başlatılamadı (kod $LASTEXITCODE). Günlük: $LogFile"
    }
    $started = $true
    Write-Ok "sunucu hazır (günlük: $LogFile)"
}

# ── 4) Veritabanı ──────────────────────────────────────────────────────────
Write-Step "4/5 Veritabanı: $Database"
$env:PGPASSWORD = $Password
$exists = (& (Join-Path $Bin 'psql.exe') -h 127.0.0.1 -p $Port -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$Database'" 2>&1) -join ''
if ($exists.Trim() -eq '1') {
    Write-Ok "veritabanı zaten var"
} else {
    & (Join-Path $Bin 'createdb.exe') -h 127.0.0.1 -p $Port -U postgres $Database
    if ($LASTEXITCODE -ne 0) { throw "createdb başarısız (kod $LASTEXITCODE)" }
    Write-Ok "veritabanı oluşturuldu"
}

# ── 5) .env ────────────────────────────────────────────────────────────────
Write-Step "5/5 .env yapılandırması"
$EnvFile = Join-Path $Root '.env'
if (-not (Test-Path $EnvFile)) {
    # .env.example içindeki anahtar=değer ve yorum satırları alınır ([TEMPLATE] gibi satırlar atılır)
    Get-Content (Join-Path $Root '.env.example') -Encoding UTF8 |
        Where-Object { $_ -match '^\s*#' -or $_ -match '^[A-Za-z0-9_]+=' } |
        Set-Content $EnvFile -Encoding UTF8
    Write-Ok ".env oluşturuldu"
}
$url = "postgresql://postgres:$Password@127.0.0.1:$Port/$Database"
$content = Get-Content $EnvFile -Raw
if ($content -match '(?m)^DATABASE_URL=') {
    $content = $content -replace '(?m)^DATABASE_URL=.*$', "DATABASE_URL=$url"
} else {
    $content = "DATABASE_URL=$url`r`n$content"
}
Set-Content -Path $EnvFile -Value $content -Encoding UTF8 -NoNewline
Write-Ok "DATABASE_URL=$url"

Write-Host ""
Write-Host "Veritabanı hazır. Şimdi şemayı uygulayın:" -ForegroundColor Green
Write-Host "    npx drizzle-kit push --config=drizzle.config.ts"
Write-Host ""
Write-Host "Durdurmak için: powershell -ExecutionPolicy Bypass -File windows\Veritabani.ps1 -Stop" -ForegroundColor DarkGray
