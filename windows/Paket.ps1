#Requires -Version 5.1
<#
  ATIKVIEWER — Windows kurulum paketi üretimi
  ===========================================
  Inno Setup ile kurulum EXE'si ve taşınabilir ZIP üretir:

    powershell -ExecutionPolicy Bypass -File windows\Paket.ps1

  Çıktılar (dist\ klasörü):
    ATIKVIEWER-<sürüm>-Setup.exe      — kurulum paketi (yönetici izni gerekmez)
    ATIKVIEWER-<sürüm>-portable.zip   — kurulum gerektirmeyen taşınabilir sürüm

  Seçenekler:
    -Version 0.1.1     Sürümü elle ver (varsayılan: src/lib/version.ts)
    -SkipZip           Yalnız kurulum EXE'sini üret

  Inno Setup 6 yoksa: winget install JRSoftware.InnoSetup
#>
param(
    [string]$Version,
    [switch]$SkipZip
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot

function Write-Step([string]$t) { Write-Host ""; Write-Host "==> $t" -ForegroundColor Cyan }
function Write-Ok([string]$t)   { Write-Host "    OK  $t" -ForegroundColor Green }

# ── Sürüm tespiti ve tutarlılık denetimi ───────────────────────────────────
$srcVersion = (Select-String -Path (Join-Path $Root 'src\lib\version.ts') -Pattern 'APP_VERSION\s*=\s*"([^"]+)"').Matches[0].Groups[1].Value
$pkgVersion = (Get-Content (Join-Path $Root 'package.json') -Raw | ConvertFrom-Json).version

if (-not $Version) { $Version = $srcVersion }
if ($Version -ne $srcVersion -or $Version -ne $pkgVersion) {
    throw "Sürüm uyuşmuyor — paket: $Version, src/lib/version.ts: $srcVersion, package.json: $pkgVersion. Üçünü eşitleyin."
}
Write-Ok "sürüm: $Version"

# ── Inno Setup derleyicisi ──────────────────────────────────────────────────
$Iscc = $null
foreach ($candidate in @(
    (Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6\ISCC.exe'),
    (Join-Path $env:ProgramFiles 'Inno Setup 6\ISCC.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 6\ISCC.exe')
)) {
    if ($candidate -and (Test-Path $candidate)) { $Iscc = $candidate; break }
}
if (-not $Iscc) {
    $cmd = Get-Command ISCC.exe -ErrorAction SilentlyContinue
    if ($cmd) { $Iscc = $cmd.Source }
}
if (-not $Iscc) {
    throw "Inno Setup 6 bulunamadı. Kurun: winget install JRSoftware.InnoSetup"
}

$Dist = Join-Path $Root 'dist'
if (-not (Test-Path $Dist)) { New-Item -ItemType Directory -Path $Dist -Force | Out-Null }

Write-Step "Kurulum paketi derleniyor (Inno Setup)"
& $Iscc "/DAppVersion=$Version" (Join-Path $PSScriptRoot 'atikviewer.iss')
if ($LASTEXITCODE -ne 0) { throw "Inno Setup derlemesi başarısız (kod $LASTEXITCODE)" }
$exe = Join-Path $Dist "ATIKVIEWER-$Version-Setup.exe"
if (-not (Test-Path $exe)) { throw "Kurulum dosyası üretilemedi: $exe" }
Write-Ok "$exe ($([math]::Round((Get-Item $exe).Length / 1MB, 1)) MB)"

# ── Taşınabilir ZIP ────────────────────────────────────────────────────────
if (-not $SkipZip) {
    Write-Step "Taşınabilir ZIP hazırlanıyor"
    $stage = Join-Path $env:TEMP "atikviewer-portable-$Version"
    $zip = Join-Path $Dist "ATIKVIEWER-$Version-portable.zip"
    Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item $zip -Force -ErrorAction SilentlyContinue

    # Bağımlılıklar, derleme çıktıları, veriler ve sırlar paketlenmez.
    & robocopy $Root $stage /E /NFL /NDL /NJH /NJS /NP `
        /XD node_modules .next .git .freebuff .venv .data dist tmp ai-worker\data `
        /XF .env *.log *.tsbuildinfo | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy başarısız (kod $LASTEXITCODE)" }

    Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -CompressionLevel Optimal -Force
    Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
    Write-Ok "$zip ($([math]::Round((Get-Item $zip).Length / 1MB, 1)) MB)"
}

Write-Host ""
Write-Host "Paketler hazır: $Dist" -ForegroundColor Green

# robocopy "başarılı" için 1 döndürür; betiğin çıkış kodunu açıkça sıfırla
# (aksi halde CI adımı başarısız sayılır).
exit 0
