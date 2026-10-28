# GitHub'a Gönderme ve Web Sayfası Olarak Yayınlama

Bu kılavuz, ATIKVIEWER projesini GitHub'a yükleyip internette çalışan bir web
sayfası hâline getirmeyi adım adım anlatır.

> **Önemli ön bilgi:** Bu proje **full-stack** bir uygulamadır (Next.js sunucusu +
> PostgreSQL veritabanı + API uçları). **GitHub Pages yalnızca statik dosya
> sunar; bu uygulamayı çalıştıramaz.** Doğru yöntem: kodu GitHub'da tutup
> uygulamayı bir sunucuda (VPS, Render, Vercel vb.) çalıştırmaktır. Ayrıntı en
> alttaki "GitHub Pages neden olmaz?" bölümündedir.

## 1. Kodu GitHub'a gönderme

GitHub'da yeni **boş** bir repo oluşturun (örn. `atikviewer`), README/License
kutularını işaretlemeyin. Ardından proje klasöründe:

```bash
git init
git add .
git commit -m "ATIKVIEWER ilk sürüm"
git branch -M main
git remote add origin https://github.com/KULLANICI_ADINIZ/atikviewer.git
git push -u origin main
```

Kontrol listesi:

- `.env` dosyanız **git'e eklenmemeli** (`.gitignore` bunu engeller, `.env.example`
  şablon olarak gider).
- `public/codecs/*.wasm` ve `public/codecs/*.js` dosyaları **repoda olmalı**
  (JPEG 2000 / HTJ2K / JPEG-LS çözücüler bunlardır).
- Push sonrası GitHub'da **Actions → CI** sekmesinde derlemenin geçtiğini doğrulayın.

## 2. Yayınlama seçenekleri

### Seçenek A — VPS + Docker Compose (önerilen, tam denetim)

Gerekenler: Docker yüklü bir sunucu (Ubuntu 22.04+).

```bash
git clone https://github.com/KULLANICI_ADINIZ/atikviewer.git
cd atikviewer
cp .env.example .env
nano .env   # POSTGRES_PASSWORD ve DATA_ENCRYPTION_KEY doldurun
docker compose up --build -d
```

- Uygulama: `http://SUNUCU_IP:3000`
- İlk açılışta veritabanı şeması otomatik uygulanır.
- Şifreleme anahtarı üretmek için:
  `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
- HTTPS için sunucunun önüne Nginx/Caddy ters vekil sunucu koyun.

### Seçenek B — Render.com (en kolay, ücretsiz başlangıç)

1. `render.yaml` dosyası repoda hazırdır.
2. Render panelinde **New → Blueprint**, reponuzu seçin.
3. `DATABASE_URL` ve `DATA_ENCRYPTION_KEY` otomatik oluşturulur.
4. Deploy bitince verilen `https://…onrender.com` adresini açın.

### Seçenek C — Vercel (uygulama) + haricî PostgreSQL

1. Vercel'de **Add New → Project**, GitHub reponuzu seçin (framework otomatik algılanır).
2. Veritabanı için Neon/Supabase'te ücretsiz PostgreSQL oluşturun.
3. Vercel **Environment Variables** bölümüne ekleyin:
   - `DATABASE_URL` (havuzlu bağlantı dizesi önerilir)
   - `DATA_ENCRYPTION_KEY` (base64, 32 bayt)
   - Varsa: `PACS_AUTH_HEADER`, `HIS_API_KEY`, `LLM_API_URL`, `LLM_API_KEY`
4. Deploy sonrası şemayı bir kez uygulayın (yerel makineden, üretim URL'siyle):
   ```bash
   DATABASE_URL="<üretim-bağlantısı>" npx drizzle-kit push --config=drizzle.config.ts
   ```

### Seçenek D — GHCR hazır imajı (her main push'unda)

`.github/workflows/docker.yml` her `main` push'unda ve `v*` etiketinde
`ghcr.io/KULLANICI_ADINIZ/atikviewer:latest` imajını otomatik yayınlar.

```bash
# Herhangi bir Docker kurulu sunucuda doğrudan çalıştırma:
docker pull ghcr.io/kullaniciniz/atikviewer:latest
docker run -d -p 3000:3000 --env-file .env \
  -v pgdata:/var/lib/postgresql/data \
  ghcr.io/kullaniciniz/atikviewer:latest
```

- **Render'da imaj kullanımı:** Render → New → Web Service → registry
  seçeneğiyle GHCR imajını verebilirsiniz (repo public olmalı veya
  Render'ın GHCR erişimi tanımlanmalı).
- **Üretimde `:latest` yerine sabit etiket** (`v1.2.3`) kullanın; etiketler
  `git tag v1.2.3 && git push --tags` ile yayınlanır.
- GHCR depolama public repoda ücretsizdir; imaj geçmişini Render'da
  kullanmıyorsanız paket ayarlarından temizleyebilirsiniz.

## 3. İlk açılış kontrolleri

- `https://ADRESINIZ/api/health` → `{"ok":true}` dönmeli.
- Ana sayfada örnek vakalar listelenmeli.
- Yönetim panelinden kritik bulgu webhook ve PACS adresini yapılandırın.
- Üretimde `DATA_ENCRYPTION_KEY` tanımlıysa uygulama `env` kaynağını kullanır;
  aksi hâlde `.data/enc.key` üretir (anahtar kaybolursa şifreli veriler açılmaz —
  yedeğini alın).

## 4. Güncelleme akışı

```bash
git pull
docker compose up --build -d   # VPS kullanıyorsanız
```

Vercel/Render'da `main` dalına push yeterlidir; dağıtım otomatik başlar.

## 5. GitHub Pages neden olmaz?

| Gereksinim | GitHub Pages | Bu proje |
|---|---|---|
| Statik HTML/CSS/JS | ✅ | ✅ |
| Node.js sunucusu (API, oturum, rapor) | ❌ | Gerekli (`/api/*`) |
| PostgreSQL | ❌ | Gerekli (Drizzle) |
| WASM codec + dinamik DICOM çözümleme | Kısmen | Sunucu + istemci birlikte |

GitHub Pages'e taşımak, API'yi ve veritabanını söküp uygulamayı salt görüntüleyiciye
indirgemek demektir; rapor kaydetme, çalışma listesi, PACS, denetim kaydı gibi tüm
iş akışları kaybolur. Bu yüzden **önerilmez**. Tanıtım amaçlı statik bir sayfa
istenirse, ayrı bir `tanitim/` klasörü hazırlanıp Pages'te yayımlanabilir; ana
uygulama yine yukarıdaki seçeneklerden biriyle çalışır.
