  ATİK VİEWER — Kurulum ve Kullanım Kılavuzu :root { --accent: #00e5c8; --accent2: #7c3aed; --bg: #0d1117; --bg2: #161b22; --bg3: #21262d; --border: #30363d; --text: #e6edf3; --text2: #8b949e; --green: #3fb950; --yellow: #d29922; --red: #f85149; } \* { box-sizing: border-box; margin: 0; padding: 0; } body { font-family: 'Segoe UI', system-ui, sans-serif; background: var(--bg); color: var(--text); line-height: 1.7; font-size: 15px; } /\* ── HEADER ── \*/ .hero { background: linear-gradient(135deg, #0a0e1a 0%, #0d1f2d 50%, #0a1520 100%); border-bottom: 1px solid var(--border); padding: 60px 40px 50px; text-align: center; position: relative; overflow: hidden; } .hero::before { content: ''; position: absolute; inset: 0; background: radial-gradient(ellipse at 50% 0%, rgba(0,229,200,0.08) 0%, transparent 70%); } .hero-logo { font-size: 42px; font-weight: 900; letter-spacing: 6px; color: var(--accent); text-shadow: 0 0 30px rgba(0,229,200,0.4), 0 0 60px rgba(0,229,200,0.2); margin-bottom: 10px; } .hero-sub { font-size: 16px; color: var(--text2); letter-spacing: 2px; margin-bottom: 24px; } .badge-row { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; margin-top: 20px; } .badge { padding: 4px 14px; border-radius: 20px; font-size: 12px; font-weight: 600; letter-spacing: .5px; } .badge-green { background: rgba(63,185,80,0.15); color: var(--green); border: 1px solid rgba(63,185,80,0.3); } .badge-cyan { background: rgba(0,229,200,0.12); color: var(--accent); border: 1px solid rgba(0,229,200,0.3); } .badge-purple{ background: rgba(124,58,237,0.15); color: #a78bfa; border: 1px solid rgba(124,58,237,0.3); } .badge-yellow{ background: rgba(210,153,34,0.15); color: var(--yellow); border: 1px solid rgba(210,153,34,0.3); } /\* ── LAYOUT ── \*/ .container { max-width: 960px; margin: 0 auto; padding: 0 28px 60px; } .toc { background: var(--bg2); border: 1px solid var(--border); border-radius: 12px; padding: 24px 28px; margin: 36px 0; } .toc h3 { color: var(--accent); font-size: 13px; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 14px; } .toc ol { padding-left: 20px; } .toc li { margin: 6px 0; } .toc a { color: var(--text2); text-decoration: none; transition: color .15s; } .toc a:hover { color: var(--accent); } /\* ── SECTIONS ── \*/ .section { margin: 48px 0; } .section-hdr { display: flex; align-items: center; gap: 12px; border-bottom: 1px solid var(--border); padding-bottom: 12px; margin-bottom: 28px; } .section-num { width: 36px; height: 36px; border-radius: 50%; flex-shrink: 0; background: var(--accent); color: #000; font-weight: 900; font-size: 16px; display: flex; align-items: center; justify-content: center; } .section-num.purple { background: #a78bfa; } .section-num.green { background: var(--green); } .section-num.yellow { background: var(--yellow); } h2 { font-size: 22px; font-weight: 700; color: var(--text); } h3 { font-size: 16px; font-weight: 700; color: var(--accent); margin: 24px 0 10px; } p { color: var(--text2); margin: 8px 0; } p strong { color: var(--text); } /\* ── STEP BOXES ── \*/ .steps { display: flex; flex-direction: column; gap: 16px; } .step { display: flex; gap: 16px; align-items: flex-start; background: var(--bg2); border: 1px solid var(--border); border-radius: 10px; padding: 18px 20px; } .step-n { width: 32px; height: 32px; border-radius: 50%; flex-shrink: 0; background: rgba(0,229,200,0.15); border: 1px solid var(--accent); color: var(--accent); font-weight: 800; font-size: 14px; display: flex; align-items: center; justify-content: center; } .step-body { flex: 1; } .step-title { font-weight: 700; color: var(--text); font-size: 14px; margin-bottom: 4px; } .step-desc { color: var(--text2); font-size: 13px; } .step-code { background: var(--bg3); border: 1px solid var(--border); border-radius: 6px; padding: 8px 12px; font-family: 'Consolas', monospace; font-size: 12px; color: var(--accent); margin-top: 8px; word-break: break-all; } /\* ── CODE BLOCK ── \*/ pre { background: var(--bg3); border: 1px solid var(--border); border-radius: 8px; padding: 16px 18px; overflow-x: auto; font-size: 12.5px; font-family: 'Consolas', 'Courier New', monospace; color: #e6edf3; line-height: 1.6; margin: 12px 0; } code { background: var(--bg3); padding: 2px 6px; border-radius: 4px; font-size: 12px; color: var(--accent); } /\* ── UI DIAGRAM ── \*/ .diagram-wrap { background: var(--bg2); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; margin: 20px 0; } .diagram-caption { background: var(--bg3); padding: 8px 16px; font-size: 11px; color: var(--text2); border-top: 1px solid var(--border); text-align: center; letter-spacing: .5px; } /\* ── FEATURE GRID ── \*/ .feat-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 14px; margin: 16px 0; } .feat-card { background: var(--bg2); border: 1px solid var(--border); border-radius: 10px; padding: 16px 18px; } .feat-icon { font-size: 22px; margin-bottom: 8px; } .feat-title { font-weight: 700; font-size: 13px; color: var(--text); margin-bottom: 4px; } .feat-desc { font-size: 12px; color: var(--text2); line-height: 1.5; } /\* ── SHORTCUT TABLE ── \*/ .kbd-table { width: 100%; border-collapse: collapse; margin: 12px 0; } .kbd-table th { background: var(--bg3); color: var(--accent); padding: 8px 12px; text-align: left; font-size: 11px; letter-spacing: 1px; text-transform: uppercase; border-bottom: 1px solid var(--border); } .kbd-table td { padding: 7px 12px; font-size: 13px; border-bottom: 1px solid rgba(48,54,61,0.5); vertical-align: middle; } .kbd-table tr:last-child td { border-bottom: none; } .kbd { display: inline-block; background: var(--bg3); border: 1px solid var(--border); border-bottom: 2px solid var(--border); border-radius: 4px; padding: 1px 7px; font-family: monospace; font-size: 11px; color: var(--text); } /\* ── ALERT BOXES ── \*/ .alert { border-radius: 8px; padding: 14px 18px; margin: 14px 0; display: flex; gap: 12px; align-items: flex-start; font-size: 13px; } .alert-icon { font-size: 18px; flex-shrink: 0; margin-top: 1px; } .alert-body { flex: 1; } .alert-green { background: rgba(63,185,80,0.08); border: 1px solid rgba(63,185,80,0.25); color: #7ee787; } .alert-yellow { background: rgba(210,153,34,0.08); border: 1px solid rgba(210,153,34,0.25); color: #e3b341; } .alert-cyan { background: rgba(0,229,200,0.08); border: 1px solid rgba(0,229,200,0.25); color: var(--accent); } .alert-red { background: rgba(248,81,73,0.08); border: 1px solid rgba(248,81,73,0.25); color: #ff7b72; } /\* ── FILE TREE ── \*/ .file-tree { background: var(--bg3); border: 1px solid var(--border); border-radius: 8px; padding: 16px 20px; font-family: monospace; font-size: 13px; line-height: 2; } .ft-dir { color: #79c0ff; } .ft-file { color: var(--text); } .ft-note { color: var(--text2); font-size: 11px; } .ft-imp { color: var(--accent); font-weight: bold; } /\* ── FOOTER ── \*/ footer { border-top: 1px solid var(--border); padding: 30px 40px; text-align: center; color: var(--text2); font-size: 13px; } footer a { color: var(--accent); text-decoration: none; }

⊕ ATİK VİEWER

Tıbbi Görüntüleme Sistemi — Kurulum ve Kullanım Kılavuzu

v1.1.0 BETA Sıfır Bağımlılık (HTML Modu) Node.js Proxy Modu DICOM · JPEG · PNG · NIfTI

### 📋 İçindekiler

1.  [Kurulum — İki Mod](#kurulum)
2.  [Arayüz Tanıtımı](#arayuz)
3.  [Dosya Açma](#dosya)
4.  [PACS Bağlantısı](#pacs)
5.  [Görüntüleme Araçları](#araclar)
6.  [Klavye Kısayolları](#kisayollar)
7.  [Sorun Giderme](#sorun)

1

Kurulum — İki Çalışma Modu
--------------------------

Atik Viewer iki farklı modda çalışabilir. İhtiyacınıza göre birini seçin:

### 🅐 HTML Modu (Basit — Tarayıcıda Direkt Aç)

Node.js gerektirmez. Yerel DICOM dosyaları açmak için idealdir. PACS'tan görüntü çekme kısıtlı olabilir.

1

atik-viewer.html dosyasını indirin

Releases sayfasından veya doğrudan GitHub'dan indirin.

https://github.com/CehennemGibiyim/AtikAnaliz

2

Dosyaya çift tıklayın

Varsayılan tarayıcınızda (Chrome, Edge, Firefox) açılır. Kurulum gerekmez.

3

DICOM dosyalarınızı sürükleyip bırakın

Ekran ortasına .dcm, .dicom, JPEG, PNG, NIfTI dosyalarını sürükleyin.

### 🅑 Proxy Modu (PACS Entegrasyonu için — Önerilen)

Gerçek PACS sorgusu (C-FIND / WADO-RS) için Node.js proxy gereklidir. CORS engelini aşar.

1

4 dosyayı aynı klasöre koyun

Tüm dosyalar aynı dizinde olmalıdır:

📁 AtikAnaliz/

  ├── atik-viewer.html ← Ana uygulama

  ├── server.js ← Proxy sunucusu

  ├── package.json ← Bağımlılık tanımı

  └── BASLAT.bat ← Windows başlatıcı

2

Node.js yükleyin (bir kez)

Node.js kurulu değilse BASLAT.bat otomatik yönlendirme yapar.

https://nodejs.org → LTS sürümünü indirin

3

BASLAT.bat dosyasına çift tıklayın

İlk çalıştırmada npm install otomatik yapılır. Tarayıcı localhost:3000 adresinde açılır.

4

Tarayıcıda açın

http://localhost:3000

BASLAT.bat bunu otomatik yapar. Siyah bir komut penceresi açık kaldığı sürece sunucu çalışır.

⚠️

Proxy sunucusunu kapatmak için komut penceresini kapatmanız yeterlidir. Bilgisayar yeniden başlatıldığında BASLAT.bat'ı tekrar çalıştırın.

2

Arayüz Tanıtımı
---------------

⊕ ATİK VİEWER v1.0.0 TEMA: ● ○ ◑ ◐ Dosya Görünüm Araçlar Filtreler Pencere PACS Yardım PACS DÜZEN 1x1 2x1 2x2 1x3 2x3 MOD MPR 3D | ARAÇ 🌓 🔍 ✋ ↕ | ÖLÇÜM 📏 📐 ⬜ ⭕ | DÖNDÜR | ZOOM | 1:1 | PRESET ABD AKC KEM BEY | FİLTRE | ORJ PACS LOKAL BİLGİ 🔌 PACS SUNUCUSU Sunucu: ARTVIN PACS (10.8.64.8:4006) 🔌 Test ⚙ Ayarlar 🔍 HASTA / ÇALIŞMA SORGUSU Hasta Adı Hasta ID Tarih Modalite ✓CT ✓MR ✓CR ✓US ✓XA 🔍 SORGULA (C-FIND) ⬇ SEÇİLİ ÇALIŞMAYI İNDİR SONUÇLAR 👤 UYGUR MUSTAFA ID: 43621 · 2024-05-08 · 🖼 274 görüntü BT Servikal Vertebra CT ▶ Görüntüle 👤 ÇELİK FATİH ID: 51203 · 2024-03-15 · 🖼 45 görüntü Akciğer PA MUSTAFA UYGUR 43621 17.09.1982 · 41Y M 08.05.2024 W: 400 L: 40 Zoom: 1.00× IMA: 47/274 Artvin Devlet Hast. BT Servikal Vertebra CT 🖼 SERİ 274 görüntü 1/274 2/274 PACS: ARTVIN PACS (C-ECHO OK) Modality: CT W/L: 400/40 Zoom: 1.0× Kare: 47/274

Şekil 1 — Atik Viewer Ana Arayüzü · Koyu tema, PACS bağlı, CT görüntü yüklü

🔝

Başlık Çubuğu

Uygulama adı, sürüm bilgisi ve sağ tarafta 7 farklı renk teması seçicisi bulunur.

📋

Menü Çubuğu

Tıklayarak açılan açılır menüler: Dosya, Görünüm, Araçlar, Filtreler, Pencere, PACS, Yardım.

🛠

Araç Çubuğu

Izgaralar, görüntüleme araçları, ölçüm araçları, döndürme, zoom ve pencere/seviye önayarları.

◧

Sol Panel (PACS / Lokal / Bilgi)

PACS sorgusu, lokal dosya ağacı ve DICOM etiket bilgileri üç sekme halinde.

🖥

Görüntü Alanı (Viewport)

Hasta bilgisi overlay, DICOM görüntü, pencere/seviye ve zoom bilgisi. 1×1'den 2×3'e kadar ızgara.

◨

Sağ Panel (Seri / Thumbnail)

Yüklenen serinin thumbnail listesi, kare numarası. Tıklayarak kareye atlanır.

3

Dosya Açma
----------

DICOM, JPEG, PNG, BMP, TIFF, NIfTI formatları desteklenir

① Sürükle & Bırak 📂 Dosyaları buraya sürükleyin .dcm · .dicom · klasör ② Buton ile Aç 📂 Dosya Aç 📁 Klasör Aç Ctrl+O · Ctrl+Shift+O ③ PACS'tan Çek Hasta Adı: mustafa\* 🔍 SORGULA 👤 MUSTAFA UYGUR ▶ Görüntüle butonuna basın Proxy modu gerektirir

Şekil 2 — Üç farklı görüntü yükleme yöntemi

💡

**İpucu:** Klasör sürükleyip bıraktığınızda tüm alt klasörler de taranır. Çok kesitli CT/MR serileri otomatik olarak birleştirilerek seri olarak açılır.

4

PACS Bağlantısı
---------------

Akgun, DCM4CHEE, Orthanc ve DICOMweb destekli PACS sistemleri

### PACS Sunucu Ayarları

⚙ PACS Bağlantı Ayarları ● ARTVIN PACS 10.8.64.8:4006 ○ RIZE PACS ○ TEST SERVER \+ Ekle ✏ Düzenle ✕ Sil Sunucu Açıklaması ARTVIN PACS IP Adresi 10.8.64.8 AE Title DCM\_SERVER Port 4006 🔌 Test Et ✔ Kaydet C-ECHO başarılı — ARTVIN PACS bağlı

Şekil 3 — PACS Sunucu Ayarları ekranı. PACS menüsü → PACS Sunucu Ayarları veya Sol panel → Ayarlar butonu

### Hasta Sorgulama Akışı

1\. Hasta adı girin mustafa\* 2\. Tarih aralığı ve modalite CT · MR · CR … 3\. SORGULA butonuna bas C-FIND / QIDO-RS 4\. Sonuçtan hasta seç tıkla 5\. ▶ Görüntüle butonuna bas WADO-RS / C-MOVE

Şekil 4 — PACS'tan görüntü sorgulama ve açma akışı

⚠️

**CORS Uyarısı:** Tarayıcı güvenlik politikası nedeniyle `file://` protokolüyle açılan HTML'den PACS'a direkt TCP bağlantısı yapılamaz. PACS sorgulama için **BASLAT.bat → localhost:3000** üzerinden çalıştırın veya PACS'ın DICOMweb/WADO-RS özelliğini etkinleştirin.

5

Görüntüleme Araçları
--------------------

🌓

Pencere / Seviye (W/L)

Sol tık + sürükle: yatay → pencere genişliği, dikey → seviye. Kontrast ve parlaklık ayarı.

🔍

Yakınlaştır

Sol tık + yukarı/aşağı sürükle. Mouse tekerleği ile de zoom yapılabilir.

✋

Kaydır (Pan)

Görüntüyü viewport içinde hareket ettirin. Büyük görüntülerde detay incelemesi için.

↕

Seri Kaydır

Sol tık + yukarı/aşağı sürükle ile serinin farklı kesitlerini gezin. Mouse tekerleği de çalışır.

📏

Mesafe Ölçümü

İki nokta arasındaki mesafeyi mm cinsinden gösterir. DICOM pixel spacing verisini kullanır.

📐

Açı Ölçümü

Üç nokta tanımlayarak açı ölçer. Omurga ve eklem açısı değerlendirmesi için.

⬜

Dikdörtgen ROI

Seçilen alan için HU ortalama, min, max, standart sapma değerleri hesaplanır.

⭕

Elips ROI

Oval seçim alanı ile doku analizi. Yuvarlak yapılar için dikdörtgene göre daha hassas.

### Pencere/Seviye Önayarları (Presets)

Preset

Pencere (WW)

Seviye (WC)

Kullanım

Karın (ABD)

400

40

Batın CT incelemeleri

Akciğer (AKC)

1500

\-600

Akciğer parankimi

Kemik (KEM)

2000

400

Kemik yapıları, kırıklar

Beyin (BEY)

80

40

Beyin parankimi, kanama

Karaciğer (KAR)

150

50

Karaciğer lezyonları

Omurga (OMU)

600

300

Vertebra, disk

Mediastinum

400

40

Mediasten yapıları

6

Klavye Kısayolları
------------------

Kısayol

İşlev

Kısayol

İşlev

Ctrl+O

Dosya Aç

W

Pencere/Seviye aracı

Ctrl+Shift+O

Klasör Aç

Z

Yakınlaştır aracı

Ctrl+P

Yazdır

P

Kaydır (Pan) aracı

F11

Tam Ekran

S

Seri Kaydır aracı

1

1×1 Izgara

L

Mesafe ölçümü

2

2×1 Izgara

A

Açı ölçümü

4

2×2 Izgara

R

Dikdörtgen ROI

I

Görüntü Ters Çevir

Del

Ölçümleri Temizle

Space

Sonraki kare

← →

Önceki / Sonraki kare

Esc

Modalları kapat

🖱 Tekerlek

Kare kaydır

7

Sık Karşılaşılan Sorunlar
-------------------------

❌

**PACS'a ulaşılamıyor / "Sonuç bulunamadı"**  
Tarayıcı güvenliği nedeniyle direkt DICOM TCP bağlantısı yapılamaz. Çözüm: `BASLAT.bat` ile proxy sunucusunu başlatın ve `http://localhost:3000` adresinden açın.

⚠️

**Node.js bulunamadı**  
`BASLAT.bat` Node.js'i bulamazsa tarayıcıda `https://nodejs.org` açar. LTS sürümünü indirip kurun, ardından BASLAT.bat'ı tekrar çalıştırın.

⚠️

**Görüntü açılmıyor / boş viewport**  
DICOM dosyasının gerçek piksel verisi içerdiğinden emin olun. Bazı PACS sistemlerinde DICOMDIR dosyası ayrı paket gerektirebilir.

✅

**PACS DICOMweb (WADO-RS) Aktifse**  
CORS izni verilmişse proxy gerekmez. HTML dosyasını direkt açıp PACS ayarlarında WADO-RS URL'sini girin: `http://[PACS-IP]:[PORT]/wado/rs`

### Sistem Gereksinimleri

Bileşen

Minimum

Önerilen

Tarayıcı

Chrome 90+, Firefox 88+, Edge 90+

Chrome / Edge güncel

RAM

4 GB

8 GB (büyük CT serileri için)

Node.js (Proxy modu)

v16+

v20 LTS

Ekran çözünürlüğü

1280×720

1920×1080

İşletim Sistemi

Windows 10

Windows 10/11

ATİK VİEWER v1.1.0 — Mustafa UYGUR

[GitHub: CehennemGibiyim/AtikAnaliz](https://github.com/CehennemGibiyim/AtikAnaliz)

Tıbbi karar vermek için değil, görüntüleme ve inceleme amaçlıdır.