#Requires -Version 5.1
<#
  ATIKVIEWER — çalışan süreçleri kapatır (Dur.bat bu dosyayı çağırır)
  ============================================
  Kapatma iki yoldan denenir, önce güvenilir olan:
    1) Bu depo yolunu içeren node/npm/python süreçleri (komut satırı denetimi)
    2) Yedek: 3000/8787 portlarını dinleyen süreçler (netstat)
  Yalnızca bu projeye ait süreçler hedeflenir; başka uygulamalara dokunulmaz.
#>
$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent $PSScriptRoot

try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$killed = @()

# 1) Yol tabanlı: bu depoyu çalıştıran süreçler
$procs = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
        $_.ProcessId -ne $PID -and
        $_.Name -in @('node.exe', 'npm.cmd', 'node', 'python.exe', 'pythonw.exe') -and
        $_.CommandLine -and ($_.CommandLine -like "*$Root*")
    }
foreach ($p in $procs) {
    try {
        Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop
        $killed += "$($p.ProcessId) ($($p.Name))"
    } catch { }
}

# 2) Port tabanlı yedek (yol eşleşmediyse)
foreach ($port in 3000, 8787) {
    $owner = @()
    try {
        $c = Get-NetTCPConnection -LocalPort $port -ErrorAction Stop | Where-Object { $_.State -eq 'Listen' }
        $owner += @($c | ForEach-Object { $_.OwningProcess })
    } catch { }
    if (-not $owner) {
        $lines = & netstat -ano 2>$null | Select-String -Pattern (":$port\s+.*LISTENING\s+(\d+)")
        $owner += @($lines | ForEach-Object { $_.Matches[0].Groups[1].Value })
    }
    foreach ($pid2 in ($owner | Select-Object -Unique)) {
        if (-not $pid2) { continue }
        if ($killed -match [string]$pid2) { continue }
        try {
            Stop-Process -Id ([int]$pid2) -Force -ErrorAction Stop
            $killed += "$pid2 (port $port)"
        } catch { }
    }
}

if ($killed.Count -gt 0) {
    Write-Host "Kapatilan surecler:" -ForegroundColor Green
    $killed | Sort-Object -Unique | ForEach-Object { Write-Host "  - $_" }
    Start-Sleep -Seconds 1
    Write-Host "Tamamlandi. Yeniden baslatmak icin: windows\Baslat.bat" -ForegroundColor Cyan
} else {
    Write-Host "Kapatilacak calisan ATIKVIEWER surucu bulunamadi." -ForegroundColor Yellow
}
