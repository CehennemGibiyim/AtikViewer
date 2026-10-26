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

export function modelCardFor(engine: EngineKind): ModelCard {
  if (engine === "cv-heuristic") return CV_MODEL_CARD;
  if (engine === "image-review") return IMAGE_REVIEW_CARD;
  return engine === "simulated-sample" ? DEMO_MODEL_CARD : NO_MODEL_CARD;
}
