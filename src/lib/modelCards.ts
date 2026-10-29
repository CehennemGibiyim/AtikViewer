import type { EngineKind, ModelCard } from "./types";

export const CV_MODEL_CARD: ModelCard = {
  name: "ATIK-CV Aday Bulgu Motoru",
  version: "0.3.0",
  intendedUse:
    "BT beyin (akut kanama adayı) ve BT toraks (pulmoner nodül adayı) serilerinde, radyolog incelemesini yönlendirmek için aday odaklar işaretlemek. Tanı koymaz.",
  method:
    "Derin öğrenme KULLANMAZ. HU eşikleme, kafatası/akciğer maskesi çıkarımı, 3 boyutlu bağlantılı bileşen analizi ve şekil/boyut süzgeçleri (kural tabanlı).",
  limitations: [
    "Klinik olarak doğrulanmamıştır; duyarlılık/özgüllük bilinmiyor.",
    "Yalnızca HU kalibrasyonlu BT serilerinde çalışır; MR ve direkt grafide dedektör yoktur.",
    "Kanama adayı: kalsifikasyon, venöz sinüs, artefakt ve kafatası tabanı yakınında yanlış pozitif verebilir; kafatası halkası kapalı olmayan kesitler atlanır.",
    "Nodül adayı: plevraya komşu nodüller kaçabilir; damar uçları nodül olarak işaretlenebilir.",
    "Skor, olasılık değildir; kalibre edilmemiş bir sezgisel puandır.",
    "Yön (sağ/sol) yalnızca ImageOrientation bilgisi varsa ve standart aksiyel ise tahmin edilir.",
  ],
  validation: "YOK — gölge mod ve kendi verinizde değerlendirme yapılmadan klinik karar için kullanılamaz.",
};

export const IMAGE_REVIEW_CARD: ModelCard = {
  name: "ATIK Kare/Kesit Görüntü İncelemesi",
  version: "1.0.0",
  intendedUse: "Piksel içeren tüm görüntü serilerinde kare bazlı nicel sinyal, kontrast ve (varsa) ekranda görünen RGB renk dağılımını göstermek. Radyoloğun ilgili karelere gitmesini kolaylaştırmak.",
  method: "Gerçek piksel verisi örneklenerek ortalama, standart sapma, %2–%98 kontrast aralığı ve ardışık kare değişimi ölçülür. Renkli karede RGB piksel oranları sayılır. Derin öğrenme veya hastalık sınıflandırıcısı KULLANMAZ.",
  limitations: [
    "Klinik tanı, anomali/lezyon tespiti, acil triyaj ya da negatif tetkik sonucu vermez.",
    "Renkli Doppler piksel oranı kan akım hızı, akım yönü, stenoz veya perfüzyon değildir. Fiziksel yorum için US Region Calibration gereklidir.",
    "MR sinyal yoğunluğu farklı sekans ve cihazlar arasında doğrudan klinik olarak karşılaştırılamaz.",
    "İnceleme noktaları istatistiksel kare seçimidir; patolojik bulgu anlamına gelmez.",
  ],
  validation: "Tanısal performans doğrulaması yoktur; klinik karar için kullanılamaz.",
};

export const DEMO_MODEL_CARD: ModelCard = {
  name: "ATIK-Vision DEMO",
  version: "demo",
  intendedUse: "Yalnızca arayüz gösterimi. MR/CR örnek vakalarına önceden tanımlanmış bulgular.",
  method: "Model yok. Bulgular örnek vaka üretilirken elle tanımlanmıştır.",
  limitations: ["Gerçek görüntüden hesaplanmaz.", "Klinik karar için kullanılamaz."],
  validation: "Uygulanamaz (simülasyon).",
};

export const NO_MODEL_CARD: ModelCard = {
  name: "Model bağlı değil",
  version: "-",
  intendedUse: "-",
  method: "Bu seri için tanımlı otomatik analiz yoktur.",
  limitations: ["Boş sonuç 'normal' anlamına gelmez."],
  validation: "-",
};

/** Yerel derin öğrenme (MONAI) + kural tabanlı motor birlikte çalıştığında rapora yazılan kart. */
export const DEEP_MODEL_CARD: ModelCard = {
  name: "MONAI lung_nodule_ct_detection (yerel) + ATIK-CV",
  version: "bundle 1.0 · LUNA16",
  intendedUse:
    "BT toraks serilerinde pulmoner nodül ADAYI işaretleyerek radyoloğun ilgili kesitlere doğrudan gitmesini sağlamak. Tanı koymaz; nihai onay radyoloji uzmanına aittir.",
  method:
    "LUNA16 üzerinde eğitilmiş RetinaNet (ResNet50-3D FPN) 3B dedektör. Ön işleme bundle ile birebir: HU klibi [-1024, 300], 0.703×0.703×1.25 mm boşluğa yeniden örnekleme, kayan pencere çıkarımı. Çıkarım TAMAMEN yerel makinede çalışır; hasta verisi dışarı gönderilmez, ücretli servis kullanılmaz. Kural tabanlı ATIK-CV adayları ayrıca sunulur.",
  limitations: [
    "LUNA16 popülasyonunda eğitilmiştir; başka protokol/hastalık gruplarında performansı bilinmiyor.",
    "Yalnızca HU kalibrasyonlu aksiyel BT toraks serilerinde çalışır (BT beyin/MR/direkt grafide çalışmaz).",
    "Model skoru kalibre olasılık değildir; damar kesiti, kalsifikasyon ve artefaktlar yanlış pozitif verebilir.",
    "Klinik hasta kohortu ile doğrulanmamıştır; kesin değerlendirme radyoloji uzmanı tarafından yapılmalıdır.",
  ],
  validation:
    "Yerel teknik doğrulama: bilinen nodülleri içeren sentetik toraks hacminde 12 mm ve 9 mm nodüller mm düzeyinde konum ve boyut isabetiyle (skor 0.96/0.95) bulundu. Klinik doğrulama YOKTUR.",
};

/** Yerel derin öğrenme — beyin (ICH) modeli devreye girdiğinde rapora yazılan kart. */
export const DEEP_BRAIN_MODEL_CARD: ModelCard = {
  name: "ct-head-hemorrhage-detection (yerel) + ATIK-CV",
  version: "MIT · RSNA ICH eğitimi",
  intendedUse:
    "BT beyin serilerinde intrakraniyal kanama ADAYI işaretleyerek radyoloğun ilgili kesitlere doğrudan gitmesini sağlamak. Tanı koymaz; nihai onay radyoloji uzmanına aittir.",
  method:
    "MaxViT-tabanlı paylaşımlı kodlayıcı + 5 alt tip sınıflandırıcı (epidural, intraparankimal, intraventriküler, subaraknoid, subdural), BiGRU dizi bağlamı ve 5 katmanlı (fold) anlamsal ayrıştırıcı maske. Üç pencereli (40/80, 80/200, 600/2800 HU) girdi. Çıkarım TAMAMEN yerel makinede çalışır; hasta verisi dışarı gönderilmez, ücretli servis kullanılmaz.",
  limitations: [
    "RSNA ICH (2019) popülasyonunda eğitilmiştir; başka protokol/hastalık gruplarında performansı bilinmiyor.",
    "Yalnızca HU kalibrasyonlu aksiyel BT beyin serilerinde çalışır.",
    "Model skoru kalibre olasılık değildir; kemik, kalsifikasyon ve hareket artefaktları yanlış pozitif verebilir.",
    "Klinik hasta kohortu ile yerel doğrulanmamıştır; kesin değerlendirme radyoloji uzmanı tarafından yapılmalıdır.",
  ],
  validation:
    "Yerel teknik doğrulama: sentetik gürültü serilerinde yanlış pozitif üretilmedi; klinik doğrulama (duyarlılık/özgüllük tablosu) YAPILMAMIŞTIR.",
};

export function modelCardFor(engine: EngineKind): ModelCard {
  if (engine === "cv-heuristic") return CV_MODEL_CARD;
  if (engine === "image-review") return IMAGE_REVIEW_CARD;
  return engine === "simulated-sample" ? DEMO_MODEL_CARD : NO_MODEL_CARD;
}
