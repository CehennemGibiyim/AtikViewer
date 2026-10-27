# ATIKVIEWER — Vision AI Radyoloji İstasyonu

> ⚠️ **Araştırma / demo yazılımıdır; klinik karar için kullanılamaz.**
> Yapay zekâ çıktıları taslak niteliğindedir ve hekim onayı gerektirir.

ATIKVIEWER; DICOM görüntüleme, kesit kesit yapay zekâ destekli inceleme ve
yapısal radyoloji raporu üretimini tek ekranda toplayan, Next.js (App Router) +
PostgreSQL (Drizzle ORM) tabanlı bir radyoloji iş istasyonudur.

## Özellikler

- **DICOM görüntüleyici:** klasör/dosya/ZIP içe aktarma, sürükle-bırak, pencere/seviye
  (WL/WW + BT hazır ayarları), yakınlaştırma, kaydırma, döndürme, ters çevirme, cine
- **Gerçek codec desteği:** JPEG, JPEG Lossless, 12-bit JPEG Extended, JPEG 2000,
  HTJ2K, JPEG-LS, RLE, Deflated, Big Endian (WASM + JS çözücüler)
- **Fotometrik yorumlar:** MONOCHROME1/2, RGB, YBR, PALETTE COLOR; DICOM Overlay
  (60xx) ve GSPS sunum durumları
- **Özel nesneler:** DICOM SR (yapısal rapor), Encapsulated PDF, 12-derivasyonlu EKG
- **MPR:** axial/koronal/sagittal yeniden kesit, MIP/MinIP/ortalama kalın kesit
- **Hanging Protocol motoru:** 1×1'den 3×2'ye düzenler, modaliteye göre otomatik
  protokoller ve görsel özel protokol editörü (JSON içe/dışa aktarma)
- **Görüntü incelemesi:** US renkli Doppler, MR, direkt grafi ve diğer piksel içeren
  modalitelerde bütün kareler gerçek piksellerden ölçülür (sinyal/kontrast, RGB renkli
  alan oranı, kare değişimi); tıklanabilir kare tablosu vardır. **Bu tanısal AI,
  hastalık tespiti veya acil klinik triyaj değildir.** RGB Doppler rengi kan hızı değildir.
- **BT aday odak motoru:** Yalnızca BT beyin (kanama adayı) ve BT toraks (nodül
  adayı) için kural tabanlı, klinik olarak doğrulanmamış inceleme; kesit bazlı kutular,
  aday öncelik skoru ve yöntem kartı. MR/CR örneklerindeki ön tanımlı bulgular DEMO'dur.
- **Derin öğrenme ile gerçek AI çıkarımı (yerel, ücretsiz):** BT toraks serilerinin
  gerçek HU hacmi yerel AI worker'ındaki MONAI `lung_nodule_ct_detection` modeline
  (LUNA16 eğitimi, RetinaNet + ResNet50-3D) gönderilir; model nodül adaylarını kesit
  aralığı, normalize sınır kutusu ve skoruyla döndürür. Bulgular kural tabanlı
  adaylarla birleştirilir, otomatik anahtar kesit önerir ve rapora model kartıyla girer.
  **Çıkarım tamamen bu makinede çalışır; hasta verisi dışarı çıkmaz, ücretli servis
  kullanılmaz. Klinik doğrulanmamıştır; her bulgu radyoloji uzmanı onayı gerektirir.**
- **Raporlama:** taslak → onay akışı, bulgu bazlı hekim doğrulaması, sürümleme,
  addendum, A4 yazdırma, FHIR R4 DiagnosticReport dışa aktarma
- **İş akışı:** çalışma listesi, PACS (DICOMweb QIDO/WADO), HBYS istem alımı,
  kritik bulgu bildirimleri, şifreli sunucu depolaması, hash zincirli denetim kaydı

## Hızlı başlangıç (Docker Compose — önerilen)

```bash
cp .env.example .env        # POSTGRES_PASSWORD ve DATA_ENCRYPTION_KEY doldurun
docker compose up --build -d
```

Ardından `http://localhost:3000` adresini açın. Veritabanı şeması ilk açılışta
otomatik uygulanır. Durum: `http://localhost:3000/api/health`

## Manuel kurulum

Gerekenler: Node.js 22+, PostgreSQL 16+

```bash
npm ci
cp .env.example .env        # DATABASE_URL doldurun
npx drizzle-kit push        # şemayı uygula
npm run dev                 # http://localhost:3000
```

Üretim derlemesi:

```bash
npm run build
npm start
```

> **Windows:** adım adım kurulum, gerekli paketler (Node, Python, PostgreSQL, CUDA),
> derin AI worker kurulumu ve **sık karşılaşılan hataların çözümleri** için
> **[docs/WINDOWS_KURULUM.md](docs/WINDOWS_KURULUM.md)**. Özet:
>
> ```powershell
> git clone https://github.com/CehennemGibiyim/AtikViewer.git
> cd AtikViewer
> Copy-Item .env.example .env
> npm ci
> npx drizzle-kit push --config=drizzle.config.ts
> npm run dev                 # http://localhost:3000
> ```

### Yerel Derin AI (ai-worker)

Derin öğrenme çıkarımı ayrı bir yerel süreçte çalışır (Next.js'ten bağımsız,
yalnızca `127.0.0.1:8787`):

```bash
# Python 3.11–3.13 + (tercihen) CUDA'lı torch
python -m venv .venv && .venv/Scripts/pip install torch monai numpy
python ai-worker/setup_model.py     # MONAI bundle modelini indirir (~84 MB, Apache-2.0)
python ai-worker/server.py          # worker'ı başlatır (CPU'da da çalışır, yavaş olur)
```

- Model: `~/.cache/atikviewer-ai/model/model.pt` (`ATIK_MODEL_DIR` ile değiştirilebilir).
- Durum: `GET /api/deep-scan` → `{"worker":"up"|"down", ...}`
- Uygulama içinde BT toraks analizi otomatik olarak bu uca gider; worker kapalıysa
  kural tabanlı motor devam eder ve uyarı satırı gösterilir.
- Not: Büyük HU hacimleri için `next.config.ts` içinde gövde sınırı 700 MB'a ayarlıdır.

## Ortam değişkenleri

| Değişken | Zorunlu | Açıklama |
|---|---|---|
| `DATABASE_URL` | Evet | PostgreSQL bağlantı dizesi |
| `DATA_ENCRYPTION_KEY` | Üretimde | Base64, 32 bayt AES-256 anahtarı (boşsa `.data/enc.key` üretilir) |
| `PACS_AUTH_HEADER` | Hayır | DICOMweb kimlik başlığı (örn. `Basic …`) |
| `HIS_API_KEY` | Hayır | HBYS istem alımı API anahtarı |
| `LLM_API_URL` / `LLM_API_KEY` / `LLM_MODEL` | Hayır | Taslak izlenim LLM'i (yoksa kural tabanlı yedek) |
| `AI_WORKER_URL` | Hayır | Yerel derin AI worker adresi (varsayılan `http://127.0.0.1:8787`) |

Anahtar üretme: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`

## Komutlar

| Komut | Açıklama |
|---|---|
| `npm run dev` | Geliştirme sunucusu |
| `npx next typegen` | Rota tipleri |
| `npm run typecheck` | TypeScript kontrolü |
| `npm run build` / `npm start` | Üretim derlemesi / sunucusu |
| `npx drizzle-kit push` | Şemayı yerel DB'ye uygula |
| `npx drizzle-kit push --config=drizzle.config.ts` | Şemayı `DATABASE_URL`'deki DB'ye uygula (Docker/üretim) |

## Testler

Tarayıcı regresyon testleri **production** sunucuya karşı çalıştırılır:

```bash
npm run build && npm start          # test edilecek sunucu (BASE_URL varsayılanı :3000)
npm i -D --no-save playwright       # geçici test bağımlılığı (package.json'a yazmaz)
npx playwright install chromium

npm run test:menu                   # menü, sekme, MPR, PNG, iframe, hata senaryoları (15 kontrol)
npm run test:folder                 # klasör içe aktarma + yükleme raporu
npm run test:review                 # görüntü inceleme ölçümleri
npm test                            # AI motoru birim testi (tsx ile)
```

> `tests/menu-interactions.cjs` hem klasik `webkitdirectory` yolunu hem de Chromium'un
> `showDirectoryPicker` yolunu ayrı ayrı sınar. Windows için ayrıntı: [docs/WINDOWS_KURULUM.md](docs/WINDOWS_KURULUM.md)

## GitHub ve yayınlama

Ayrıntılı kılavuz: **[docs/GITHUB_YAYINLAMA.md](docs/GITHUB_YAYINLAMA.md)**

Özet:

```bash
git init && git add . && git commit -m "ATIKVIEWER ilk sürüm"
git branch -M main
git remote add origin https://github.com/KULLANICI/atikviewer.git
git push -u origin main
```

- **CI:** her push'ta tip + derleme kontrolü (`.github/workflows/ci.yml`)
- **Docker imajı:** GHCR'a otomatik yayın (`.github/workflows/docker.yml`)
- **Tek tıkla bulut:** `render.yaml` (Render Blueprint) hazır
- **VPS:** `docker compose up --build -d`

> Not: GitHub Pages yalnızca statik site sunar; sunucu + veritabanı gerektiren bu
> uygulamanın tamamını çalıştıramaz. Gerekçe ve alternatifler yayınlama
> kılavuzundadır.

## Proje yapısı

```text
src/
  app/            Sayfalar ve API uçları (App Router)
  components/     Workstation, Viewport, MPR, SR/PDF/EKG görüntüleyiciler…
  lib/            DICOM okuyucu, codec'ler, AI motoru, hanging protocol…
  lib/server/     Kimlik, denetim, şifreleme, PACS yardımcıları
  lib/vendor/     Lisanslı 12-bit JPEG çözücü (atıflı)
  db/             Drizzle şeması ve istemcisi
public/codecs/    WASM görüntü çözücüleri (repoda tutulur, CDN değildir)
ai-worker/        Yerel derin AI worker (MONAI model çıkarımı, Python)
tests/            Playwright menü + klasör yükleme regresyon testleri
docs/             Yayınlama ve işletim kılavuzları
```

## Güvenlik notları

- `.env` ve `.data/` asla commit'lenmez (`.gitignore` ile korunur).
- Hasta verisi diskte AES-256-GCM ile şifrelidir; anahtar yedeğini saklayın.
- Onay akışı kimlik doğrulamaz (giriş kaldırıldı): rapora profildeki hekim adı yazılır
  ve içerik SHA-256 ile mühürlenir; mühür yalnızca sonradan değişikliği saptar.
  Gerçek hasta verisi için ağ düzeyinde erişim kısıtı şarttır. Bu yazılım tıbbi cihaz
  değildir ve düzenleyici onay süreçlerinin (MDR/TİTCK vb.) yerini tutmaz.

## Lisans

MIT — ayrıntı için [LICENSE](LICENSE) dosyasına bakın.
