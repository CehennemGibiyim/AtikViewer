import { CXR_VALIDATION_REPORT } from "./cxrValidationData";

/**
 * Akciğer grafisi (CR/DX) aday bulgu motorunun DOĞRULAMA KAPISI.
 *
 * Kural: kendi verimizde duyarlılık/özgüllük ÖLÇÜLMEMİŞ bir bulgu tipi arayüzde
 * "bulgu" olarak gösterilmez. Ölçüm raporu `npm run validate:cxr` ile üretilir
 * (scripts/cxr-validate.ts) ve bu dosyaya gömülür.
 *
 * Rapor `synthetic` ise (şu anki durum) metrikler fandom/phantom setinden gelir;
 * gerçek hasta verisi doğrulaması DEĞİLDİR. Bu durum arayüzde ve rapor metninde
 * açıkça yazılır.
 */
export const CXR_CATEGORIES = ["Kardiyomegali", "Plevral efüzyon", "Konsolidasyon", "Pnömotoraks", "Nodül"] as const;
export type CxrCategory = (typeof CXR_CATEGORIES)[number];

/** Kapının açılması için gereken en az pozitif/negatif vaka sayısı. */
export const CXR_MIN_POSITIVES = 15;
export const CXR_MIN_NEGATIVES = 30;
/** Bu değerlerin altındaki bir dedektör arayüzde bulgu olarak sunulmaz. */
export const CXR_MIN_SENSITIVITY = 0.4;
export const CXR_MIN_SPECIFICITY = 0.5;

export interface CxrInterval {
  low: number;
  high: number;
}

export interface CxrCategoryMetrics {
  positives: number;
  negatives: number;
  tp: number;
  fp: number;
  tn: number;
  fn: number;
  sensitivity: number;
  specificity: number;
  /** Wilson %95 güven aralığı. */
  sensitivity95: CxrInterval;
  specificity95: CxrInterval;
}

export interface CxrValidationReport {
  /** Rapor biçim sürümü. */
  version: string;
  generatedAt: string;
  /** Ölçüm setinin türü; klinik olmayan sette arayüz "klinik doğrulama yok" der. */
  dataset: {
    kind: "synthetic" | "clinical";
    name: string;
    cases: number;
    positives: number;
    negatives: number;
    note: string;
  };
  categories: Partial<Record<CxrCategory, CxrCategoryMetrics>>;
  /** Dedektör eşikleri (yeniden üretilebilirlik için). */
  thresholds: Record<string, number | string>;
}

/** Wilson skor aralığı (%95). Küçük örneklemde normal yaklaşımdan daha dürüst. */
export function wilson(successes: number, n: number, z = 1.96): CxrInterval {
  if (n <= 0) return { low: 0, high: 0 };
  const p = successes / n;
  const denom = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return {
    low: Math.max(0, Number(((centre - margin) / denom).toFixed(3))),
    high: Math.min(1, Number(((centre + margin) / denom).toFixed(3))),
  };
}

export interface CxrGate {
  unlocked: boolean;
  /** Kilitliyse gerekçe (arayüzde ve analiz notlarında gösterilir). */
  reason: string;
  metrics: CxrCategoryMetrics | null;
}

/** Bir bulgu tipinin arayüzde gösterilip gösterilemeyeceğine karar verir. */
export function cxrGate(category: CxrCategory, report: CxrValidationReport = CXR_VALIDATION_REPORT): CxrGate {
  const m = report.categories[category];
  if (!m) {
    return { unlocked: false, reason: `“${category}” için kendi verimizde duyarlılık/özgüllük ölçümü yok`, metrics: null };
  }
  if (m.positives < CXR_MIN_POSITIVES || m.negatives < CXR_MIN_NEGATIVES) {
    return {
      unlocked: false,
      reason: `“${category}” doğrulama örneklemi yetersiz (pozitif ${m.positives}, negatif ${m.negatives})`,
      metrics: m,
    };
  }
  if (m.sensitivity < CXR_MIN_SENSITIVITY) {
    return { unlocked: false, reason: `“${category}” ölçülen duyarlılık çok düşük (%${Math.round(m.sensitivity * 100)})`, metrics: m };
  }
  if (m.specificity < CXR_MIN_SPECIFICITY) {
    return { unlocked: false, reason: `“${category}” ölçülen özgüllük çok düşük (%${Math.round(m.specificity * 100)})`, metrics: m };
  }
  return { unlocked: true, reason: "", metrics: m };
}

/** Bulgu metnine eklenecek kısa doğrulama cümlesi. */
export function cxrValidationSentence(report: CxrValidationReport, m: CxrCategoryMetrics): string {
  const kind = report.dataset.kind === "clinical" ? "klinik" : "sentetik (phantom)";
  return (
    `Kendi verimizde ölçülen performans — ${kind} set, ${report.dataset.cases} vaka ` +
    `(${m.positives} pozitif / ${m.negatives} negatif): duyarlılık %${Math.round(m.sensitivity * 100)} ` +
    `(%95 GA %${Math.round(m.sensitivity95.low * 100)}–%${Math.round(m.sensitivity95.high * 100)}), ` +
    `özgüllük %${Math.round(m.specificity * 100)} (%95 GA %${Math.round(m.specificity95.low * 100)}–%${Math.round(m.specificity95.high * 100)}).`
  );
}

/** Raporun klinik doğrulama sayılıp sayılmadığı (arayüz etiketi için). */
export function cxrIsClinical(report: CxrValidationReport = CXR_VALIDATION_REPORT): boolean {
  return report.dataset.kind === "clinical";
}
