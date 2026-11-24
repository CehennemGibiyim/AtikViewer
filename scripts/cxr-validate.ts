/**
 * Akciğer grafisi aday bulgu motorunun KENDİ VERİMİZDE duyarlılık/özgüllük ölçümü.
 *
 * Kullanım:  npm run validate:cxr
 * Çıktı:     src/lib/ai/cxrValidationData.ts  (arayüzdeki doğrulama kapısını besler)
 *
 * İki ayrı etiketli set kullanılır:
 *   - geliştirme seti (seed 777): eşik ayarı sırasında bakılan set
 *   - ölçüm seti      (seed 4242): raporlanan metriklerin alındığı set
 * Metrikler SENETİK (phantom) setten gelir; gerçek hasta verisi doğrulaması DEĞİLDİR.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildCxrDataset, CXR_LABELS, type CxrLabel } from "../tests/cxr-dataset";
import { CXR_THRESHOLDS, detectCxrCategories } from "../src/lib/ai/chestXray";
import { wilson, type CxrCategoryMetrics, type CxrValidationReport } from "../src/lib/ai/cxrValidation";

interface Counts {
  positives: number;
  negatives: number;
  tp: number;
  fp: number;
  tn: number;
  fn: number;
}

function measure(seed: number): { counts: Record<CxrLabel, Counts>; cases: number; startedAt: number } {
  const counts = Object.fromEntries(
    CXR_LABELS.map((l) => [l, { positives: 0, negatives: 0, tp: 0, fp: 0, tn: 0, fn: 0 }]),
  ) as Record<CxrLabel, Counts>;
  const cases = buildCxrDataset(seed);
  const startedAt = Date.now();
  for (const c of cases) {
    const hit = new Set(detectCxrCategories(c.series).map((h) => h.category));
    for (const label of CXR_LABELS) {
      const truth = c.labels[label];
      const predicted = hit.has(label);
      const k = counts[label];
      if (truth) k.positives++;
      else k.negatives++;
      if (truth && predicted) k.tp++;
      else if (truth) k.fn++;
      else if (predicted) k.fp++;
      else k.tn++;
    }
  }
  return { counts, cases: cases.length, startedAt };
}

function asMetrics(k: Counts): CxrCategoryMetrics {
  return {
    positives: k.positives,
    negatives: k.negatives,
    tp: k.tp,
    fp: k.fp,
    tn: k.tn,
    fn: k.fn,
    sensitivity: k.positives ? Number((k.tp / k.positives).toFixed(3)) : 0,
    specificity: k.negatives ? Number((k.tn / k.negatives).toFixed(3)) : 0,
    sensitivity95: wilson(k.tp, k.positives),
    specificity95: wilson(k.tn, k.negatives),
  };
}

function table(title: string, counts: Record<CxrLabel, Counts>, ms: number) {
  console.log(`\n=== ${title} ===`);
  for (const label of CXR_LABELS) {
    const m = asMetrics(counts[label]);
    console.log(
      `${label.padEnd(16)} duyarlılık %${String(Math.round(m.sensitivity * 100)).padStart(3)} ` +
        `(%95 GA ${Math.round(m.sensitivity95.low * 100)}–${Math.round(m.sensitivity95.high * 100)}) · ` +
        `özgüllük %${String(Math.round(m.specificity * 100)).padStart(3)} ` +
        `(%95 GA ${Math.round(m.specificity95.low * 100)}–${Math.round(m.specificity95.high * 100)}) · ` +
        `TP ${m.tp} FN ${m.fn} FP ${m.fp} TN ${m.tn}`,
    );
  }
  console.log(`süre: ${ms} ms`);
}

function main() {
  const dev = measure(777);
  table("GELİŞTİRME SETİ (seed 777 — eşik ayarı)", dev.counts, Date.now() - dev.startedAt);

  const held = measure(4242);
  table("ÖLÇÜM SETİ (seed 4242 — raporlanan metrikler)", held.counts, Date.now() - held.startedAt);

  const categories: CxrValidationReport["categories"] = {};
  for (const label of CXR_LABELS) categories[label] = asMetrics(held.counts[label]);

  const report: CxrValidationReport = {
    version: "1",
    generatedAt: new Date().toISOString(),
    dataset: {
      kind: "synthetic",
      name: "ATIKVIEWER sentetik akciğer grafisi phantom seti (PA, 512×512)",
      cases: held.cases,
      positives: Math.min(...CXR_LABELS.map((l) => held.counts[l].positives)),
      negatives: Math.min(...CXR_LABELS.map((l) => held.counts[l].negatives)),
      note:
        "Gerçek hasta görüntüsü DEĞİLDİR: anlatılan geometriye göre üretilmiş phantom setidir. " +
        "Klinik duyarlılık/özgüllük için kendi arşivinizden etiketli CR/DX setiyle yeniden ölçüm gerekir.",
    },
    categories,
    thresholds: { ...CXR_THRESHOLDS, tuningSet: "seed 777", measurementSet: "seed 4242" },
  };

  const body = `import type { CxrValidationReport } from "./cxrValidation";

/**
 * OTOMATİK ÜRETİLEN DOSYA — elle düzenlemeyin.
 * \`npm run validate:cxr\` (scripts/cxr-validate.ts) tarafından yazılır.
 * Rapor sentetik (phantom) setten gelir; gerçek hasta verisi doğrulaması DEĞİLDİR.
 */
export const CXR_VALIDATION_REPORT: CxrValidationReport = ${JSON.stringify(report, null, 2)};
`;
  const out = join(process.cwd(), "src", "lib", "ai", "cxrValidationData.ts");
  writeFileSync(out, body, "utf8");
  console.log(`\nYazıldı: ${out}`);
  console.log(
    `Rapor: ${report.dataset.cases} vaka · bulgu başına ${report.dataset.positives} pozitif / ${report.dataset.negatives} negatif`,
  );
}

main();
