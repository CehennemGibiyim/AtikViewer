export type GapStatus = "var" | "kismi" | "yok";
export type GapPriority = "P0" | "P1" | "P2" | "P3";
export type GapEffort = "S" | "M" | "L";
export type CategoryId = "format" | "viewing" | "measure" | "ai" | "report" | "workflow" | "trust";
export type CompetitorType = "viewer" | "ai" | "report";

export interface GapCategory {
  id: CategoryId;
  title: string;
  icon: string;
  blurb: string;
}

export interface GapItem {
  id: string;
  category: CategoryId;
  title: string;
  status: GapStatus;
  priority: GapPriority;
  effort: GapEffort;
  /** Bu özelliği sunduğu bilinen piyasa ürünleri */
  market: string[];
  /** Bizde şu an ne var (dürüst durum) */
  ours: string;
  /** Kapatmak için önerilen aksiyon */
  action: string;
}

export interface Competitor {
  name: string;
  type: CompetitorType;
  focus: string;
  strengths: string[];
  learn: string;
}

export interface RoadmapPhase {
  id: string;
  title: string;
  timeframe: string;
  goal: string;
  itemIds: string[];
}

export const CATEGORIES: GapCategory[] = [
  { id: "format", title: "Format & Veri Okuma", icon: "🗂", blurb: "Gerçek hastane verisini hatasız açabilmek" },
  { id: "viewing", title: "Görüntüleme & Navigasyon", icon: "🖥", blurb: "RadiAnt / OHIF / Weasis düzeyinde okuma konforu" },
  { id: "measure", title: "Ölçüm & Anotasyon", icon: "📐", blurb: "Ölçümlerin doğruluğu ve kalıcılığı" },
  { id: "ai", title: "Yapay Zeka Yetenekleri", icon: "🤖", blurb: "Aidoc / Viz.ai / Lunit / Annalise düzeyinde AI iş akışı" },
  { id: "report", title: "Raporlama & Onay", icon: "📝", blurb: "PowerScribe / Rad AI düzeyinde rapor üretimi" },
  { id: "workflow", title: "İş Akışı & Entegrasyon", icon: "🔗", blurb: "PACS, çalışma listesi, kullanıcılar, denetim" },
  { id: "trust", title: "Güvenlik, Uyum & Güven", icon: "🛡", blurb: "Klinik kullanıma giden yolun şartları" },
];

const BASE_ITEMS: GapItem[] = [
  // ───────── FORMAT ─────────
  {
    id: "f-codec", category: "format", title: "Sıkıştırılmış DICOM (JPEG, JPEG-LS, JPEG 2000, RLE)",
    status: "yok", priority: "P0", effort: "M",
    market: ["RadiAnt", "OHIF", "Weasis", "Horos", "3D Slicer"],
    ours: "Algılanıyor ve kullanıcıya açık uyarı veriliyor; ancak piksel verisi çözülemiyor. Gerçek hastane CD/PACS çıktılarının önemli bir kısmı sıkıştırılmış olabilir.",
    action: "WASM codec'leri (OpenJPEG, CharLS, libjpeg-turbo) ekle; Cornerstone dicom-image-loader veya eşdeğeri.",
  },
  {
    id: "f-uncompressed", category: "format", title: "Sıkıştırılmamış DICOM (Implicit/Explicit Little Endian)",
    status: "var", priority: "P3", effort: "S",
    market: ["RadiAnt", "OHIF", "Weasis", "Horos"],
    ours: "dicom-parser ile okunuyor; bit maskeleme (Bits Stored), işaretli/işaretsiz 16-bit, Rescale Slope/Intercept uygulanıyor.",
    action: "Big Endian ve Deflated için ek destek (düşük öncelik).",
  },
  {
    id: "f-pixel", category: "format", title: "Fotometrik yorum: MONOCHROME1/2, RGB, multi-frame",
    status: "kismi", priority: "P2", effort: "S",
    market: ["RadiAnt", "OHIF", "Weasis"],
    ours: "MONOCHROME1 artık ters çevriliyor, planar RGB ve multi-frame destekleniyor. Renkli görüntüler gri tona çevriliyor (renk kaybı); PALETTE COLOR yok.",
    action: "Renkli (US/3D) görüntüler için RGBA render yolu; palet tablosu desteği.",
  },
  {
    id: "f-series", category: "format", title: "Seri gruplama + anatomik kesit sıralama",
    status: "var", priority: "P3", effort: "S",
    market: ["RadiAnt", "OHIF", "Weasis", "Horos"],
    ours: "SeriesInstanceUID ile gruplama; ImagePositionPatient/ImageOrientation izdüşümüyle sıralama (yoksa InstanceNumber).",
    action: "Kesit aralığı (spacing) hesabı ve eksik/çift kesit uyarısı.",
  },
  {
    id: "f-open", category: "format", title: "Klasör / ZIP / çoklu dosya / sürükle-bırak / uzantısız dosyalar",
    status: "var", priority: "P3", effort: "S",
    market: ["RadiAnt", "Weasis", "Horos"],
    ours: "Klasör (alt dizinler dahil), ZIP, sürükle-bırak, her uzantı ve başlıksız ham DICOM deneniyor. DICOMDIR okunmuyor (dosyalar zaten taranıyor).",
    action: "Şifreli ZIP ve DICOMDIR tabanlı ağaç görünümü.",
  },
  {
    id: "f-objects", category: "format", title: "DICOM SR, PDF, video, ECG, Presentation State, overlay",
    status: "yok", priority: "P2", effort: "M",
    market: ["RadiAnt", "Weasis", "MedDream", "OHIF"],
    ours: "Piksel verisi olmayan nesneler atlanıyor ve kullanıcıya bildiriliyor; içerikleri gösterilmiyor.",
    action: "SR/PR ayrıştırıcıları, kapsüllenmiş PDF ve MPEG oynatıcı.",
  },

  // ───────── VIEWING ─────────
  {
    id: "v-wl", category: "viewing", title: "WL/WW, hazır ve özel pencere presetleri, negatif mod",
    status: "var", priority: "P3", effort: "S",
    market: ["RadiAnt", "OHIF", "Weasis", "Horos"],
    ours: "Sürükleyerek WL/WW, BT presetleri, kullanıcı preset kaydı, invert.",
    action: "Preset kalıcılığı (veritabanı/localStorage) ve PET SUV penceresi.",
  },
  {
    id: "v-geo", category: "viewing", title: "Zoom, pan, döndür, çevir (flip), cine",
    status: "var", priority: "P3", effort: "S",
    market: ["RadiAnt", "OHIF", "Weasis", "Horos"],
    ours: "Hepsi var; kısayollar R/H/V. Cine kare hızı ayarı yok.",
    action: "Cine FPS kaydırıcısı, özelleştirilebilir kısayollar.",
  },
  {
    id: "v-pins", category: "viewing", title: "Kesit zaman çizelgesinde bulgu işaretleri ve kesite atlama",
    status: "var", priority: "P3", effort: "S",
    market: ["Aidoc", "Annalise"],
    ours: "Kesit numaralı bulgu kartları, timeline pinleri, K12 gibi kısayollar — güçlü yanımız.",
    action: "Gerçek model çıktısına bağlanınca değer kazanır (bkz. Yapay Zeka).",
  },
  {
    id: "v-compare", category: "viewing", title: "Seri karşılaştırma + konuma göre otomatik senkronizasyon",
    status: "kismi", priority: "P1", effort: "M",
    market: ["RadiAnt", "OHIF", "Weasis"],
    ours: "İki seri yan yana; senkronizasyon kesit numarasına göre — anatomik konuma göre değil. Farklı kalınlıkta seriler hizalanmaz.",
    action: "ImagePositionPatient tabanlı z-senkronu; önceki tetkik seçimi.",
  },
  {
    id: "v-hanging", category: "viewing", title: "Layout / Hanging Protocol (1×2, 2×2, modaliteye göre otomatik düzen)",
    status: "yok", priority: "P1", effort: "M",
    market: ["OHIF", "Weasis", "MedDream", "RadiAnt"],
    ours: "Sabit tek/çift panel.",
    action: "Viewport ızgara yöneticisi + kural tabanlı protokoller (BT beyin, akciğer grafisi, MR sekans seti).",
  },
  {
    id: "v-mpr", category: "viewing", title: "MPR (axial / coronal / sagittal) ve oblik MPR",
    status: "yok", priority: "P1", effort: "L",
    market: ["RadiAnt", "OHIF", "Weasis", "Horos", "3D Slicer"],
    ours: "Yok. Yalnızca çekim düzleminde gezilebiliyor.",
    action: "Hacmi 3D Float32/Int16 olarak birleştir; GPU (WebGL) veya worker tabanlı yeniden kesit.",
  },
  {
    id: "v-xref", category: "viewing", title: "Cross-reference / localizer çizgileri, 3D imleç",
    status: "yok", priority: "P1", effort: "M",
    market: ["RadiAnt", "Weasis", "OHIF", "MedDream"],
    ours: "Yok.",
    action: "Düzlem kesişim çizgileri ve eş zamanlı imleç (MPR ile birlikte).",
  },
  {
    id: "v-mip", category: "viewing", title: "MIP / MinIP / Avg kalın kesit (slab)",
    status: "yok", priority: "P1", effort: "M",
    market: ["RadiAnt", "Weasis", "Horos", "OHIF"],
    ours: "Yok.",
    action: "Slab kalınlığı kaydırıcısı + max/min/ortalama projeksiyon.",
  },
  {
    id: "v-vr", category: "viewing", title: "3D hacim görüntüleme (VR), STL dışa aktarma",
    status: "yok", priority: "P2", effort: "L",
    market: ["RadiAnt", "Horos", "Weasis", "3D Slicer"],
    ours: "Yok.",
    action: "WebGL2 ray-casting VR + hazır transfer fonksiyonları.",
  },
  {
    id: "v-fusion", category: "viewing", title: "Füzyon (PET-CT, MR/MR) ve TIC eğrileri",
    status: "yok", priority: "P3", effort: "L",
    market: ["RadiAnt", "Horos", "MedDream", "Weasis"],
    ours: "Yok.",
    action: "Kayıt (registration) + alfa karışımı; SUV hesabı.",
  },
  {
    id: "v-perf", category: "viewing", title: "Büyük çalışmalarda performans (GPU, kademeli yükleme, Web Worker)",
    status: "kismi", priority: "P1", effort: "M",
    market: ["RadiAnt", "OHIF", "Weasis"],
    ours: "CPU canvas ile LUT; her kesit Float32 olarak bellekte (512×512 → ~1 MB/kesit). 1000+ kesitlik BT'de bellek ve akıcılık sorunu beklenir.",
    action: "Int16 saklama, WebGL doku, OffscreenCanvas/worker ve kademeli kesit yükleme.",
  },
  {
    id: "v-multimon", category: "viewing", title: "Tam ekran, çoklu monitör, dokunmatik jestler",
    status: "yok", priority: "P3", effort: "S",
    market: ["RadiAnt", "MedDream"],
    ours: "Yok (pointer olayları var ama çoklu dokunuş yok).",
    action: "Fullscreen API, pencere ayırma, pinch-zoom/iki parmak kaydırma.",
  },

  // ───────── MEASURE ─────────
  {
    id: "m-basic", category: "measure", title: "Uzunluk, açı, dikdörtgen ROI (ort/SS/min/max), ok notu",
    status: "var", priority: "P3", effort: "S",
    market: ["RadiAnt", "OHIF", "Weasis", "Horos"],
    ours: "Hepsi var; ROI istatistikleri AI isteğine ROI odağı olarak gönderiliyor.",
    action: "ROI ve açı için sürüklenebilir düzenleme.",
  },
  {
    id: "m-shapes", category: "measure", title: "Elips / çokgen ROI, Cobb açısı, deviation, hacim hesabı",
    status: "yok", priority: "P1", effort: "M",
    market: ["RadiAnt", "Weasis", "OHIF"],
    ours: "Yok.",
    action: "Elips ve çokgen araçları (alan, çevre, ort/min/max), elipsoid hacim.",
  },
  {
    id: "m-calib", category: "measure", title: "Manuel kalibrasyon ve SUV (PET)",
    status: "kismi", priority: "P2", effort: "S",
    market: ["RadiAnt", "Weasis"],
    ours: "Pixel Spacing'e göre mm; HU gösteriliyor. Kalibrasyon ve SUV yok.",
    action: "Kalibrasyon çizgisi ve SUVbw dönüşümü.",
  },
  {
    id: "m-persist", category: "measure", title: "Ölçüm/anotasyon kalıcılığı ve rapora otomatik aktarım",
    status: "yok", priority: "P1", effort: "S",
    market: ["Weasis", "OHIF", "MedDream"],
    ours: "Ölçümler yalnızca tarayıcı belleğinde; sayfa yenilenince kaybolur ve rapora yazılmaz.",
    action: "Ölçümleri veritabanına kaydet; rapor 'Ölçümler' bölümü; DICOM SR/PR dışa aktarımı.",
  },
  {
    id: "m-key", category: "measure", title: "Anahtar kesit (key image) seçimi, rapora çoklu görsel",
    status: "yok", priority: "P1", effort: "S",
    market: ["Weasis", "MedDream"],
    ours: "Rapora yalnızca o anki tek kesit ekleniyor.",
    action: "Kesit yıldızlama, rapora 2–4 görsel ızgarası, DICOM KO dışa aktarma.",
  },
  {
    id: "m-seg", category: "measure", title: "Segmentasyon maskesi ve hacim ölçümü",
    status: "yok", priority: "P2", effort: "M",
    market: ["3D Slicer", "OHIF"],
    ours: "Yok.",
    action: "Fırça/eşik/SAM tabanlı maske, hacim (mL) hesabı.",
  },

  // ───────── AI ─────────
  {
    id: "a-model", category: "ai", title: "Gerçek klinik AI modeli çıkarımı (ONNX / MONAI / TorchXRayVision)",
    status: "yok", priority: "P0", effort: "L",
    market: ["Aidoc", "Viz.ai", "Lunit", "Annalise", "Gleamer"],
    ours: "Bulgular örnek vakalara önceden tanımlı SİMÜLASYON. Yüklenen gerçek DICOM için bulgu üretilmiyor (artık 'normal' denmiyor, 'model bağlı değil' deniyor).",
    action: "İlk gerçek modül: akciğer grafisi sınıflandırma (ONNX Runtime Web veya sunucu); sonra BT beyin kanama.",
  },
  {
    id: "a-loc", category: "ai", title: "Lezyon yerelleştirme: kutu + kesit aralığı + boyut/dansite",
    status: "kismi", priority: "P1", effort: "M",
    market: ["Aidoc", "Lunit", "Annalise", "Gleamer"],
    ours: "Arayüz ve veri modeli hazır (kesit no, aralık, z, dansite, boyut); fakat yalnızca simüle örneklerde dolu.",
    action: "Model çıktısını (bbox/maske) aynı Finding yapısına eşle.",
  },
  {
    id: "a-heat", category: "ai", title: "Isı haritası / segmentasyon örtüsü (Grad-CAM, U-Net)",
    status: "yok", priority: "P1", effort: "M",
    market: ["Lunit", "Annalise", "Gleamer"],
    ours: "Yok.",
    action: "Model çıktısından yarı saydam örtü katmanı ve opaklık kaydırıcısı.",
  },
  {
    id: "a-triage", category: "ai", title: "Triyaj skoru + çalışma listesinin yeniden önceliklendirilmesi",
    status: "kismi", priority: "P1", effort: "M",
    market: ["Aidoc", "Viz.ai", "Annalise"],
    ours: "Triyaj seviyesi/skoru hesaplanıyor; ancak çalışma listesi olmadığı için sıralamaya yansımıyor.",
    action: "Çalışma listesi + triyaj skoruna göre otomatik sıralama ve kırmızı bayrak.",
  },
  {
    id: "a-notify", category: "ai", title: "Kritik bulgu bildirimi (mobil push, e-posta, SMS, çağrı)",
    status: "yok", priority: "P1", effort: "M",
    market: ["Viz.ai", "Aidoc"],
    ours: "Yalnızca ekranda uyarı.",
    action: "Bildirim servisi + alındı/okundu kaydı (denetim izine bağlı).",
  },
  {
    id: "a-prior", category: "ai", title: "Önceki tetkikle karşılaştırma / interval değişim",
    status: "yok", priority: "P1", effort: "L",
    market: ["Aidoc", "Rad AI"],
    ours: "Hasta geçmişi ve önceki tetkik bağlantısı yok.",
    action: "Hasta bazlı çalışma geçmişi, kayıt ve değişim özeti.",
  },
  {
    id: "a-track", category: "ai", title: "Nodül/lezyon takibi (Lung-RADS, RECIST, boyut değişimi)",
    status: "yok", priority: "P2", effort: "L",
    market: ["Lunit"],
    ours: "Yok.",
    action: "Lezyon kimliği, zaman serisi grafiği, kılavuz tabanlı öneri.",
  },
  {
    id: "a-quant", category: "ai", title: "Nicel biyobelirteçler (hacim, kalsiyum skoru, kemik yoğunluğu)",
    status: "yok", priority: "P2", effort: "L",
    market: ["3D Slicer", "Aidoc"],
    ours: "Yok.",
    action: "Hacim ve yoğunluk modülleri; insidental bulgu listesi.",
  },
  {
    id: "a-feedback", category: "ai", title: "Hekim geri bildirim döngüsü ve AI performans panosu",
    status: "kismi", priority: "P1", effort: "S",
    market: ["Aidoc", "Annalise"],
    ours: "Bulgu bazlı onay/red/düzenleme kaydediliyor; FP/FN istatistiği ve model değerlendirmesi yok.",
    action: "Onay/red verisinden duyarlılık/özgüllük panosu; yanlış pozitif listesi.",
  },
  {
    id: "a-card", category: "ai", title: "Model kartı: sürüm, endikasyon, duyarlılık/özgüllük, doğrulama verisi",
    status: "yok", priority: "P0", effort: "S",
    market: ["Aidoc", "Viz.ai", "Lunit", "Annalise", "Gleamer"],
    ours: "Yok. Raporda yalnızca model adı yazıyor ve o da demo.",
    action: "Her rapora model sürümü, amaçlanan kullanım ve bilinen sınırlar eklensin.",
  },
  {
    id: "a-vlm", category: "ai", title: "Çok kipli model: görüntü + klinik not (VLM/LLM)",
    status: "kismi", priority: "P2", effort: "M",
    market: ["Annalise", "Rad AI"],
    ours: "Klinik not alanı var; yalnızca hasta özeti metnine ekleniyor, çıkarıma girmiyor.",
    action: "Klinik soruyu modele bağlama; sorumlu kullanım için hekim onayı zorunlu kalmalı.",
  },
  {
    id: "a-uncert", category: "ai", title: "Belirsizlik göstergesi ve kalibre güven skoru",
    status: "kismi", priority: "P1", effort: "S",
    market: ["Lunit", "Annalise"],
    ours: "Yüzde güven gösteriliyor; kalibre edilmemiş ve belirsizlik/'emin değilim' durumu yok.",
    action: "Kalibrasyon eğrisi, eşik ayarı, düşük güvende 'hekim incelesin' etiketi.",
  },

  // ───────── REPORT ─────────
  {
    id: "r-struct", category: "report", title: "Yapısal rapor, A4 çıktı, filigran, anahtar kesit görseli",
    status: "var", priority: "P3", effort: "S",
    market: ["PowerScribe", "Rad AI"],
    ours: "Teknik / Bulgular / Sonuç / Öneri; onaysız taslak filigranı; tek anahtar kesit.",
    action: "Çoklu anahtar kesit ve ölçüm tablosu (bkz. Ölçüm).",
  },
  {
    id: "r-review", category: "report", title: "Bulgu bazlı hekim doğrulaması (zorunlu gözden geçirme)",
    status: "var", priority: "P1", effort: "S",
    market: ["Aidoc", "Gleamer"],
    ours: "AI bulguları artık 'Onay Bekliyor' gelir; bekleyen bulgu varken rapor onaylanamaz.",
    action: "Red/düzenleme gerekçesi alanı.",
  },
  {
    id: "r-template", category: "report", title: "Şablon kütüphanesi (modalite/bölge/endikasyon), makro ve seçim listeleri",
    status: "yok", priority: "P1", effort: "M",
    market: ["PowerScribe", "Rad AI", "RadPal"],
    ours: "Tek sabit şablon.",
    action: "Veritabanında şablon yönetimi; RSNA RadReport şablonlarıyla uyum.",
  },
  {
    id: "r-dictate", category: "report", title: "Sesle dikte (Türkçe) ve sesli komutlar",
    status: "yok", priority: "P1", effort: "M",
    market: ["PowerScribe", "Rad AI", "RadPal"],
    ours: "Yok.",
    action: "Web Speech API ile başlangıç; tıbbi sözlük için sunucu tarafı konuşma tanıma.",
  },
  {
    id: "r-genai", category: "report", title: "Üretken yapay zeka ile izlenim/rapor taslağı ve hekim üslubuna uyum",
    status: "kismi", priority: "P1", effort: "M",
    market: ["Rad AI", "RadPal", "Annalise"],
    ours: "Kural tabanlı metin üretimi; LLM yok, hekim üslubu öğrenilmiyor.",
    action: "LLM ile bulgu→izlenim; çıktının yalnızca doğrulanmış bulgulara dayanmasını zorunlu kıl.",
  },
  {
    id: "r-version", category: "report", title: "Rapor sürümleme, değişiklik geçmişi, addendum",
    status: "yok", priority: "P0", effort: "M",
    market: ["PowerScribe", "Rad AI"],
    ours: "Rapor üzerine yazılıyor; 'Onayı Geri Al' yalnızca ekranda ve kayıtlı raporu değiştirmiyor.",
    action: "Değiştirilemez sürüm tablosu, addendum akışı, onay sonrası kilit.",
  },
  {
    id: "r-esign", category: "report", title: "Kimlik doğrulamalı e-imza (NES / mobil imza / e-Devlet)",
    status: "yok", priority: "P0", effort: "L",
    market: ["PowerScribe"],
    ours: "PIN alanı SİMÜLASYON: doğrulanmıyor; hekim adı/sicil sabit varsayılan.",
    action: "Kullanıcı kimliğinden gelen hekim bilgisi + gerçek imza sağlayıcı entegrasyonu.",
  },
  {
    id: "r-export", category: "report", title: "Standart çıktı: DICOM SR / PDF, HL7 FHIR DiagnosticReport, RSNA CDE",
    status: "yok", priority: "P1", effort: "M",
    market: ["PowerScribe", "Weasis"],
    ours: "Tarayıcı yazdır/PDF; makine okunur standart çıktı yok.",
    action: "FHIR DiagnosticReport + ImagingStudy dışa aktarma, SR üretimi.",
  },
  {
    id: "r-patient", category: "report", title: "Hasta dostu özet",
    status: "var", priority: "P3", effort: "S",
    market: ["Rad AI"],
    ours: "Hasta Özeti modu var (Türkçe).",
    action: "Okuma düzeyi ayarı ve çok dilli çıktı.",
  },
  {
    id: "r-link", category: "report", title: "Rapor–görüntü bağlama (cümleye tıkla → kesite git)",
    status: "kismi", priority: "P2", effort: "S",
    market: ["PowerScribe", "OHIF"],
    ours: "Bulgu kartından kesite gidiliyor; rapor metni içindeki cümleler bağlı değil.",
    action: "Rapor cümlelerine bulgu kimliği iliştir; tıklayınca kesit ve kutu vurgulansın.",
  },

  // ───────── WORKFLOW ─────────
  {
    id: "w-pacs", category: "workflow", title: "PACS / DICOMweb bağlantısı (QIDO-RS, WADO-RS, STOW-RS, C-FIND/C-MOVE)",
    status: "yok", priority: "P1", effort: "L",
    market: ["OHIF", "Weasis", "RadiAnt", "Horos", "Aidoc"],
    ours: "Yok; yalnızca yerel dosya/klasör açma.",
    action: "Orthanc/dcm4chee ile DICOMweb istemcisi; ardından C-FIND/C-MOVE.",
  },
  {
    id: "w-worklist", category: "workflow", title: "Çalışma listesi: hasta/tetkik, durum, atama, öncelik",
    status: "kismi", priority: "P1", effort: "M",
    market: ["Aidoc", "OHIF", "MedDream"],
    ours: "Yalnızca kayıtlı raporlar listeleniyor (Geçmiş). Okunmayı bekleyen tetkik kuyruğu yok.",
    action: "Tetkik tablosu: durum (bekliyor/okunuyor/taslak/onaylı), atama, triyaj sıralaması.",
  },
  {
    id: "w-auth", category: "workflow", title: "Kullanıcı girişi ve roller (Yönetici / Radyolog / Teknisyen)",
    status: "yok", priority: "P0", effort: "M",
    market: ["Aidoc", "Viz.ai", "PowerScribe", "MedDream"],
    ours: "Yok; herkes her şeyi yapabilir. İlk Lovable taslağındaki giriş ve Kullanıcılar ekranı bu sürümde yok.",
    action: "Oturum yönetimi, rol tabanlı yetki, hekim profili (ad, unvan, sicil).",
  },
  {
    id: "w-audit", category: "workflow", title: "Denetim kaydı (audit trail): kim, ne zaman, hangi tetkik/rapor",
    status: "yok", priority: "P0", effort: "M",
    market: ["Aidoc", "Viz.ai", "PowerScribe"],
    ours: "Yok. İlk Lovable taslağında 'Denetim' sekmesi vardı.",
    action: "Değiştirilemez olay tablosu: açma, analiz, onay, yazdırma, dışa aktarma, bildirim.",
  },
  {
    id: "w-his", category: "workflow", title: "HIS/RIS entegrasyonu (HL7 v2, Modality Worklist, FHIR)",
    status: "yok", priority: "P2", effort: "L",
    market: ["Aidoc", "PowerScribe", "MedDream"],
    ours: "Yok.",
    action: "HL7/FHIR alıcı; hasta ve istem bilgisini otomatik doldur.",
  },
  {
    id: "w-storage", category: "workflow", title: "Kalıcı görüntü depolama ve çok kullanıcılı erişim",
    status: "yok", priority: "P1", effort: "L",
    market: ["OHIF", "Weasis", "Horos"],
    ours: "Görüntüler yalnızca tarayıcı belleğinde; sayfa yenilenince kaybolur. Veritabanında sadece rapor metni ve anahtar kesit var.",
    action: "Orthanc veya nesne depolama; yetkilendirilmiş akış (stream).",
  },
  {
    id: "w-deid", category: "workflow", title: "Anonimleştirme (DICOM de-identification) ve etiket düzenleme",
    status: "yok", priority: "P1", effort: "S",
    market: ["RadiAnt", "Weasis"],
    ours: "Yok. Hasta adı ve kimliği düz metin olarak veritabanına yazılıyor.",
    action: "Profil tabanlı etiket temizleme; araştırma/paylaşım için anonim dışa aktarma.",
  },
  {
    id: "w-export", category: "workflow", title: "Dışa aktarma: JPEG/PNG, video, DICOM, CD/paylaşım bağlantısı",
    status: "kismi", priority: "P2", effort: "S",
    market: ["RadiAnt", "Weasis", "Horos"],
    ours: "Rapor PDF/yazdır var; görüntü, video veya DICOM dışa aktarma yok.",
    action: "Kesit PNG, cine MP4/GIF, anotasyonlu görüntü; süreli paylaşım bağlantısı.",
  },

  // ───────── TRUST ─────────
  {
    id: "t-disclaimer", category: "trust", title: "Her ekranda net 'demo / klinik karar için kullanılamaz' uyarısı",
    status: "var", priority: "P0", effort: "S",
    market: ["Aidoc", "Viz.ai", "Lunit"],
    ours: "Üst çubukta, durum çubuğunda ve AI sonuç panelinde uyarı; rapor çıktısında da var.",
    action: "Amaçlanan kullanım (intended use) metni ve sürüm bilgisi.",
  },
  {
    id: "t-mdr", category: "trust", title: "Tıbbi cihaz yazılımı uyumu (CE-MDR/TİTCK, FDA 510(k), ISO 13485, IEC 62304)",
    status: "yok", priority: "P0", effort: "L",
    market: ["Aidoc", "Viz.ai", "Lunit", "Annalise", "Gleamer"],
    ours: "Yok. Bulgu gösteren yapay zeka yazılımı genellikle düzenlemeye tabi tıbbi cihaz yazılımı kapsamına girer.",
    action: "Amaçlanan kullanım tanımı, risk yönetimi (ISO 14971), klinik değerlendirme planı; hukuki danışmanlık.",
  },
  {
    id: "t-privacy", category: "trust", title: "KVKK/HIPAA: şifreleme, erişim kontrolü, saklama politikası",
    status: "yok", priority: "P0", effort: "M",
    market: ["Aidoc", "Viz.ai", "RadPal"],
    ours: "Hasta verisi ve anahtar kesitler düz metin; kimlik doğrulama yok; saklama/silme politikası yok.",
    action: "TLS, alan düzeyi şifreleme, rol tabanlı erişim, silme/saklama süreleri, açık rıza ve aydınlatma metni.",
  },
  {
    id: "t-validation", category: "trust", title: "Klinik doğrulama, gölge mod (shadow mode) ve performans/yanlılık izleme",
    status: "yok", priority: "P1", effort: "L",
    market: ["Aidoc", "Viz.ai", "Lunit"],
    ours: "Yok. Henüz doğrulanacak gerçek bir model de yok.",
    action: "Kendi verinizde duyarlılık/özgüllük ölçümü, 500–1000 vakalık gölge okuma, sürüm bazlı izleme.",
  },
  {
    id: "t-automation", category: "trust", title: "Otomasyon yanlılığına karşı tasarım (AI bulgusu ön onaylı gösterilmez)",
    status: "var", priority: "P1", effort: "S",
    market: ["Gleamer", "Aidoc"],
    ours: "Bulgular 'Onay Bekliyor' gelir; hekim her bulguyu onaylar/reddeder; simülasyon ve 'model yok' durumu açıkça etiketlenir.",
    action: "Hekim kararlarının AI önerisinden ayrı kaydı ve uyuşmazlık raporu.",
  },
];

type Patch = Partial<Pick<GapItem, "status" | "ours" | "action" | "priority">>;
/** Son güncelleme: yapılanlar gerçek testlerle doğrulandı; "kismi" olanların sınırı `ours` alanında yazılı. */
const PATCHES: Record<string, Patch> = {
  "f-codec": { status: "var", priority: "P2", ours: "RLE, JPEG 2000, HTJ2K, JPEG-LS, JPEG Lossless, JPEG Baseline, 12-bit JPEG Extended, Deflated ve Big Endian okunuyor; her biri gerçek dosyayla (pydicom/DCMTK referansı) doğrulandı. 12-bit JPEG için alınan çözücüdeki +15 seviye kayması hatası düzeltildi. MPEG video ve JPEG-XL görüntü olarak çözülmüyor; rapor ekranında açıkça bildiriliyor.", action: "MPEG/JPEG-XL desteği; gerçek PACS verisiyle geniş kapsamlı test." },
  "f-uncompressed": { status: "var", ours: "Implicit/Explicit LE ve Explicit BE okunuyor ve doğrulandı; bit maskeleme, işaretli/işaretsiz, Rescale uygulanıyor." },
  "f-pixel": { status: "var", ours: "MONOCHROME1 ve MONOCHROME2 tam desteklenir; True Color RGB, YBR_FULL ve PALETTE COLOR (kırmızı/yeşil/mavi LUT tablosuyla renkli eşleme) doğrudan 32-bit RGBA tamponunda çizilir. Çok kareli renkli Doppler ve sine serileri desteklenir." },
  "f-open": { status: "var", ours: "Klasör (alt dizinler), ZIP, sürükle-bırak, her uzantı, başlıksız ham DICOM, sunucu depolaması ve PACS (DICOMweb) ile açılır." },
  "f-objects": { status: "var", priority: "P2", ours: "DICOM Yapısal Raporlar (SR - TID ağaç yapısı ve ölçümler), Encapsulated PDF (belge görüntüleyici ve indirme), 12-Derivasyonlu EKG dalga formu (kalibre pembe kağıt ve kaliper ölçüm aracı), DICOM Katmanları (6000-601e) ve GSPS Presentation State anotasyonları tam desteklenir." },
  "v-geo": { ours: "Zoom, pan, döndür, çevir, cine (kare hızı ayarlı), tam ekran; kısayollar R/H/V/K." },
  "v-compare": { status: "var", ours: "Çok panelde seri karşılaştırma; ImagePositionPatient'a göre anatomik konum senkronu (konum yoksa oransal yedek); önceki çalışma sunucudan yan panelde açılır." },
  "v-hanging": { status: "var", priority: "P1", ours: "1×1, 1×2, 2×1, 2×2, 1×3, 3×1, 2×3, 3×2 düzenler + modalite/bölgeye göre otomatik sistem protokolleri + görsel Kullanıcı Tanımlı Asma Protokolü Editörü (oluşturma, düzenleme, silme, JSON içe/dışa aktarma ve tek tıkla uygulama) tam çalışır durumda." },
  "v-mpr": { status: "kismi", ours: "Ortogonal MPR (axial/koronal/sagittal) çalışıyor ve tarayıcıda denendi. Eğik (oblik) MPR yok; yönelim 'kesitler kafaya doğru artan' varsayar.", action: "Oblik MPR, yönelim bilgisinden otomatik yön." },
  "v-xref": { status: "kismi", ours: "MPR içinde çapraz referans çizgileri ve eş zamanlı imleç var. Farklı düzlemli ayrı serilerde (ör. MR sekansları) referans çizgisi yok.", action: "Seriler arası localizer çizgileri." },
  "v-mip": { status: "var", ours: "MPR'de kalın kesit: ortalama / MIP / MinIP (0–40 mm)." },
  "v-perf": { status: "kismi", ours: "Kesitler Int16/Uint16 saklanır (Float32'ye göre yarı bellek), taban/örtü katmanı önbelleği, 32-bit piksel yazımı. 1000+ kesitte ölçülmedi; WebGL/worker yok.", action: "Büyük çalışmalarla ölçüm; WebGL doku, OffscreenCanvas." },
  "v-multimon": { status: "kismi", ours: "Tam ekran var; çoklu monitör penceresi ve dokunmatik jestler yok." },
  "m-shapes": { status: "kismi", priority: "P2", ours: "Elips ve çokgen ROI (alan, çevre, ort/SS/min/maks), dikdörtgen ROI, Cobb açısı var. Deviation ve elipsoid hacim aracı yok.", action: "Deviation, elipsoid hacim." },
  "m-calib": { status: "kismi", ours: "Manuel kalibrasyon (bilinen uzunluk → mm/piksel) var; SUV (PET) yok." },
  "m-persist": { status: "var", ours: "Ölçümler ve anahtar kesitler çalışma+seri bazında sunucuya kaydedilir (autosave), rapora 'ÖLÇÜMLER' olarak girer." },
  "m-key": { status: "kismi", ours: "★ ile anahtar kesit (en fazla 8); rapora ilk 4 görsel eklenir, zaman çizelgesinde işaretlenir. DICOM Key Object dışa aktarımı yok.", action: "DICOM KO/PR dışa aktarma." },
  "m-seg": { status: "kismi", ours: "Motor aday odak maskesini kesit kesit üretir ve örtü olarak gösterir; elle fırça/eşik ile maske çizimi yok. Hacim (mL) motorun adayları için hesaplanır." },
  "a-model": { status: "kismi", priority: "P0", ours: "BT beyin/toraksta kural tabanlı (derin öğrenme DEĞİL, klinik doğrulama YOK) kanama/nodül adayı hesaplanır. Diğer piksel içeren modalitelerde (US, MR, CR/DX, MG, PET/NM, XA vb.) her karede gerçek sinyal, kontrast ve varsa RGB alan ölçümü ile inceleme çizelgesi bulunur; bu bir hastalık dedektörü veya acil klinik triyaj DEĞİLDİR. MR/CR örneklerindeki önceden tanımlı bulgular DEMO etiketlidir.", action: "Modalite/endikasyona özel klinik olarak doğrulanmış modelleri lisanslayıp valide edin; kare istatistiğini tanı olarak yorumlamayın." },
  "a-loc": { status: "var", ours: "Kesit bazlı kutu, kesit aralığı, anahtar kesit, z konumu, ölçülen HU/boyut/hacim — BT'de gerçek hesaplanır; MR/CR demo." },
  "a-heat": { status: "kismi", ours: "Aday maskesi yarı saydam örtü (saydamlık ayarlı). Olasılık ısı haritası (Grad-CAM) yok." },
  "a-triage": { status: "var", ours: "Triyaj skoru hesaplanır, çalışma listesi triyaja göre (en acil üstte) sıralanır ve renk kodlanır." },
  "a-notify": { status: "kismi", ours: "Kritik/yüksek aday bulguda uygulama içi bildirim (zil), webhook ve 'alındı' kaydı (denetim izine yazılır). E-posta/SMS/çağrı cihazı/mobil push sağlayıcısı yok (webhook köprüsüyle bağlanır).", action: "Sağlayıcı entegrasyonları." },
  "a-prior": { status: "kismi", ours: "Hasta bazlı geçmiş çalışmalar ve raporlar; önceki çalışma yan panelde anatomik senkronla açılır; bulgu kartında önceki ölçümle fark gösterilir. Görüntü kaydı (registration) yok." },
  "a-track": { status: "kismi", ours: "Lung-RADS boyut eşiği (solid, başlangıç) ve önceki ölçümle çap/hacim farkı. Lezyon kimliği/zaman serisi grafiği yok." },
  "a-quant": { status: "kismi", ours: "Aday başına hacim (mL/mm³), ortalama/maks HU, çap. Kalsiyum skoru, kemik yoğunluğu, insidental tarama yok." },
  "a-feedback": { status: "var", ours: "Bulgu bazlı onay/red/düzenleme + 'AI'nın kaçırdığı bulgu' girişi; Yönetim → AI performans'ta kesinlik (PPV) tablosu." },
  "a-card": { status: "var", priority: "P1", ours: "Model kartı (amaç, yöntem, sınırlılıklar, doğrulama durumu) panelde ve rapor çıktısında; sürüm bilgisi raporla saklanır." },
  "a-vlm": { status: "kismi", ours: "İsteğe bağlı LLM (OpenAI uyumlu) yalnızca hekimin doğruladığı bulgu metninden taslak izlenim üretir; görüntü modele verilmez. Canlı LLM ile denenmedi (yapılandırma yok → kural tabanlı yedek denendi)." },
  "a-uncert": { status: "kismi", ours: "Skor 'kalibre değil' etiketiyle gösterilir (olasılık gibi sunulmaz). Kalibrasyon eğrisi/belirsizlik tahmini yok." },
  "r-template": { status: "var", ours: "6 hazır şablon, uygula, kendi şablonunu kaydet/sil. RSNA RadReport uyumu yok." },
  "r-dictate": { status: "kismi", ours: "Web Speech API ile Türkçe dikte ve 'nokta/virgül/yeni satır' komutları (Chrome/Edge). Tıbbi sözlük/özel model yok; tarayıcı bağımlı, bu ortamda mikrofonla denenmedi." },
  "r-genai": { status: "kismi", ours: "Taslak izlenim: yalnızca doğrulanmış bulgulardan, hasta kimliği göndermeden; LLM yoksa kural tabanlı. Hekim üslubuna uyum yok." },
  "r-version": { status: "var", priority: "P1", ours: "Her kayıt/onay sürüm olarak saklanır; onay sonrası rapor sunucuda kilitlenir (409); düzeltme addendum ile." },
  "r-esign": { status: "yok", priority: "P0", ours: "Onay artık kimlik doğrulaması YAPMAZ (giriş kaldırıldı): rapora profildeki ad yazılır ve içerik SHA-256 ile mühürlenir. Mühür yalnızca sonradan değişikliği saptar, imza sahibini kanıtlamaz.", action: "NES/mobil imza sağlayıcı entegrasyonu; öncesinde kimlik doğrulama katmanı." },
  "r-export": { status: "kismi", ours: "FHIR R4 DiagnosticReport JSON (sürüm, performer, imaging study, içerik hash'i). DICOM SR yok." },
  "r-link": { status: "var", ours: "Rapor metnindeki ve tablodaki 'Kesit N' bağlantıları görüntüleyicide o kesite götürür." },
  "w-pacs": { status: "kismi", ours: "DICOMweb QIDO-RS/WADO-RS istemcisi: arama, çalışma getirme, multipart çözümü — sahte DICOMweb sunucusuyla doğrulandı. Gerçek bir PACS ile denenmedi; DIMSE (C-FIND/C-MOVE) yok.", action: "Gerçek PACS (Orthanc/dcm4chee) ile entegrasyon testi." },
  "w-worklist": { status: "var", ours: "Çalışma listesi: durum, atama, triyaj sıralaması, arama; yerel/HBYS/PACS kaynaklı." },
  "w-auth": { status: "yok", priority: "P0", ours: "KALDIRILDI (kullanıcı isteği): kullanıcı adı/parola ile giriş, oturum ve roller yok. Uygulamayı açan herkes tam yetkilidir. Yalnızca rapora yazılacak hekim adı/unvan/sicil tutulur; bu kimlik doğrulamaz.", action: "Gerçek hasta verisi için ağ düzeyinde erişim kısıtı (VPN/ters vekil kimlik doğrulama) veya uygulama içi oturumun geri getirilmesi." },
  "w-audit": { status: "kismi", priority: "P1", ours: "Hash zincirli, DB tetikleyicisiyle değiştirilemeyen denetim kaydı çalışıyor (kurcalama testle yakalandı). Ancak giriş kaldırıldığı için tüm işlemler tek bir operatöre atfedilir: kişi bazlı sorumluluk izi yoktur.", action: "Kişi bazlı iz için oturum/kimlik gerekir." },
  "w-his": { status: "kismi", ours: "REST istem alımı (API anahtarlı) + FHIR rapor çıktısı. HL7 v2 (MLLP) alıcısı ve Modality Worklist yok." },
  "w-storage": { status: "var", ours: "Görüntüler sunucuda AES-256-GCM ile şifreli saklanır, tekilleştirilir, çalışma listesinden geri açılır. Tek düğüm dosya sistemi; nesne depolama/yedekleme sizin altyapınızdadır." },
  "w-deid": { status: "var", ours: "Anonim DICOM (ZIP) dışa aktarma: bellekten sıfırdan yazılır (özel etiket/UID/ad/kimlik/tarih/kurum taşınmaz), gerçek dosyayla gidiş-dönüş doğrulandı, denetim kaydı tutulur. Etiket düzenleyici yok." },
  "w-export": { status: "kismi", ours: "PNG ve anonim DICOM (ZIP). Cine video ve süreli paylaşım bağlantısı yok." },
  "t-disclaimer": { ours: "Üst çubuk, durum çubuğu, panel ve rapor çıktısında; model kartı ve DEMO/kural tabanlı etiketleri." },
  "t-mdr": { status: "yok", ours: "Yok ve kodla çözülemez. Yönetim → Uyum sekmesi 12 maddelik takip listesi sunar (yapılmadı/devam/tamam).", action: "Amaçlanan kullanım, sınıflandırma, ISO 13485/62304/14971, klinik değerlendirme; hukuki danışmanlık." },
  "t-privacy": { status: "yok", priority: "P0", ours: "Veriler diskte AES-256-GCM ile şifreli (hasta adı/kimliği, klinik bilgi, anahtar kesit, DICOM dosyaları) ve saklama politikası var. ANCAK erişim denetimi kaldırıldı: adresi bilen herkes tüm hasta verilerini görebilir. Bu hâliyle gerçek hasta verisi için KVKK'ya uygun değildir.", action: "Erişim kısıtı (ağ düzeyinde veya uygulama içi oturum) zorunlu; ayrıca KMS, TLS ve ilgili kişi başvuru süreçleri." },
  "t-validation": { status: "kismi", ours: "Hekim geri bildirimi → PPV panosu, 'kaçırılan bulgu' girişi. Gölge mod iş akışı ve kontrollü klinik doğrulama çalışması yok." },
  "t-automation": { ours: "Bulgular 'Onay bekliyor' gelir; hekim her bulguyu işaretlemeden onay verilemez (sunucuda da zorunlu); skor 'kalibre değil' etiketli; demo/motor yok durumları açık." },
};
export const GAP_ITEMS: GapItem[] = BASE_ITEMS.map((i) => ({ ...i, ...(PATCHES[i.id] ?? {}) }));

export const COMPETITORS: Competitor[] = [
  {
    name: "RadiAnt", type: "viewer", focus: "Windows masaüstü; hız ve sadelik",
    strengths: [
      "Çok hızlı 2D, MPR, 3D VR; MIP/MinIP/Avg kalın kesit",
      "Seri senkronizasyonu, cross-reference çizgileri, 3D imleç",
      "Elips/çokgen/Cobb/deviation ölçümleri, füzyon, TIC, DSA",
      "CD/DVD, klasör, ZIP; JPEG/JPEG2000/JPEG-LS/RLE sıkıştırma çözme",
    ],
    learn: "Hız, ölçüm çeşitliliği ve hasta CD'sinden tek tıkla açma.",
  },
  {
    name: "OHIF", type: "viewer", focus: "Web tabanlı, sıfır kurulum, DICOMweb",
    strengths: [
      "Tarayıcıda çalışır; PACS ile DICOMweb üzerinden konuşur",
      "MPR, hanging protocol, segmentasyon, SR desteği",
      "Eklenti mimarisi; MONAI Label ile AI destekli etiketleme",
    ],
    learn: "Mimari olarak bize en yakın rakip; DICOMweb ve eklenti modeli yol gösterici.",
  },
  {
    name: "Weasis", type: "viewer", focus: "Çapraz platform, PACS entegrasyonlu",
    strengths: [
      "Key Object notları, hanging protocol, SR/ECG/RT desteği",
      "MPR, MIP ve v4 ile 3D hacim görüntüleme",
      "Hastane ve araştırma kullanımı; DICOMweb",
    ],
    learn: "Key image ve yapısal rapor nesneleriyle klinik iş akışı.",
  },
  {
    name: "Horos", type: "viewer", focus: "macOS; OsiriX tabanlı",
    strengths: [
      "MPR, 3D VR, füzyon",
      "Geniş eklenti ekosistemi",
      "OsiriX MD ile FDA/CE onaylı klinik kullanım seçeneği",
    ],
    learn: "Eklenti mimarisi ve klinik onaylı sürüm modeli.",
  },
  {
    name: "3D Slicer", type: "viewer", focus: "Araştırma düzeyi analiz ve segmentasyon",
    strengths: [
      "Segmentasyon, registration, 3D/4D görselleştirme",
      "150+ eklenti; yapay zeka araştırma araçları",
    ],
    learn: "Segmentasyon ve nicel analiz derinliği.",
  },
  {
    name: "MedDream", type: "viewer", focus: "Web radyoloji görüntüleyici",
    strengths: [
      "Hanging protocol, Key Object, Presentation State, CAD işaretleri",
      "PET-CT füzyon, 4D, montaj, panel bölme",
    ],
    learn: "Klinik düzen ve ilişkili tetkik yönetimi.",
  },
  {
    name: "Aidoc", type: "ai", focus: "Akut bakım triyajı ve çok bulgulu BT yapay zekası",
    strengths: [
      "PACS'e DICOM ile entegre; çalışma listesini yeniden önceliklendirir",
      "EHR gelen kutusu, mobil push ve çağrı cihazıyla çok kanallı bildirim",
      "Analitik panoları: bildirim→okuma→tedavi süreleri",
      "Çok sayıda ayrı onaylı modül (üretici/derleme kaynaklarına göre; ICH, PE, C-omurga kırığı, inme)",
    ],
    learn: "Yapay zekayı ayrı bir ekran değil, çalışma listesinin içine gömmek; bildirim ve denetim izi.",
  },
  {
    name: "Viz.ai", type: "ai", focus: "İnme ve nörovasküler/kardiyak ekip koordinasyonu",
    strengths: [
      "Büyük damar tıkanıklığı ve kanama odaklı tespit",
      "Mobil uygulamayla bakım ekibine anında bildirim",
      "Tedavi süresinde ölçülmüş iyileşme (kaynaklarda dakika düzeyinde azalma bildirilir)",
    ],
    learn: "Tespitten sonra iletişim: kim, ne zaman, ne gördü — kayıt altında.",
  },
  {
    name: "Lunit", type: "ai", focus: "Akciğer grafisi ve mamografi yapay zekası",
    strengths: [
      "Isı haritası (heatmap) çıktısı ve REST API",
      "Lezyon olasılık skorları; nodül odaklı BT modülü",
    ],
    learn: "Isı haritası + olasılık skoru ile açıklanabilir sunum.",
  },
  {
    name: "Annalise", type: "ai", focus: "Geniş anatomik kapsam (akciğer grafisi, BT beyin)",
    strengths: [
      "Çok sayıda bulguyu tek geçişte tarama",
      "Rutin PACS iş akışına entegrasyon",
    ],
    learn: "Tek modelle geniş bulgu kapsamı ve bulgu-bazlı sunum.",
  },
  {
    name: "Gleamer", type: "ai", focus: "Travma/MSK ve akciğer grafisi",
    strengths: [
      "Bayraklar PACS içinde görünür; hekim kabul/ret eder",
      "Kırık ve akciğer bulguları için hafif iş akışı",
    ],
    learn: "Hekimin tek tıkla kabul/ret ettiği hafif etkileşim.",
  },
  {
    name: "Rad AI", type: "report", focus: "Üretken yapay zeka ile rapor/izlenim",
    strengths: [
      "Dikte edilen bulgulardan taslak izlenim ve kılavuz önerisi",
      "Hekimin dilini ve üslubunu öğrenir",
      "Değişmeyen kontrollerde yalnızca değişimin dikte edilmesi",
    ],
    learn: "İzlenim taslağı ve kişiselleştirme; takip önerilerinde standartlaşma.",
  },
  {
    name: "PowerScribe", type: "report", focus: "Konuşma tanıma ve yapısal raporlama",
    strengths: [
      "Konuşma tanıma, ortam (ambient) modu",
      "Yapısal veri ve RSNA/ACR ortak veri öğeleri (CDE)",
      "Karar desteği ve takip izleme",
    ],
    learn: "Yapısal veri modeli ve standart terminoloji.",
  },
  {
    name: "RadPal", type: "report", focus: "Dikte tabanlı rapor/izlenim asistanı",
    strengths: [
      "Dikteden yapısal rapor ve izlenim",
      "ACR Appropriateness Criteria sihirbazı",
      "Sıfır veri saklama iddiası",
    ],
    learn: "Hafif, mevcut dikte araçlarına eklenen yardımcı modeli.",
  },
];

const ROADMAP_OLD: RoadmapPhase[] = [
  {
    id: "faz0", title: "Faz 0 — Dürüstlük ve güvenlik zemini", timeframe: "Bu turda yapıldı",
    goal: "Yanıltıcı çıktıları kaldır; okunamayan veriyi sessizce işleme.",
    itemIds: ["t-disclaimer", "t-automation", "r-review", "f-pixel", "f-open", "f-series"],
  },
  {
    id: "faz1", title: "Faz 1 — Gerçek ve güvenli çekirdek", timeframe: "1–3 hafta",
    goal: "Gerçek veriyi aç, kullanıcıyı tanı, her şeyi kaydet.",
    itemIds: ["f-codec", "w-auth", "w-audit", "r-version", "m-persist", "a-card", "w-deid", "t-privacy"],
  },
  {
    id: "faz2", title: "Faz 2 — Workstation çekirdeği", timeframe: "3–6 hafta",
    goal: "RadiAnt/OHIF düzeyinde okuma konforu.",
    itemIds: ["v-mpr", "v-xref", "v-mip", "v-hanging", "v-compare", "m-shapes", "m-key", "v-perf"],
  },
  {
    id: "faz3", title: "Faz 3 — Gerçek yapay zeka", timeframe: "6–12 hafta",
    goal: "Simülasyonu gerçek model çıktısıyla değiştir; hekimi sürece bağla.",
    itemIds: ["a-model", "a-heat", "a-triage", "a-feedback", "a-uncert", "a-notify", "r-template", "r-dictate", "r-genai"],
  },
  {
    id: "faz4", title: "Faz 4 — Entegrasyon ve uyum", timeframe: "3–6 ay",
    goal: "Hastane ortamına ve düzenleyici yola hazırlan.",
    itemIds: ["w-pacs", "w-storage", "w-worklist", "r-esign", "r-export", "a-prior", "t-validation", "t-mdr", "w-his"],
  },
];

export const ROADMAP: RoadmapPhase[] = [
  { id: "done", title: "Bu turda tamamlananlar (test edildi)", timeframe: "Tamam", goal: "Gerçek veri, güvenlik temeli, workstation çekirdeği.", itemIds: ["f-codec", "w-auth", "w-audit", "r-version", "t-privacy", "m-persist", "w-storage", "w-worklist", "v-mip", "v-mpr", "a-model", "a-card", "w-deid"] },
  { id: "code", title: "Sıradaki mühendislik işleri (kodla yapılabilir)", timeframe: "1–3 ay", goal: "Kalan teknik boşluklar.", itemIds: ["v-vr", "v-mpr", "f-codec", "m-shapes", "r-export", "w-pacs", "v-perf", "v-hanging", "f-objects"] },
  { id: "ai", title: "Gerçek model ve doğrulama", timeframe: "3–9 ay", goal: "Lisanslı/doğrulanmış modeller + kendi verinizde ölçüm.", itemIds: ["a-model", "a-heat", "a-uncert", "t-validation", "a-track", "a-prior"] },
  { id: "org", title: "Kurum/üretici süreçleri (kodla bitmez)", timeframe: "Sürekli", goal: "Düzenleyici uyum, NES, altyapı ve entegrasyon sözleşmeleri.", itemIds: ["t-mdr", "r-esign", "t-privacy", "w-his", "a-notify", "w-pacs"] },
];

export const SOURCES: { title: string; url: string }[] = [
  { title: "RadiAnt DICOM Viewer — özellikler", url: "https://www.radiantviewer.com/dicom-viewer-manual/radiant_dicom_viewer_features.html" },
  { title: "Radiogyan — DICOM görüntüleyici karşılaştırması (2026)", url: "https://radiogyan.com/articles/dicom-viewers/" },
  { title: "ZipDo — En iyi DICOM görüntüleme yazılımları (2026)", url: "https://zipdo.co/best/dicom-viewing-software/" },
  { title: "MedDream — Radyoloji DICOM görüntüleyici", url: "https://meddream.com/products/meddream-dicom-viewer/dicom-radiology-viewer/" },
  { title: "MedAIVerdict — Aidoc incelemesi (2026)", url: "https://medaiverdict.com/tools/aidoc" },
  { title: "Inferensys — Aidoc vs Viz.ai", url: "https://inferensys.com/comparisons/ai-medical-diagnostic-and-patient-risk-platforms/aidoc-vs-vizai" },
  { title: "Mixpeek — En iyi AI tıbbi görüntüleme platformları (2026)", url: "https://mixpeek.com/curated-lists/best-ai-medical-imaging" },
  { title: "Rad AI — SSS", url: "https://www.radai.com/faq" },
  { title: "Nuance — PowerScribe One duyurusu", url: "https://www.nasdaq.com/press-release/nuance-transforms-radiology-reporting-with-major-ai-and-ambient-enhancements-to" },
  { title: "RadPal — AI destekli radyoloji raporlama", url: "https://www.radpal.ai/" },
  { title: "TopFlight — Yapay zeka destekli tıbbi görüntü dokümantasyonu ve FDA sınıflaması", url: "https://topflightapps.com/ideas/ai-medical-image-documentation/" },
];
