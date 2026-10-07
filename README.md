Ekran Görünümü >>> https://cehennemgibiyim.github.io/AtikViewer/atik-viewer.html <<< 

Resimli anlatım için bulunan adrese giriniz.>>> https://cehennemgibiyim.github.io/AtikViewer/ <<<

⊕ ATİK VİEWER

Tıbbi Görüntüleme Sistemi — Kurulum ve Kullanım Kılavuzu

v1.1.0 BETA · HTML Görüntüleyici · Yerel Node.js Proxy · DICOM · JPEG · PNG · NIfTI

> ⚠️ **Güvenlik ve tıbbi kullanım notu:** AtikViewer şu anda geliştirme/prototip aşamasındadır; klinik olarak doğrulanmış bir tanı sistemi değildir ve tek başına tanı/tedavi kararı için kullanılmamalıdır. Bu aşamada çalışan bir AI modeli/AI tanı entegrasyonu yoktur. Mutlak “sıfır hata” garantisi verilemez. GitHub Pages statik görüntüleyici ve kılavuz dosyalarını sunar; burada sunucu tarafında PACS proxy'si veya çalışan AI modeli yoktur. Görüntüleyicide yerel seçilen dosyalar bu sayfaya yüklenmez. Gerçek hasta verisini, PACS bilgilerini veya model ağırlıklarını herkese açık GitHub deposuna/Issues'a yüklemeyin. `/api/pacs/echo` şu an yalnızca TCP port erişimini kontrol eder; DICOM C-ECHO gerçekleştirmez.

### Geliştirici kurulumu ve kontroller

Node.js 18 veya üzeri gerekir. Depo klasöründe:

```bash
npm ci
npm run check
npm start
```

Ardından `http://127.0.0.1:3000` adresini açın. Sunucu varsayılan olarak yalnızca bu bilgisayarda dinler. Windows'ta `BASLAT.bat`, Linux/macOS'ta `./BASLAT.sh` kullanılabilir. Gerçek PACS/AI uç noktalarını kurum ağına açmak için bu prototip henüz hazır değildir; kimlik doğrulama ve dağıtım güvenliği ayrıca ele alınmalıdır.

Görüntüleyici Three.js dosyasını CDN yerine `vendor/` klasöründen yükler. Tek HTML dosyasını değil, bu klasörü de içeren depo/ZIP paketini kullanın. Çok-modaliteli mimari, kütüphane araştırması ve kurulum yol haritası: [`docs/STACK-AND-ROADMAP.md`](docs/STACK-AND-ROADMAP.md).

### 📋 İçindekiler

1.  [Kurulum — İki Mod](#kurulum)
2.  [Arayüz Tanıtımı](#arayuz)
3.  [Dosya Açma](#dosya)
4.  [PACS Bağlantısı](#pacs)
5.  [Görüntüleme Araçları](#araclar)
6.  [Klavye Kısayolları](#kisayollar)
7.  [Sorun Giderme](#sorun)
8.  [Çok modaliteli AI ve kütüphane yol haritası](docs/STACK-AND-ROADMAP.md)

1

Kurulum — İki Çalışma Modu
--------------------------

Atik Viewer iki farklı modda çalışabilir. İhtiyacınıza göre birini seçin:

### 🅐 HTML Modu (Basit — Tarayıcıda Direkt Aç)

Node.js gerektirmez. Yerel DICOM dosyaları açmak için idealdir. PACS'tan görüntü çekme kısıtlı olabilir.

1

Depo ZIP dosyasını indirin

`atik-viewer.html` ile birlikte `vendor/` klasörünü de indirin; yerel Three.js dosyası bu klasördedir.

https://github.com/CehennemGibiyim/AtikViewer

2

Dosyaya çift tıklayın

Varsayılan tarayıcınızda (Chrome, Edge, Firefox) açılır. Kurulum gerekmez.

3

DICOM dosyalarınızı sürükleyip bırakın

Ekran ortasına .dcm, .dicom, JPEG, PNG, NIfTI dosyalarını sürükleyin.

### 🅑 Proxy Modu (PACS Entegrasyonu için — Önerilen)

Gerçek PACS sorgusu (C-FIND / WADO-RS) için Node.js proxy gereklidir. CORS engelini aşar.

1

Depo dosyalarını birlikte tutun

Tüm uygulama dosyalarını, özellikle Three.js için `vendor/` klasörünü aynı proje klasöründe bırakın:

📁 AtikViewer/

  ├── atik-viewer.html ← Ana uygulama

  ├── vendor/ ← Yerel Three.js ve lisansı

  ├── server.js ← Yerel proxy sunucusu

  ├── package.json / package-lock.json

  ├── BASLAT.bat ← Windows başlatıcı

  └── BASLAT.sh ← Linux/macOS başlatıcı

2

Node.js 18 veya üzeri LTS sürümünü yükleyin

Node.js kurulu değilse BASLAT.bat indirme sayfasını açar.

https://nodejs.org

3

BASLAT.bat dosyasına çift tıklayın

İlk çalıştırmada kilit dosyasındaki sürümlerle `npm ci` çalışır. Tarayıcı `http://127.0.0.1:3000` adresinde açılır. Linux/macOS'ta terminalden `./BASLAT.sh` çalıştırın.

4

Tarayıcıda açın

http://127.0.0.1:3000

BASLAT.bat bunu otomatik yapar. Siyah bir komut penceresi açık kaldığı sürece sunucu çalışır.

⚠️

Proxy sunucusunu kapatmak için komut penceresini kapatmanız yeterlidir. Bilgisayar yeniden başlatıldığında BASLAT.bat'ı tekrar çalıştırın.

2

Arayüz Tanıtımı
---------------

⊕ ATİK VİEWER v1.1.0 TEMA:

● ○ ◑ ◐ Dosya Görünüm Araçlar Filtreler Pencere PACS Yardım PACS DÜZEN 1x1 2x1 2x2 1x3 2x3 MOD MPR 3D | 

ARAÇ 🌓 🔍 ✋ ↕ | ÖLÇÜM 📏 📐 ⬜ ⭕ | DÖNDÜR | ZOOM | 1:1 | 

PRESET ABD AKC KEM BEY | FİLTRE | ORJ PACS LOKAL BİLGİ 

🔌 PACS SUNUCUSU Sunucu: Örnek PACS (1.1.1.1:8080) 

🔌 Test ⚙ Ayarlar 

🔍 HASTA / ÇALIŞMA SORGUSU Hasta Adı Hasta ID Tarih Modalite ✓CT ✓MR ✓CR ✓US ✓XA 

🔍 SORGULA (C-FIND) ⬇ SEÇİLİ ÇALIŞMAYI İNDİR SONUÇLAR 

👤 ÖRNEK HASTA ID: DEMO-0001 · 2000-01-01 ·

🖼 274 görüntü BT Servikal Vertebra CT ▶ Görüntüle 

👤 SENTETİK HASTA ID: DEMO-0002 · 2000-01-02 ·

🖼 45 görüntü Akciğer PA ÖRNEK HASTA DEMO-0001 01.01.1970 ·

56Y M 01.01.2000 W: 400 L: 40 Zoom: 1.00× IMA: 47/274 DEMO HASTANESİ BT Servikal Vertebra CT

🖼 SERİ 274 görüntü 1/274 2/274 PACS: DEMO PACS (TCP portu açık; DICOM C-ECHO doğrulanmadı) Modality: CT W/L: 400/40 Zoom: 1.0× Kare: 47/274

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

DICOM, JPEG, PNG, BMP, TIFF ve NIfTI denenebilir; DICOM transfer syntax/codec desteği sınırlı olabilir

① Sürükle & Bırak 📂 Dosyaları buraya sürükleyin .dcm · .dicom · klasör ② Buton ile Aç 📂 Dosya Aç 📁 Klasör Aç Ctrl+O · Ctrl+Shift+O ③ PACS'tan Çek Hasta Adı: ornek\* 🔍 SORGULA 👤 ÖRNEK HASTA ▶ Görüntüle butonuna basın Proxy modu gerektirir

Şekil 2 — Üç farklı görüntü yükleme yöntemi

💡

**İpucu:** Klasör sürükleyip bıraktığınızda tüm alt klasörler de taranır. Çok kesitli CT/MR serileri otomatik olarak birleştirilerek seri olarak açılır.

4

PACS Bağlantısı
---------------

Akgun, DCM4CHEE, Orthanc ve DICOMweb destekli PACS sistemleri

### PACS Sunucu Ayarları

⚙ PACS Bağlantı Ayarları ● DEMO PACS 127.0.0.1:5656 ○ TEST PACS ○ TEST SERVER \+ Ekle ✏ Düzenle ✕ Sil Sunucu Açıklaması DEMO PACS IP Adresi 127.0.0.1 AE Title DCM_SERVERismi Port 5656 🔌 Test Et ✔ Kaydet TCP portu açık — DICOM C-ECHO doğrulanmadı

Şekil 3 — PACS Sunucu Ayarları ekranı. PACS menüsü → PACS Sunucu Ayarları veya Sol panel → Ayarlar butonu

### Hasta Sorgulama Akışı

1\. Hasta adı girin ornek\* 2\. Tarih aralığı ve modalite CT · MR · CR … 3\. SORGULA butonuna bas C-FIND / QIDO-RS 4\. Sonuçtan hasta seç tıkla 5\. WADO-RS uç noktasını test et — mevcut prototip çalışma görüntülerini indirmez.

Şekil 4 — PACS'tan görüntü sorgulama ve açma akışı

⚠️

**PACS uyarısı:** Tarayıcıdan doğrudan DICOM TCP bağlantısı yapılamaz. Bu sürümün PACS API'si için **BASLAT.bat → http://127.0.0.1:3000** üzerinden açın. GitHub Pages veya `file://` sayfası PACS proxy/API'sini sağlamaz.

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

> ⚠️ **MPR/3D prototip uyarısı:** Bu araçlar klinik olarak doğrulanmamıştır. MPR, voxel spacing/orientation bilgileriyle doğrulanmış değildir; 3D yalnızca orta kesiti bir küp üzerine texture eder, gerçek hacim renderı/MIP/yüzey çıkarımı yapmaz. Tanısal değerlendirmede kullanmayın.

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
Tarayıcı güvenliği nedeniyle direkt DICOM TCP bağlantısı yapılamaz. Çözüm: `BASLAT.bat` ile proxy sunucusunu başlatın ve `http://127.0.0.1:3000` adresinden açın.

⚠️

**Node.js bulunamadı**

Windows'ta `BASLAT.bat` Node.js yoksa indirme sayfasını açar. Linux/macOS'ta Node.js 18+ LTS ve npm'i kurup `./BASLAT.sh` komutunu yeniden çalıştırın.

⚠️

**Görüntü açılmıyor / boş viewport**  
DICOM dosyasının gerçek piksel verisi içerdiğinden emin olun. Bazı PACS sistemlerinde DICOMDIR dosyası ayrı paket gerektirebilir.

✅

**PACS DICOMweb (WADO-RS) Aktifse**

Bu prototip, yerel proxy üzerinden yalnızca WADO-RS uç noktasını sınar; çalışma görüntülerini indirmez/görüntülemez. PACS sorgusu için Windows'ta `BASLAT.bat`, Linux/macOS'ta `./BASLAT.sh` başlatıcısını kullanın.

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

v18+

v20 LTS

Ekran çözünürlüğü

1280×720

1920×1080

İşletim Sistemi

Windows 10/11, Linux veya macOS (Node.js kurulumuna göre)

Windows 10/11, Linux/macOS güncel sürüm

### Çok modaliteli AI hedefi ve açık kaynak kütüphaneler

Hedef, görüntüleyici/veri katmanında farklı DICOM modalitelerini kademeli desteklemek ve AI'ı her görev+modalite için ayrı, yerel çalışan modüller halinde tasarlamaktır. **Tek modelin tüm radyolojiyi kapsadığı varsayılmayacaktır.** Bu depoda henüz çalışan AI modeli veya klinik olarak doğrulanmış tanı özelliği yoktur; model ağırlıkları da Git'e eklenmez.

Güncel araştırma ve lisans özeti: [`docs/STACK-AND-ROADMAP.md`](docs/STACK-AND-ROADMAP.md). İlk teknik adaylar Cornerstone3D (DICOM viewport/MPR), dcmjs (DICOM nesne/metadata), MONAI (yerel Python inference), gerektiğinde vtk.js ve ONNX Runtime'dır. Eklenti seçimi mevcut arayüzü bozmayan sentetik veri prototipiyle doğrulanmadan yapılmayacaktır.

ATİK VİEWER v1.1.0 — Mustafa UYGUR

[GitHub: CehennemGibiyim/AtikViewer](https://github.com/CehennemGibiyim/AtikViewer)

Tıbbi karar vermek için değil, görüntüleme ve inceleme amaçlıdır.
