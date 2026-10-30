#Requires -Version 5.1
<#
  ATIKVIEWER — Windows otomatik kurulum betiği
  =============================================
  Tek komutla bilgisayarı hazırlar ve programın çalışmasını sağlar:

    powershell -ExecutionPolicy Bypass -File windows\Kurulum.ps1

  Sırasıyla:
    1. Önkoşulları denetler, yoksa winget ile kurar: Git, Node.js LTS, Python 3.11–3.14
    2. Python sanal ortamı (.venv) oluşturur ve ai-worker\requirements.txt kurar
       (torch, monai, opencv, skp — hepsi kendisi çözülür)
    3. Yapay zekâ modellerini indirir: akciğer nodül (MONAI, ≈84 MB) +
       beyin kanama ICH (MIT, ≈147 MB) — ai-worker\setup_model.py
    4. Node bağımlılıklarını kurar (npm ci) ve .env dosyasını hazırlar
    5. -Build ile üretim derlemesi yapar

  Seçenekler:
    -SkipPrereqs  Önkoşul kurulumunu atla (Git/Node/Python zaten kuruluysa)
    -SkipNpm      npm kurulumunu atla (node_modules tazeyse)
    -Build        Derleme de yapılsın (npm run build)
    -CpuTorch     PyTorch'u yalnızca CPU sürümünden kur (≈250 MB, GPU yoksa önerilir)
    -DevPort N    Next.js için farklı port (varsayılan 3000)

  Betik uçtan uca idempotent'tir: yeniden çalıştırmak güvenlidir, mevcut
  kurulumlar atlanır. Kayıt: windows\kurulum.log
#>
param(
    [switch]$SkipPrereqs,
    [switch]$SkipNpm,
    [switch]$Build,
    [switch]$CpuTorch,
    [int]$DevPort = 3000
)

# Native komutlar (pip/npm/winget/python) stderr'e yazar; PS 5.1 bunu ErrorActionPreference
# =Stop ile sonlandırıcı hataya çevirir ve betiği öldürürdü (npm "warn" çıktıları dahil).
# Bu yüzden Continue'da kalır, kritik adımlar $LASTEXITCODE ve throw ile denetlenir.
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'   # Invoke-WebRequest indirmelerini hızlandırır

$Root   = Split-Path -Parent $PSScriptRoot            # windows\ üst klasörü = depo kökü
$LogPath = Join-Path $PSScriptRoot 'kurulum.log'

function Write-Step([string]$Text) {
    Write-Host ""
    Write-Host "==> $Text" -ForegroundColor Cyan
}
function Write-Ok([string]$Text) { Write-Host "    OK  $Text" -ForegroundColor Green }
function Write-Warn2([string]$Text) { Write-Host "    !   $Text" -ForegroundColor Yellow }

# Windows konsolları varsayılan UTF-8 değil; Türkçe çıktı bozulmasın.
try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    $OutputEncoding = [System.Text.Encoding]::UTF8
} catch { }

Start-Transcript -Path $LogPath -Append | Out-Null
try {
    Write-Host "==============================================================" -ForegroundColor DarkCyan
    Write-Host " ATIKVIEWER Windows kurulumu" -ForegroundColor Cyan
    Write-Host " Depo: $Root"
    Write-Host " Kayıt: $LogPath"
    Write-Host "==============================================================" -ForegroundColor DarkCyan

    # ── Ortam tazeleri (winget yeni PATH yazar) ──────────────────────────
    function Update-SessionPath {
        $m = [Environment]::GetEnvironmentVariable('Path', 'Machine')
        $u = [Environment]::GetEnvironmentVariable('Path', 'User')
        $env:Path = "$m;$u"
    }

    function Install-WingetPackage([string]$Id, [string]$Name) {
        if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
            throw "winget bulunamadı. $Name'ı elle kurun: https://aka.ms/getwinget  (kurulumdan sonra betiği yeniden çalıştırın)"
        }
        Write-Host "    winget ile kuruluyor: $Id ..."
        & winget install --id $Id -e --accept-package-agreements --accept-source-agreements --disable-interactivity | Out-Host
        if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne -1978335189) {
            # -1978335189 = zaten kurulu
            throw "$Name kurulumu başarısız (kod $LASTEXITCODE). Elle kurup betiği yeniden çalıştırın."
        }
        Update-SessionPath
    }

    # ── 1) Önkoşullar ────────────────────────────────────────────────────
    if (-not $SkipPrereqs) {
        Write-Step "1/6 Önkoşullar (Git, Node.js, Python)"

        # Git — skp paketi git deposundan kurulacağı için zorunlu
        if (Get-Command git -ErrorAction SilentlyContinue) {
            Write-Ok "Git: $((git --version) -replace 'git version ','')"
        } else {
            Install-WingetPackage 'Git.Git' 'Git'
            if (Get-Command git -ErrorAction SilentlyContinue) { Write-Ok "Git kuruldu" }
            else { Write-Warn2 "Git hâlâ görünmüyor; yeniden oturum açıp betiği tekrar çalıştırın." }
        }

        # Node.js (>= 20; .nvmrc = 22)
        $nodeOk = $false
        if (Get-Command node -ErrorAction SilentlyContinue) {
            $nv = (& node --version 2>$null) -join ''
            if ($nv -match '^v(\d+)') {
                $nodeMajor = [int]$Matches[1]
                if ($nodeMajor -ge 20) { $nodeOk = $true; Write-Ok "Node.js: $nv" }
                else { Write-Warn2 "Node.js $nv eski (>= 20 gerekli) — yükseltilecek" }
            }
        }
        if (-not $nodeOk) {
            Install-WingetPackage 'OpenJS.NodeJS.LTS' 'Node.js LTS'
            Update-SessionPath
            if (Get-Command node -ErrorAction SilentlyContinue) {
                Write-Ok "Node.js kuruldu: $(& node --version 2>$null)"
            } else {
                Write-Warn2 "Node.js görünmüyor; PowerShell penceresini kapatıp yeniden açın ve betiği tekrar çalıştırın."
            }
        }

        # Python 3.11–3.14 (ai-worker)
        $script:PythonExe = $null
        $candidates = @(
            @{ Cmd = 'py';   Args = @('-3.14') },
            @{ Cmd = 'py';   Args = @('-3.13') },
            @{ Cmd = 'py';   Args = @('-3.12') },
            @{ Cmd = 'py';   Args = @('-3.11') },
            @{ Cmd = 'python'; Args = @() }
        )
        foreach ($c in $candidates) {
            if (-not (Get-Command $c.Cmd -ErrorAction SilentlyContinue)) { continue }
            $ver = (& $c.Cmd @($c.Args) --version 2>&1) -join ' '
            if ($ver -match 'Python (3\.(1[1-4]))') {
                $script:PythonExe = $c.Cmd
                $script:PythonArgs = $c.Args
                Write-Ok "Python: $ver  ($($c.Cmd) $($c.Args -join ' '))"
                break
            }
        }
        if (-not $script:PythonExe) {
            Install-WingetPackage 'Python.Python.3.13' 'Python 3.13'
            Update-SessionPath
            if (Get-Command py -ErrorAction SilentlyContinue) {
                $script:PythonExe = 'py'; $script:PythonArgs = @('-3.13')
                Write-Ok "Python kuruldu: $(& py -3.13 --version 2>$null)"
            } elseif (Get-Command python -ErrorAction SilentlyContinue) {
                $script:PythonExe = 'python'; $script:PythonArgs = @()
                Write-Ok "Python kuruldu: $(& python --version 2>$null)"
            } else {
                throw "Python kurulamadı. Elle kurun (3.11–3.14): https://www.python.org/downloads/  sonra betiği yeniden çalıştırın."
            }
        }
    } else {
        Write-Step "1/6 Önkoşullar atlandı (-SkipPrereqs)"
        $script:PythonExe = $null
        foreach ($c in @(
            @{ Cmd = 'py'; Args = @('-3.13') }, @{ Cmd = 'py'; Args = @('-3.12') },
            @{ Cmd = 'py'; Args = @('-3.11') }, @{ Cmd = 'python'; Args = @() })) {
            if (Get-Command $c.Cmd -ErrorAction SilentlyContinue) {
                $ver = (& $c.Cmd @($c.Args) --version 2>&1) -join ' '
                if ($ver -match 'Python 3\.1[1-4]') { $script:PythonExe = $c.Cmd; $script:PythonArgs = $c.Args; break }
            }
        }
        if (-not $script:PythonExe) { throw "Python 3.11–3.14 bulunamadı. -SkipPrereqs kullanmadan betiği çalıştırın." }
        Write-Ok "Python: $script:PythonExe $($script:PythonArgs -join ' ')"
    }

    $VenvPy = Join-Path $Root '.venv\Scripts\python.exe'

    # ── 2) Sanal ortam + Python paketleri ────────────────────────────────
    Write-Step "2/6 Python sanal ortamı ve paketleri (ai-worker)"
    if (-not (Test-Path $VenvPy)) {
        Write-Host "    .venv oluşturuluyor..."
        & $script:PythonExe @($script:PythonArgs) -m venv (Join-Path $Root '.venv')
        if ($LASTEXITCODE -ne 0) { throw "venv oluşturulamadı (kod $LASTEXITCODE)" }
        Write-Ok ".venv oluşturuldu"
    } else {
        Write-Ok ".venv mevcut, atlandı"
    }

    Write-Host "    pip güncelleniyor..."
    & $VenvPy -m pip install --upgrade pip --disable-pip-version-check -q
    if ($LASTEXITCODE -ne 0) { throw "pip yükseltilemedi" }

    if ($CpuTorch) {
        Write-Host "    PyTorch CPU sürümü kuruluyor (≈250 MB)..."
        & $VenvPy -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu --disable-pip-version-check -q
        if ($LASTEXITCODE -ne 0) { throw "torch (CPU) kurulamadı" }
    }

    $reqTime = [System.Diagnostics.Stopwatch]::StartNew()
    Write-Host "    requirements.txt kuruluyor — ilk seferde PyTorch ≈2 GB indirebilir, lütfen bekleyin..."
    & $VenvPy -m pip install -r (Join-Path $Root 'ai-worker\requirements.txt') --disable-pip-version-check
    if ($LASTEXITCODE -ne 0) { throw "Python paketleri kurulamadı (kod $LASTEXITCODE)" }
    $reqTime.Stop()
    Write-Ok "Python paketleri kuruldu ($([int]$reqTime.Elapsed.TotalSeconds) sn)"

    # Paketler gerçekten import edilebiliyor mu? (skp git'ten geldiği için kritik)
    # NOT: kod `python -c` ile VERİLMEZ — PowerShell 5.1 gömülü çift tırnakları
    # native argümana geçirirken yutuyor ("torch" → torch). Geçici dosyaya yazılır.
    # Python tarafı hatasını yakalayıp exit 1 döndürür; stderr akışı yalnızca toplanır.
    Write-Host "    import denetimi..."
    $probeCode = @'
import importlib, sys, traceback
mods = ("torch", "monai", "numpy", "cv2", "safetensors", "huggingface_hub", "nibabel", "skp")
try:
    for m in mods:
        importlib.import_module(m)
except Exception:
    traceback.print_exc()
    sys.exit(1)
print("imports-ok")
'@
    $probeFile = Join-Path $env:TEMP 'atikviewer-import-probe.py'
    Set-Content -Path $probeFile -Value $probeCode -Encoding UTF8 -ErrorAction Stop
    $probeOut = (& $VenvPy $probeFile 2>&1 | Out-String)
    if ($LASTEXITCODE -ne 0) {
        Write-Host $probeOut -ForegroundColor Red
        throw "Import denetimi başarısız — pip çıktısındaki ilk hatayı kontrol edin."
    }
    if ($probeOut -notmatch 'imports-ok') {
        Write-Host $probeOut -ForegroundColor Red
        throw "Import denetimi beklenmedik çıktı verdi."
    }
    Write-Ok "torch/monai/cv2/nibabel/skp import edilebiliyor"

    # ── 3) Yapay zekâ modelleri ──────────────────────────────────────────
    Write-Step "3/6 Yapay zekâ modelleri indiriliyor (akciğer ≈84 MB + beyin ≈147 MB)"
    & $VenvPy (Join-Path $Root 'ai-worker\setup_model.py')
    if ($LASTEXITCODE -ne 0) {
        throw "Model indirme başarısız (kod $LASTEXITCODE). Ağ/VPN kontrolü yapıp betiği yeniden çalıştırın; dosyalar kaldığı yerden devam eder."
    }
    Write-Ok "Modeller hazır (idempotent: mevcut dosyalar atlandı)"

    # ── 4) Node bağımlılıkları + .env ────────────────────────────────────
    Write-Step "4/6 Node bağımlılıkları ve .env"
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        throw "Node.js görünmüyor. Pencereyi kapatıp yeniden açın ve betiği tekrar çalıştırın."
    }
    if (-not $SkipNpm) {
        Push-Location $Root
        try {
            if (Test-Path (Join-Path $Root 'package-lock.json')) { & npm ci --no-audit --no-fund }
            else { & npm install --no-audit --no-fund }
            if ($LASTEXITCODE -ne 0) { throw "npm kurulumu başarısız (kod $LASTEXITCODE)" }
            Write-Ok "Node paketleri kuruldu"
        } finally { Pop-Location }
    } else {
        Write-Ok "npm atlandı (-SkipNpm)"
    }

    $EnvFile = Join-Path $Root '.env'
    if (-not (Test-Path $EnvFile)) {
        Copy-Item (Join-Path $Root '.env.example') $EnvFile -ErrorAction Stop
        # AES-256-GCM anahtarı (base64, 32 bayt) üret ve .env'e yaz
        $key = $null
        try {
            $bytes = New-Object byte[] 32
            [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
            $key = [Convert]::ToBase64String($bytes)
        } catch {
            $key = [Convert]::ToBase64String((New-Object System.Security.Cryptography.SHA256Managed).ComputeHash([Guid]::NewGuid().ToByteArray()))
        }
        (Get-Content $EnvFile -Raw) -replace '(?m)^DATA_ENCRYPTION_KEY=$', "DATA_ENCRYPTION_KEY=$key" | Set-Content $EnvFile -Encoding UTF8 -ErrorAction Stop
        Write-Ok ".env oluşturuldu (.env.example kopyası + otomatik şifreleme anahtarı)"
    } else {
        Write-Ok ".env mevcut, atlandı"
    }

    # ── 5) İsteğe bağlı derleme ──────────────────────────────────────────
    if ($Build) {
        Write-Step "5/6 Üretim derlemesi (npm run build)"
        Push-Location $Root
        try {
            & npm run build
            if ($LASTEXITCODE -ne 0) { throw "Derleme başarısız (kod $LASTEXITCODE)" }
            Write-Ok "Derleme tamam"
        } finally { Pop-Location }
    } else {
        Write-Step "5/6 Derleme atlandı (-Build ile üretim derlemesi yapılabilir)"
    }

    # ── 6) Özet ──────────────────────────────────────────────────────────
    Write-Step "6/6 Kurulum tamamlandı"
    Write-Host ""
    Write-Host "  Programı başlatmak için:" -ForegroundColor Green
    Write-Host "      windows\Baslat.bat"
    Write-Host ""
    Write-Host "  Ne yapar: yapay zekâ worker'ını (127.0.0.1:8787) ve görüntüleyiciyi"
    Write-Host "  (http://localhost:$DevPort) birlikte açar, tarayıcıyı başlatır."
    Write-Host ""
    Write-Host "  İpuçları:" -ForegroundColor DarkGray
    Write-Host "    - Yeniden kurulum güvenlidir (idempotent); eksik parçalar tamamlanır." -ForegroundColor DarkGray
    Write-Host "    - GPU için torch CUDA'lı kurulur; yalnız CPU isterseniz -CpuTorch ekleyin." -ForegroundColor DarkGray
    Write-Host "    - Sorun olursa kayıt dosyasına bakın: $LogPath" -ForegroundColor DarkGray
    Write-Host ""
}
finally {
    Stop-Transcript | Out-Null
}
