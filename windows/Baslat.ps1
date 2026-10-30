#Requires -Version 5.1
<#
  ATIKVIEWER — Windows başlatma betiği
  ====================================
  Yapay zekâ worker'ını (ai-worker, 127.0.0.1:8787) ve görüntüleyiciyi
  (Next.js) birlikte başlatır, ikisi de hazır olunca tarayıcıyı açar.

    windows\Baslat.bat
    powershell -ExecutionPolicy Bypass -File windows\Baslat.ps1 -Dev -NoBrowser

  Seçenekler:
    -Dev         Geliştirme sunucusu (next dev) kullan; aksi halde varsa üretim
                 derlemesi (next start) tercih edilir
    -NoBrowser   Tarayıcıyı otomatik açma
    -Port N      Görüntüleyici portu (varsayılan 3000)

  Zaten çalışan bir worker/sunucu varsa ikinci kez başlatmaz (portu yoklar).
#>
param(
    [switch]$Dev,
    [switch]$NoBrowser,
    [int]$Port = 3000
)

# Native süreçler (npm/python) stderr yazar; PS 5.1'de Stop betiği öldürürdü.
$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$VenvPy  = Join-Path $Root '.venv\Scripts\python.exe'
$WorkerUrl  = 'http://127.0.0.1:8787/health'
$AppUrl     = "http://localhost:$Port"

function Write-Step([string]$t) { Write-Host "==> $t" -ForegroundColor Cyan }
function Test-PortListening([int]$PortNo) {
    try {
        $c = New-Object System.Net.Sockets.TcpClient
        $c.Connect('127.0.0.1', $PortNo)
        $c.Close()
        return $true
    } catch { return $false }
}
function Wait-Url([string]$Url, [int]$TimeoutSec, [string]$Label) {
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        try {
            $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
            if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) { return $true }
        } catch { }
        Start-Sleep -Milliseconds 1500
    }
    Write-Host "    !   $Label hazır olmadı ($TimeoutSec sn): $Url" -ForegroundColor Yellow
    return $false
}

# ── Önkoşul denetimi (kurulum yapılmamışsa dürüstçe söyle) ────────────────
$missing = @()
if (-not (Test-Path $VenvPy))  { $missing += '.venv (Python sanal ortamı)' }
if (-not (Test-Path (Join-Path $Root 'node_modules'))) { $missing += 'node_modules (Node paketleri)' }
if (-not (Test-Path (Join-Path $Root '.env'))) { $missing += '.env (yapılandırma)' }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { $missing += 'Node.js' }
if ($missing.Count -gt 0) {
    Write-Host "Kurulum eksik: $($missing -join ', ')" -ForegroundColor Red
    Write-Host "Önce şunu çalıştırın:" -ForegroundColor Yellow
    Write-Host "    windows\Kurulum.bat" -ForegroundColor Green
    exit 1
}

$workerStarted = $false
$appStarted = $false

# ── 1) Yapay zekâ worker'ı ────────────────────────────────────────────────
Write-Step "Yapay zekâ worker'ı (127.0.0.1:8787)"
if (Test-PortListening 8787) {
    Write-Host "    zaten çalışıyor, ikinci kez başlatılmadı" -ForegroundColor DarkGray
} else {
    Start-Process -FilePath $VenvPy -ArgumentList @((Join-Path $Root 'ai-worker\server.py')) -WorkingDirectory $Root -WindowStyle Minimized -ErrorAction Stop
    $workerStarted = $true
    Write-Host "    başlatıldı, sağlık denetimi bekleniyor..."
    if (Wait-Url $WorkerUrl 90 'Worker') {
        Write-Host "    OK  worker hazır (model durumu konsolunda yazılı)" -ForegroundColor Green
    }
}

# ── 2) Görüntüleyici (Next.js) ───────────────────────────────────────────
$hasBuild = Test-Path (Join-Path $Root '.next\BUILD_ID')
if ($Dev -or -not $hasBuild) { $mode = 'dev' } else { $mode = 'start' }
Write-Step "Görüntüleyici ($mode, port $Port)"

if (Test-PortListening $Port) {
    Write-Host "    port $Port zaten dolu, mevcut sunucu kullanılacak" -ForegroundColor DarkGray
} else {
    # Bu projeye ait bir Next süreci zaten çalışıyorsa ikinci kez başlatma
    # (aynı .next klasörünü paylaşan iki dev sunucusu birbirini kilitler).
    $ownNext = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -and $_.CommandLine -like "*$Root*" }
    if ($ownNext) {
        $pids = ($ownNext | ForEach-Object { $_.ProcessId }) -join ', '
        Write-Host "    !   bu projeye ait bir Next süreci zaten var (PID $pids)" -ForegroundColor Yellow
        Write-Host "        Çakışmayı önlemek için ikinci kez başlatılmadı. Farklı port gerekiyorsa" -ForegroundColor Yellow
        Write-Host "        once windows\Dur.bat calistirin veya -Port ile yeni port verin." -ForegroundColor Yellow
    } else {
        $env:PORT = "$Port"
        $env:NEXT_TELEMETRY_DISABLED = '1'
        $npmArgs = @('run', 'dev')
        if ($mode -eq 'start') { $npmArgs = @('run', 'start') }
        $AppLog = Join-Path $PSScriptRoot 'goruntuleyici.log'
        Remove-Item $AppLog -Force -ErrorAction SilentlyContinue
        # npm bir .cmd dosyasıdır: -RedirectStandardOutput PowerShell'i CreateProcess'e
        # geçirir ve "npm" bir Win32 uygulaması olmadığı için hata verir. Bu yüzden
        # çocuk PowerShell içinde yönlendirme yapılır (ShellExecute yolu korunur).
        $npmLine = 'npm ' + ($npmArgs -join ' ')
        $psCmd = "Set-Location -LiteralPath '$Root'; $npmLine *> '$AppLog'"
        Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $psCmd) -WindowStyle Minimized -ErrorAction Stop
        $appStarted = $true
        Write-Host "    başlatıldı (çıktı: windows\goruntuleyici.log), sayfa bekleniyor..."

        # Next dev, port doluysa kendiliğinden bir sonraki portu seçebilir;
        # logdaki "Local: http://localhost:PORT" satırından gerçek port okunur.
        $actualPort = $Port
        $ready = $false
        $deadline = (Get-Date).AddSeconds(180)
        while ((Get-Date) -lt $deadline -and -not $ready) {
            if (Test-Path $AppLog) {
                $hit = Select-String -Path $AppLog -Pattern 'localhost:(\d+)' -AllMatches -ErrorAction SilentlyContinue | Select-Object -Last 1
                if ($hit -and $hit.Matches.Count -gt 0) { $actualPort = [int]$hit.Matches[0].Groups[1].Value }
            }
            try {
                $r = Invoke-WebRequest -Uri "http://localhost:$actualPort" -UseBasicParsing -TimeoutSec 5
                if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) { $ready = $true }
            } catch { }
            if (-not $ready) { Start-Sleep -Milliseconds 1500 }
        }
        if ($ready) {
            $AppUrl = "http://localhost:$actualPort"
            Write-Host "    OK  görüntüleyici hazır ($AppUrl)" -ForegroundColor Green
        } else {
            Write-Host "    !   görüntüleyici 180 sn içinde hazır olmadı — son çıktı:" -ForegroundColor Yellow
            if (Test-Path $AppLog) { Get-Content $AppLog -Tail 12 | ForEach-Object { Write-Host "        $_" -ForegroundColor Yellow } }
        }
    }
}

# ── 3) Özet + tarayıcı ────────────────────────────────────────────────────
Write-Host ""
Write-Host "==============================================================" -ForegroundColor DarkCyan
Write-Host " ATIKVIEWER çalışıyor" -ForegroundColor Green
Write-Host "   Görüntüleyici : $AppUrl"
Write-Host "   AI worker     : http://127.0.0.1:8787  (yalnızca bu makine)"
Write-Host "   Durdurmak için: açılan penceresiz işleri Tamamlama Yöneticisi'nden"
Write-Host "                   veya 'windows\Dur.bat' ile kapatın."
Write-Host "==============================================================" -ForegroundColor DarkCyan

if (-not $NoBrowser) {
    Start-Process $AppUrl
}
