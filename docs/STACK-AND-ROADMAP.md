# Çok Modlu Radyoloji: Araştırma ve Uygulama Yol Haritası

**Araştırma tarihi: 7 Ekim 2026.** Sürüm numaraları o gün npm/PyPI paket kayıtlarından kontrol edilmiştir; model ağırlığı lisansları uygulama kütüphanesinin lisansından ayrıdır.

## Kapsamı doğru tanımlayalım

Hedef, AtikViewer'ın farklı DICOM modalitelerini ve görüntüleme iş akışlarını aşamalı olarak ele alabilen bir platform olmasıdır. Ancak **tek bir modelin tüm radyolojideki tüm hastalıkları, anatomileri ve inceleme türlerini güvenilir biçimde çözmesi gerçekçi veya güvenli değildir.** Klinik AI, her biri kendi girdi sınırları, veri seti, model kartı, lisansı ve doğrulama planı olan görev-modality bileşenleri halinde eklenmelidir.

Bu nedenle:

- **Görüntüleyici hedefi:** DICOM standardındaki bilinen ve yeni/kuruma özgü modality değerlerini tanımaya çalışmak; çözülemeyenleri kaybetmeden “desteklenmeyen/yalnız metadata” olarak göstermek.
- **AI hedefi:** CT, MR, radyografi, ultrason, mamografi, nükleer tıp/PET, floroskopi/anjiyografi ve diğer iş akışları için ayrı ayrı görev eklentileri tasarlamak. Bir modality'nin listede olması, decoder veya klinik AI desteği olduğu anlamına gelmez.
- **Güvenlik hedefi:** Yerel/kurum içi çalışma, açıkça belirtilen belirsizlikte durma, model/çıktı kaynağını kaydetme ve AI bulgularını radyolog onayına kadar taslak tutma.

Şu an çalışan bir AI modeli, model indiricisi veya klinik olarak doğrulanmış tanı işlevi **yoktur**. Aşağıdaki teknoloji önerileri entegrasyon araştırmasıdır; henüz uygulamaya eklenmiş bağımlılıklar değildir.

## Çok-modlu mimari önerisi

1. **GitHub Pages:** Statik arayüz, görsel rehber ve sentetik örnekler. Sunucu, PACS proxy'si veya AI çalıştırıcısı barındırmaz. Kullanıcının tarayıcıda yerel açtığı dosyalar bu siteye yüklenmez.
2. **Arayüz:** Mevcut AtikViewer düzenini koruyup DICOM görüntüleme çekirdeğini bir özellik dalında kademeli değiştirmek. Modality etiketi DICOM metadata'dan okunur; dosya adından yapılan tahmin yalnızca son çare olabilir.
3. **Yerel servis:** TypeScript/Node API mevcut PACS/UI sınırını ve görev isteklerini yönetir. DICOMweb uç noktaları yapılandırılmış PACS hostlarıyla sınırlanır.
4. **Yerel AI çalıştırıcısı:** Görev/model gerektiriyorsa, PyTorch/MONAI ekosisteminde ayrı Python servisi. Tarayıcıdan üçüncü taraf inference API'sine DICOM gönderilmez. İnference servisi de varsayılan olarak loopback'te dinler.
5. **Görev eklentileri:** Her eklenti `modality + anatomi + görev + girdi koşulları + model sürümü + ağırlık lisansı + SHA-256 + donanım gereksinimi + doğrulama durumu` bildirir. Desteklenmeyen girdi sessizce analiz edilmez.
6. **İnsan incelemesi:** Çıktı görüntü/slice/frame referansları ve uyarılarıyla taslak olarak gösterilir. Onay, düzenleme, ret ve erteleme kaydı radyolog tarafından yapılır; otomatik imza/rapor yoktur.

## Açık kaynak kütüphane araştırması

| Bileşen | Kayıt sürümü / lisans | Önerilen kullanım | Sınırlama / karar |
|---|---|---|---|
| [Cornerstone3D](https://github.com/cornerstonejs/cornerstone3D) (`@cornerstonejs/core`, `@cornerstonejs/dicom-image-loader`, `@cornerstonejs/tools`) | 5.11.6 · MIT | Tarayıcıda DICOM stack/volume görüntüleme, araçlar ve MPR için ilk aday. Mevcut koyu UI'nin yerine değil, onun viewport'una kademeli entegrasyon. | Vite/bundler ve codec/transfer syntax uyumluluğu denemesi gerekir. Yalnızca dependency eklemek tüm DICOM'ları desteklemez. |
| [OHIF Viewer](https://github.com/OHIF/Viewers) | MIT | Hazır DICOMweb iş akışları ve erişilebilirlik için referans ürün/mimari. | Tam OHIF uygulamasını gömmek arayüzü değiştirebilir; ilk adımda doğrudan fork yerine referans alınması önerilir. |
| [dcmjs](https://github.com/dcmjs-org/dcmjs) | 0.52.0 · MIT | DICOM metadata ve DICOM nesneleriyle JavaScript/TypeScript tarafında çalışma. | Piksel decoder'ı ve tüm transfer syntax'ların yerine geçmez; Cornerstone ile görev sınırları netleştirilmeli. |
| [vtk.js](https://github.com/Kitware/vtk-js) | 37.4.1 · BSD-3-Clause | Gerektiğinde hacim görselleştirme ve bilimsel görüntüleme algoritmaları. | Cornerstone3D ile örtüşen alanlar var; iki render çekirdeğini baştan birlikte kurmak yerine gerçek ihtiyaçla doğrulanmalı. |
| [MONAI](https://github.com/Project-MONAI/MONAI) | 1.6.1 · Apache-2.0 | Yerel Python/PyTorch inference ve görev bazlı medikal görüntü iş akışları. | MONAI lisansı, model ağırlıklarının kullanım izni değildir; her model/dataset ayrıca incelenir. |
| [TorchIO](https://github.com/TorchIO-project/torchio) | 1.2.1 · Apache-2.0 | Özellikle 3D görüntüler için araştırma, preprocessing ve veri artırma araçları. | Canlı klinik servis için kullanımdan önce işlemlerin deterministikliği ve girdi geometrisi test edilmelidir. |
| [ONNX Runtime](https://github.com/microsoft/onnxruntime) (`onnxruntime-node`) | 1.30.0 · MIT | Yalnızca uygun biçimde dışa aktarılmış, aynı girdilerde test edilmiş modeller için yerel alternatif runtime. | Her PyTorch model ONNX'e sorunsuz çevrilemez; çıktı denkliği ve CPU/GPU provider kurulumu doğrulanmadan kullanılmamalı. |
| [pydicom](https://github.com/pydicom/pydicom) | 3.0.2 · çoğunlukla MIT | Python servisinde DICOM metadata ve dosya işlemleri. | Proje lisansında GDCM kaynaklı özel sözlük parçaları için ek lisans notları var; dağıtım paketi ayrıca incelenmeli. |
| [Vite](https://github.com/vitejs/vite) | 8.3.3 · MIT | Cornerstone gibi modüler tarayıcı kütüphanelerini GitHub Pages alt yoluna ve yerel servise bundle etmek için aday. | Mevcut tek HTML doğrudan GitHub Pages'te çalışıyor; bundler ancak entegrasyon prototipi ile eklenmeli. |

**Sürüm notu:** AtikViewer bugün Three.js `0.128.0` (r128) dosyasını yerelden yükler. Npm'de kontrol edilen güncel Three.js sürümü `0.186.1` idi; yeni sürümün paketleme biçimi eski global `THREE` kullanımından farklıdır. Bu yüzden doğrudan yükseltme yapılmadı. Ayrıca Three.js, DICOM voxel geometrisi için klinik MPR/volume pipeline'ının yerine geçmez.

### Önerilen entegrasyon sırası

1. Sentetik CT ve MR serileri üzerinde Cornerstone3D + Vite teknik prototipi; mevcut arayüz kabuğu ve GitHub Pages `/AtikViewer/` alt yolu korunur.
2. CR/DX ve MG gibi projeksiyon görüntülerini, US cine/frame akışlarını ve PT/NM/XA/RF gibi özel iş akışlarını ayrı sentetik testlerle eklemek. Bir codec başarısızsa açık hata/uyarı gösterilir.
3. DICOM dosyaları ve metadata için dcmjs/pydicom kullanımını sınamak; gerçek hasta dosyalarını test fixture'ı veya Git deposu olarak kullanmamak.
4. Her klinik görev için uzman tarafından belirlenen hedef, etiket, doğrulama ölçütü ve lisanslı model olmadan inference kodu veya ağırlık eklememek.
5. Seçilen görev için MONAI/PyTorch ya da doğrulanmış ONNX runtime arasında donanım ölçümlü kıyas yapmak. GPU'ya göre CUDA/diğer sağlayıcı yüklenir; CPU modu yalnızca performans uygunsa sunulur.
6. Kimlik doğrulama, yetkilendirme, audit trail, veri saklama/silme, tehdit modeli ve mevzuat değerlendirmeleri tamamlanmadan klinik ağa açmamak.

## Bu depodaki bilgisayar kurulumu

- **Windows:** `BASLAT.bat` Node.js 18+ sürümünü kontrol eder, gerekirse `npm ci` çalıştırır ve sunucuyu `127.0.0.1:3000` üzerinde başlatır.
- **Linux/macOS:** `BASLAT.sh` aynı yerel arayüz/proxy başlangıcını sağlar.
- **GitHub Pages:** kurulum gerektirmeyen statik arayüz/kılavuz; PACS ve AI API'si sunmaz.
- **AI ortamı:** henüz kurulmuyor. Görev, Python/PyTorch-CUDA uyumluluğu, model ağırlığı lisansı ve disk/VRAM ihtiyacı belirlenmeden büyük paket/model indirmek bilgisayarı gereksiz doldurur ve yanlış kurulum riski taşır. Model dosyaları Git'e eklenmemeli; checksum ve lisansla ayrı yerel indirme adımı olmalıdır.

## Doğrulama kapıları

- Her modality ve transfer syntax için gerçek veya sentetik test fixture'ı; hasta kimliği bulunmayan test verisi.
- Pixel spacing, orientation, frame, rescale slope/intercept ve görüntü sırası için doğruluk testleri.
- Desteklenmeyen/bozuk girdide fail-closed davranışı; tanı önerisi üretmek yerine açıkça durma.
- Model başına bağımsız klinik değerlendirme, domain shift/alt grup analizi ve performans hedefi.
- AI önerilerinde model/weights sürümü, işlem zamanı, kaynak frame/slice, uyarı ve insan inceleme durumu.
- GitHub Pages'e DICOM, PACS kimlik bilgisi, model ağırlığı veya vaka çıktısı gönderilmediğini doğrulayan testler.

> Bu yol haritası bir klinik doğrulama veya mevzuat onayı değildir. “Tüm radyoloji” hedefi, yalnızca tek bir yazılım sürümüyle veya tek bir modelle tamamlanmış sayılamaz.
