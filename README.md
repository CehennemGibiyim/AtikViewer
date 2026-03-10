Ekran Görünümü >>> https://cehennemgibiyim.github.io/AtikViewer/atik-viewer.html <<< 

Resimli anlatım için bulunan adrese giriniz.>>> https://cehennemgibiyim.github.io/AtikViewer/ <<<

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

4 dosyayı aynı klasöre koyun

Tüm dosyalar aynı dizinde olmalıdır:

📁 AtikViewer/

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

⊕ ATİK VİEWER v1.0.0 TEMA:

● ○ ◑ ◐ Dosya Görünüm Araçlar Filtreler Pencere PACS Yardım PACS DÜZEN 1x1 2x1 2x2 1x3 2x3 MOD MPR 3D | 

ARAÇ 🌓 🔍 ✋ ↕ | ÖLÇÜM 📏 📐 ⬜ ⭕ | DÖNDÜR | ZOOM | 1:1 | 

PRESET ABD AKC KEM BEY | FİLTRE | ORJ PACS LOKAL BİLGİ 

🔌 PACS SUNUCUSU Sunucu: Örnek PACS (1.1.1.1:8080) 

🔌 Test ⚙ Ayarlar 

🔍 HASTA / ÇALIŞMA SORGUSU Hasta Adı Hasta ID Tarih Modalite ✓CT ✓MR ✓CR ✓US ✓XA 

🔍 SORGULA (C-FIND) ⬇ SEÇİLİ ÇALIŞMAYI İNDİR SONUÇLAR 

👤 UYGUR MUSTAFA ID: 43621 · 2024-05-08 · 

🖼 274 görüntü BT Servikal Vertebra CT ▶ Görüntüle 

👤 ÇELİK FATİH ID: 51203 · 2024-03-15 · 

🖼 45 görüntü Akciğer PA MUSTAFA UYGUR 43621 17.09.1982 · 

41Y M 08.05.2024 W: 400 L: 40 Zoom: 1.00× IMA: 47/274 Artvin Devlet Hast. BT Servikal Vertebra CT 

🖼 SERİ 274 görüntü 1/274 2/274 PACS: ARTVIN PACS (C-ECHO OK) Modality: CT W/L: 400/40 Zoom: 1.0× Kare: 47/274

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

⚙ PACS Bağlantı Ayarları ● ARTVIN PACS 127.0.0.1:5656 ○ RIZE PACS ○ TEST SERVER \+ Ekle ✏ Düzenle ✕ Sil Sunucu Açıklaması ARTVIN PACS IP Adresi 127.0.0.1 AE Title DCM_SERVERismi Port 5656 🔌 Test Et ✔ Kaydet C-ECHO başarılı — ARTVIN PACS bağlı

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

[GitHub: CehennemGibiyim/AtikViewer](https://github.com/CehennemGibiyim/AtikViewer)

Tıbbi karar vermek için değil, görüntüleme ve inceleme amaçlıdır.
