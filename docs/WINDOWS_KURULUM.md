# Windows Kurulum ve Çalıştırma Kılavuzu

> Bu belge, ATIKVIEWER'ın **Windows** üzerinde sıfırdan kurulumunu, gerekli paketleri,
> derin AI (ai-worker) kurulumunu ve sık karşılaşılan hataların çözümlerini kapsar.
> Tüm adımlar **ücretsizdir**; ücretli servis, abonelik veya dış API anahtarı gerekmez.
> Hasta verisi ve yapay zekâ çıkarımı yalnızca bu makinede çalışır.

Aşağıdaki komutlar **PowerShell** içindir. `cmd.exe` kullanıyorsanız farklar tabloda belirtilmiştir.

---

## 1. Gereken paketler

| Paket | Sürüm | Neden gerekli | Doğrulama |
|---|---|---|---|
| **Node.js** | 22+ (`.nvmrc` = 22) | Next.js uygulaması, `npm` | `node -v` |
| **npm** | 10+ (Node ile gelir) | bağımlılık kurulumu | `npm -v` |
| **Git** | 2.40+ | kodu indirmek | `git --version` |
| **PostgreSQL** | 16+ | çalışma listesi, rapor, denetim kaydı | `psql --version` |
| **Python** | 3.11 – 3.14 | derin AI worker (ai-worker) | `python --version` |
| **pip** | Python ile gelir | torch/monai kurulumu | `python -m pip -V` |
| *İsteğe bağlı* **NVIDIA sürücüsü + CUDA** | sürücüyle gelen sürüm | GPU ile hızlı çıkarım (CPU'da da çalışır) | `nvidia-smi` |
| *İsteğe bağlı* **Docker Desktop** | 4+ | PostgreSQL'i doğrudan konteyner içinde çalıştırmak | `docker -v` |
| *İsteğe bağlı* **Playwright** | repo ile test edilen sürüm | tarayıcı regresyon testleri | `npx playwright --version` |

Kurulum seçenekleri:

```powershell
# Node.js (winget)
winget install OpenJS.NodeJS.LTS

# Git
winget install Git.Git

# PostgreSQL 16 (EDB kurucusu; servisi otomatik başlatır, port 5432)
winget install PostgreSQL.PostgreSQL.16

# Python 3.13 (ai-worker için önerilen sürüm)
winget install Python.Python.3.13
```

> `winget` yoksa paketleri resmî web sitelerinden indirin. Kurulumdan sonra
> yeni bir PowerShell penceresi açın; `PATH` ancak öyle güncellenir.

---

## 2. Hızlı kurulum (uyulama)

```powershell
git clone https://github.com/CehennemGibiyim/AtikViewer.git
cd AtikViewer

Copy-Item .env.example .env     # cmd.exe: copy .env.example .env
# .env içindeki DATABASE_URL değerini kendi PostgreSQL ayarınıza göre düzenleyin

npm ci                          # bağımlılıkları kurar (lockfile ile birebir)
npx drizzle-kit push --config=drizzle.config.ts   # veritabanı şemasını uygular
npm run dev                     # http://localhost:3000
```

Doğrulama:

```powershell
curl.exe http://localhost:3000/api/health   # {"ok":true}
curl.exe http://localhost:3000/api/deep-scan  # derin AI worker durumu
```

Üretim derlemesi:

```powershell
npm run build
npm start     # aynı şekilde PORT değiştirerek ikinci örnek açılabilir: $env:PORT=3001; npm start
```

---

## 3. Veritabanı (PostgreSQL) — üç seçenek

### Seçenek A — Windows'a doğrudan kurulum (önerilen)

```powershell
winget install PostgreSQL.PostgreSQL.16
```

Kurulumda `postgres` kullanıcısının parolasını not edin. `.env`:

```env
DATABASE_URL=postgresql://postgres:PAROLA@127.0.0.1:5432/app_db
```

Veritabanını oluşturup şemayı uygulayın:

```powershell
psql -U postgres -h 127.0.0.1 -c "CREATE DATABASE app_db;"
npx drizzle-kit push --config=drizzle.config.ts
```

### Seçenek B — Docker Compose (tek komutla tüm sistem)

```powershell
Copy-Item .env.example .env
docker compose up --build -d
```

> Not: `docker-compose.yml` içinde `db` servisinin `ports: "5432:5432"` satırı
> **varsayılan olarak kapalıdır**. Uygulamayı Docker dışında (`npm run dev`) çalıştıracaksanız
> o satırın yorumunu kaldırın; aksi halde `npm run dev` veritabanına ulaşamaz.

### Seçenek C — Uygulamayı Docker ile, DB'yi ayrı

Docker yalnızca `db` servisini başlatıp uygulamayı `npm run dev` ile de
çalıştırabilirsiniz (Seçenek B'deki port açılımı gerekir).

---

## 4. Derin AI worker (ai-worker) — gerçek model çıkarımı

Derin öğrenme çıkarımı ayrı bir yerel süreçte çalışır: `127.0.0.1:8787`.
**Hasta verisi bu süreçten dışarı çıkmaz, hiçbir ücretli servis kullanılmaz.**

### 4.1 Python sanal ortamı ve paketler

```powershell
# Depo kökünde:
python -m venv .venv
.\.venv\Scripts\Activate.ps1          # PowerShell etkinleştirme betiği

# CPU sürümü (her makinede çalışır, yavaştır):
pip install torch monai numpy

# — VEYA — NVIDIA GPU varsa CUDA sürümü (önerilen, ~10× hızlı):
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu130
pip install monai numpy
```

> **cmd.exe** içinde `.venv\Scripts\activate` kullanın (`.ps1` değil).
>
> **PowerShell betik hatası** (`running scripts is disabled on this system`):
> ```powershell
> Set-ExecutionPolicy -Scope Process -ExecutionPolicy RemoteSigned
> ```
>
> **`pip install torch` sürüm bulamazsa** Python sürümünüz çok yeni/çok eski olabilir;
> `python --version` ile 3.11–3.14 arasında olduğundan emin olun, `py -3.13 -m venv .venv`
> ile istediğiniz sürümü seçebilirsiniz.

### 4.2 Model dosyalarını indirme

```powershell
python ai-worker/setup_model.py
```

≈84 MB'lık MONAI `lung_nodule_ct_detection` bundle'ı (LUNA16 eğitimi, Apache-2.0)
`%USERPROFILE%\.cache\atikviewer-ai\model` altına iner; boyut + SHA-256 doğrulanır,
mevcut dosyalar atlanır (tekrar çalıştırması güvenlidir).

### 4.3 Worker'ı başlatma

```powershell
python ai-worker/server.py
# Beklenen çıktı: ATIKVIEWER AI worker: http://127.0.0.1:8787 · model=...
```

Doğrulama (ayrı pencerede):

```powershell
curl.exe http://127.0.0.1:8787/health
# {"ok": true, "modelLoaded": true, "modelFile": true, "roi": [256,256,96]}
```

Arka planda/kalıcı başlatma (oturum kapanınca dursun istemiyorsanız):

```powershell
Start-Process -WindowStyle Hidden -FilePath ".\.venv\Scripts\python.exe" `
  -ArgumentList "-u","ai-worker\server.py" -RedirectOutput "$env:USERPROFILE\.cache\atikviewer-ai\worker.log" -RedirectError "$env:USERPROFILE\.cache\atikviewer-ai\worker.err.log"
```

> Worker **kapalıysa** uygulama yine çalışır: BT toraks analizi kural tabanlı motora düşer
> ve arayüzde uyarı satırı görünür. Derin AI sonuçları için worker'ın açık olması gerekir.
>
> Worker adresi farklıysa `.env` içine `AI_WORKER_URL=http://127.0.0.1:8787` ekleyin.

---

## 5. Testler

```powershell
# Playwright geçici test bağımlılığı (package.json'a yazmaz):
npm i -D --no-save playwright
npx playwright install chromium

$env:BASE_URL = "http://localhost:3000"     # test edilecek sunucu (production: npm run build && npm start)
node tests\menu-interactions.cjs             # menü, sekme, MPR, PNG, hata senaryoları
node tests\folder-import.cjs                 # klasör içe aktarma ve yükleme raporu
node tests\image-review-browser.cjs          # görüntü inceleme ölçümleri (tarayıcı)

# TypeScript birim testi (Node 22.6+ tip kaldırmayı destekler):
node tests\image-review.test.ts
```

> Testler **production** sunucuya (`npm run build` + `npm start`) karşı çalıştırılmalıdır.
> `tests/menu-interactions.cjs` hem klasik `webkitdirectory` yolunu hem de Chromium'un
> `showDirectoryPicker` yolunu ayrı ayrı sınar.

---

## 6. Sık karşılaşılan hatalar

| Belirti | Neden | Çözüm |
|---|---|---|
| `cp : öğe ... bulunamadı` (PowerShell) | `cp` PowerShell'de farklı anlamda davranabilir | `Copy-Item .env.example .env` |
| `DATABASE_URL tanımlı değil` (derleme sırasında) | `.env` yok | `Copy-Item .env.example .env`, sonra `npx drizzle-kit push --config=drizzle.config.ts` |
| `ECONNREFUSED 127.0.0.1:5432` | PostgreSQL çalışmıyor | `Get-Service postgresql*` → `Start-Service postgresql-x64-16` ya da `docker compose up -d db` |
| `port is already in use` (3000) | Başka bir süreç portu tutuyor | `$env:PORT=3001; npm run dev` veya tutan süreci kapatın: `netstat -ano \| findstr :3000` |
| Arayüzde **"Yerel AI worker'a ulaşılamadı (127.0.0.1:8787)"** | ai-worker çalışmıyor | Bölüm 4.3'te worker'ı başlatın; durumu `curl.exe http://localhost:3000/api/deep-scan` ile kontrol edin |
| `Model dosyası bulunamadı: ...model.pt` | model indirilmedi | `python ai-worker/setup_model.py` |
| `No matching distribution found for torch` | Python sürümü uyumsuz | `py -3.13 -m venv .venv` ile 3.11–3.14 arası bir sürüm kullanın |
| `running scripts is disabled on this system` | PowerShell yürütme ilkesi | `Set-ExecutionPolicy -Scope Process -ExecutionPolicy RemoteSigned` |
| Worker çıktısında `?` yerine Türkçe karakter | konsol kod sayfası | `chcp 65001` (cmd) veya PowerShell penceresini yeniden açın; loglar UTF-8 yazılır |
| `npm ci` sırasında `7 vulnerabilities` uyarısı | `next` sürüm bağımlılığı | `npm audit` ile inceleyin; uygulama yalnızca yerel ağda çalıştırıldığında risk düşer (bkz. README "Güvenlik notları") |
| `jest/playwright: Cannot find module 'playwright'` | test bağımlılığı package.json'da yok | `npm i -D --no-save playwright && npx playwright install chromium` |
| Büyük BT serisinde analiz 413/502 | gövde boyutu sınırı | `next.config.ts` içinde `proxyClientMaxBodySize` 700 MB'a ayarlıdır; eski `.next` önbelleğini temizleyip sunucuyu yeniden başlatın: `Remove-Item -Recurse .next; npm run dev` |

---

## 7. Güvenlik ve gizlilik notları

- `.env` ve `.data/` git'e girmez (`.gitignore` ile korunur); içinde bağlantı bilgisi/anahtar bulunur.
- Derin AI worker **yalnızca `127.0.0.1`** üzerinde dinler; ağ dışına istek atmaz.
- Uygulama içindeki yapay zekâ çıktıları **taslak niteliğindedir**: her bulgu
  "Onay Bekliyor" gelir ve **radyoloji uzmanı tüm bulguları onaylamadan rapor onaylanamaz**.
- Bu yazılım tıbbi cihaz değildir; MDR/TİTCK vb. düzenleyici süreçlerinin yerini tutmaz.

---

## 8. Hızlı durum kontrol listesi

```powershell
node -v                                    # 22+
python --version                           # 3.11–3.14
psql --version                             # 16+   (veya docker ps)
curl.exe http://localhost:3000/api/health  # {"ok":true}
curl.exe http://localhost:3000/api/deep-scan   # "worker":"up" olmalı
curl.exe http://127.0.0.1:8787/health      # "modelLoaded":true olmalı
```

Dördü de yeşilse sistem tam çalışıyordur.
