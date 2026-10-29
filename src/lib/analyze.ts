import { fmtConf } from "@/lib/format";
import { modelCardFor } from "@/lib/modelCards";
import type { AnalysisResult, Differential, EngineKind, Finding, ImageReview, Severity } from "@/lib/types";

/**
 * Analiz sonucu (bulgu metni, izlenim, triyaj, hasta özeti) üretimi — SAF fonksiyon.
 * Hem sunucu ucu (/api/analyze) hem de GitHub Pages statik demosu (tarayıcıda) kullanır.
 */
export interface AnalyzeBody {
  studyUid?: string;
  meta: { modality: string; bodyPart: string; seriesDescription: string; sliceCount: number; sliceThickness?: number };
  engine: EngineKind;
  findings: Finding[];
  review?: ImageReview;
  clinicalNote?: string;
  roi?: { mean: number; std: number; slice: number } | null;
}

const rank: Record<Severity, number> = { kritik: 4, yuksek: 3, orta: 2, dusuk: 1, normal: 0 };

const TRIAGE: Record<Severity, { level: string; score: number; note: string }> = {
  kritik: { level: "ACİL — KIRMIZI", score: 0.95, note: "Kritik aday bulgu. İlgili kesitler radyolog tarafından derhal değerlendirilmeli." },
  yuksek: { level: "ÖNCELİKLİ — TURUNCU", score: 0.78, note: "Yüksek öncelikli aday bulgu. Kısa sürede radyolog teyidi önerilir." },
  orta: { level: "YARI ACİL — SARI", score: 0.55, note: "Takip ve korelasyon gerektiren aday bulgular." },
  dusuk: { level: "RUTİN — YEŞİL", score: 0.3, note: "Düşük öncelikli aday bulgular." },
  normal: { level: "RUTİN — YEŞİL", score: 0.1, note: "Aday bulgu yok. Bu, normal olduğu anlamına gelmez; radyolog değerlendirmesi gerekir." },
};

const LUNG_RADS_ADVICE: Record<string, string> = {
  "2": "12 ay sonra rutin düşük doz BT (Lung-RADS 2, solid nodül <6 mm eşiği).",
  "3": "6 ay sonra düşük doz BT (Lung-RADS 3, 6–<8 mm eşiği).",
  "4A": "3 ay sonra düşük doz BT; ≥8 mm solid bileşen varsa PET-BT değerlendirilebilir (Lung-RADS 4A, 8–<15 mm eşiği).",
  "4B": "Kontrastlı/kontrastsız toraks BT, PET-BT ve/veya doku örneklemesi/ilgili branş yönlendirmesi (Lung-RADS 4B, ≥15 mm eşiği).",
};

function techniqueFor(b: AnalyzeBody["meta"], engine: EngineKind): string {
  const th = b.sliceThickness ? ` (${b.sliceThickness} mm kesit kalınlığı)` : "";
  const base =
    b.modality === "CT"
      ? `${b.bodyPart} bölgesine yönelik toplam ${b.sliceCount} kesitlik BT serisi (${b.seriesDescription})${th} değerlendirildi.`
      : b.modality === "MR"
        ? `${b.bodyPart} bölgesine yönelik ${b.seriesDescription} sekansı (toplam ${b.sliceCount} kesit)${th} değerlendirildi.`
        : b.modality === "CR" || b.modality === "DX"
          ? `Direkt grafi (${b.seriesDescription}) değerlendirildi.`
          : `${b.modality} modalitesinde ${b.sliceCount} görüntü değerlendirildi.`;
  const note =
    engine === "cv-heuristic"
      ? " [Aday bulgular kural tabanlı görüntü işleme ile hesaplanmıştır; derin öğrenme modeli değildir ve klinik olarak doğrulanmamıştır.]"
      : engine === "image-review"
        ? " [Tüm karelerde gerçek piksel ölçümü yapıldı: sinyal/kontrast ve varsa RGB renkli alan. Bu bir hastalık/lezyon dedektörü DEĞİLDİR; acil triyaj veya tanı üretmez.]"
        : engine === "simulated-sample"
          ? " [DEMO: Bulgular örnek vakaya önceden tanımlanmış simülasyondur.]"
          : " [Bu seri için otomatik analiz yapılmamıştır; kullanıcının seçimi veya görüntü bulunmaması nedeniyle inceleme kapalıdır.]";
  return base + note;
}

function differentialsFor(cat: string, range: string): Differential[] {
  if (cat === "Kanama")
    return [
      { dx: "İntraparankimal hematom (hipertansif/diğer)", rationale: `Hiperdens odak (${range}); etiyoloji klinik ve ek tetkikle ayrıştırılmalı.`, probability: 0.5 },
      { dx: "Hemorajik transformasyon", rationale: "İnfarkt zemininde, çevresel ödem oranına göre düşünülür.", probability: 0.2 },
      { dx: "Vasküler malformasyon / anevrizma kanaması", rationale: "BT anjiyo ile değerlendirilmelidir.", probability: 0.15 },
      { dx: "Kalsifikasyon / venöz sinüs / artefakt (yanlış pozitif)", rationale: "Kural tabanlı aday olduğundan öncelikle dışlanmalıdır.", probability: 0.15 },
    ];
  if (cat === "Nodül")
    return [
      { dx: "Primer akciğer karsinomu", rationale: `Nodül (${range}); kontur, plevral ilişki ve büyüme hızı değerlendirilmeli.`, probability: 0.3 },
      { dx: "Granülomatöz/enfeksiyöz sekel", rationale: "Önceki tetkikle boyut stabilitesi karşılaştırılmalı.", probability: 0.3 },
      { dx: "Metastatik nodül", rationale: "Primer malignite öyküsü sorgulanmalı.", probability: 0.1 },
      { dx: "Damar kesiti / intrapulmoner lenf nodu (yanlış pozitif)", rationale: "Kural tabanlı aday; çok kesitli komşuluk izlenmeli.", probability: 0.3 },
    ];
  if (cat === "Sinüs / Mukoza")
    return [
      { dx: "Akut / kronik sinüzit", rationale: `${range}: FLAIR hiperintens mukozal kalınlaşma ve sekresyon.`, probability: 0.65 },
      { dx: "Mukosel / retansiyon kisti", rationale: "Düzgün sınırlı kistik lezyon ayrımı.", probability: 0.25 },
      { dx: "Alerjik fungal sinüzit", rationale: "Kemik erozyonu için BT.", probability: 0.1 },
    ];
  return [];
}


export type AnalyzeOutcome = { ok: true; result: AnalysisResult } | { ok: false; error: string };

export function buildAnalysis(body: AnalyzeBody): AnalyzeOutcome {
  const { meta, engine } = body;
  if (!meta || !engine) return { ok: false, error: "Eksik veri" };
  if (engine === "image-review" && (!body.review || !Array.isArray(body.review.frames) || body.review.frames.length !== meta.sliceCount)) {
    return { ok: false, error: "Kare ölçümleri eksik; gerçek görüntü incelemesini tekrar başlatın." };
  }

  const total = Math.max(1, meta.sliceCount);
  const thickness = meta.sliceThickness || 5;
  let findings: Finding[] = Array.isArray(body.findings) ? [...body.findings] : [];

  if (findings.length === 0) {
    const mid = Math.floor(total / 2);
    findings.push({
      id: engine === "image-review" ? "ir0" : engine === "no-model" ? "nm1" : "nc1",
      sliceIndex: mid, sliceStart: 0, sliceEnd: total - 1, keySliceNumber: mid + 1,
      sliceRangeStr: total > 1 ? `Kesit 1 – ${total} (tüm seri)` : "Kesit 1",
      anatomicalLocation: "—", densityOrSignal: "—", sizeMmStr: "—", bbox: null,
      label: engine === "image-review" ? "Kesit bazlı piksel ölçümü" : engine === "no-model" ? "Otomatik analiz kapalı" : "Aday odak işaretlenmedi",
      detail:
        engine === "image-review"
          ? `${body.review?.frames.length ?? 0} karede piksel sinyali ve kontrast ölçüldü; tanısal bir patoloji/normal sonuç çıkartılamaz.`
          : engine === "no-model"
            ? "Bu seri için otomatik inceleme seçilmedi. Görüntüler radyolog tarafından değerlendirilmelidir."
            : "Kural tabanlı BT dedektörü bu seride aday odak işaretlemedi. Bu, normal olduğu anlamına gelmez.",
      category: "Sistem", severity: "normal", confidence: 0, confidenceKind: "none", source: engine === "image-review" ? "image-review" : "cv-heuristic",
    });
  }

  if (body.roi) {
    const r = body.roi;
    findings.push({
      id: "roi-1", sliceIndex: r.slice, sliceStart: r.slice, sliceEnd: r.slice, keySliceNumber: r.slice + 1,
      sliceRangeStr: `Kesit ${r.slice + 1} (kullanıcı ROI)`,
      zLocationMm: Number(((r.slice - total / 2) * thickness).toFixed(1)),
      anatomicalLocation: `İşaretlenen ROI (Kesit ${r.slice + 1})`,
      densityOrSignal: `Ortalama ${r.mean.toFixed(1)} / SS ${r.std.toFixed(1)}`, sizeMmStr: "Bölgesel ölçüm", bbox: null,
      label: "ROI ölçümü", detail: `Kesit ${r.slice + 1}'de ROI ortalaması ${r.mean.toFixed(1)}, SS ${r.std.toFixed(1)}. Ölçüm kaydıdır; otomatik yorum yapılmamıştır.`,
      category: "ROI", severity: "normal", confidence: 0, confidenceKind: "none", source: "manual",
    });
  }

  findings.sort((a, b) => rank[b.severity] - rank[a.severity]);
  const abn = findings.filter((f) => f.severity !== "normal");
  const worst: Severity = abn[0]?.severity ?? "normal";
  const triage = engine === "image-review"
    ? { level: "KLİNİK TRİYAJ YOK", score: 0, note: "Kareler ölçüldü; bu yöntem acil durum veya hastalık sınıflandırması yapamaz." }
    : engine === "no-model"
      ? { level: "DEĞERLENDİRİLMEDİ", score: 0, note: "Otomatik inceleme kapalı." }
      : TRIAGE[worst];
  const top = abn[0];
  const topRange = top ? top.sliceRangeStr : "";
  const differentials = engine === "no-model" || engine === "image-review" || !top ? [] : differentialsFor(top.category, topRange);

  const reportFindings = engine === "image-review"
    ? findings.filter((f) => f.category !== "Görüntü ölçümü" && f.category !== "Sistem")
    : findings.filter((f) => f.category !== "Görüntü ölçümü");
  const findingsText = reportFindings
    .map((f, i) => {
      const loc = `[${f.sliceRangeStr}${f.category === "Sistem" ? "" : `, anahtar kesit ${f.keySliceNumber}`}${f.zLocationMm !== undefined ? `, z ${f.zLocationMm > 0 ? "+" : ""}${f.zLocationMm} mm` : ""}]`;
      const conf = fmtConf(f);
      const metric = f.category === "Sistem" ? "" : ` ${f.anatomicalLocation} · ${f.densityOrSignal} · ${f.sizeMmStr}${conf ? ` · ${conf}` : ""}`;
      return `${i + 1}. ${f.label} ${loc}:\n   ${f.detail}${metric ? `\n  ${metric}` : ""}`;
    })
    .join("\n\n");
  // Kare/kesit başına piksel istatistikleri ölçüm panelinde kalır; rapor metnine
  // yalnızca hastalık adayı bulgular girer. image-review tanı sınıflandırıcısı değildir.

  const impression = engine === "image-review"
    ? `${body.review?.frameCount ?? meta.sliceCount} karede nicel görüntü ölçümü yapıldı. Bu ölçümler patoloji var/yok, normal inceleme veya acil triyaj sonucu olarak yorumlanamaz; klinik izlenim radyolog tarafından yazılmalıdır.`
    : abn.length === 0
      ? engine === "no-model"
        ? "Otomatik inceleme kapalı. Değerlendirme radyolog tarafından yapılmalıdır."
        : "Otomatik aday odak işaretlenmedi (bu, normal olduğu anlamına gelmez). Nihai değerlendirme radyoloğa aittir."
      : abn.map((f, i) => `${i + 1}) ${f.label} [Kesit ${f.keySliceNumber}]${f.metrics?.lungRads ? ` — Lung-RADS ${f.metrics.lungRads} eşiği` : ""}.`).join(" ");

  let recommendation = "Görüntüler radyolog tarafından doğrudan değerlendirilmelidir.";
  if (top?.category === "Nodül" && top.metrics?.lungRads && LUNG_RADS_ADVICE[top.metrics.lungRads]) {
    recommendation = `Kılavuz boyut eşiğine göre öneri (hekim kararına tabidir): ${LUNG_RADS_ADVICE[top.metrics.lungRads]} Not: solid nodül varsayımıyla, otomatik ölçüme dayanır.`;
  } else if (top?.category === "Kanama") {
    recommendation = `Hiperdens aday odak (${topRange}) için acil radyolog değerlendirmesi, klinik korelasyon ve gerekirse ilgili branş konsültasyonu önerilir.`;
  } else if (top) {
    recommendation = `Aday bulgu (${topRange}) için klinik korelasyon ve ilgili branş değerlendirmesi önerilir.`;
  }

  const clin = (body.clinicalNote ?? "").trim();
  const patientSummary = engine === "image-review"
    ? `${body.review?.frameCount ?? meta.sliceCount} görüntü/karede parlaklık, kontrast ve mevcutsa renkli alan ölçümleri yapıldı. Bu ölçümler hastalık tanısı veya acil durum değerlendirmesi değildir. Sonuç için doktorunuzun görüntüleri yorumlaması gerekir.`
    : engine === "no-model"
      ? "Bu görüntüler için otomatik inceleme seçilmedi. Sonuç için doktorunuzun değerlendirmesi gerekir."
      : abn.length
        ? `Otomatik tarama ${meta.sliceCount} kesitte ${abn.length} aday odak işaretledi: ${abn.map((f) => `${f.label.toLowerCase()} (Kesit ${f.keySliceNumber})`).join(", ")}. Bunlar kesin tanı değildir; doktorunuz inceleyecektir.${clin ? ` Belirttiğiniz şikayet ("${clin}") dikkate alınmıştır.` : ""}`
        : "Otomatik tarama aday bir odak işaretlemedi. Bu, her şeyin normal olduğu anlamına gelmez; sonuç için doktorunuza başvurunuz.";

  const card = modelCardFor(engine);
  const result: AnalysisResult = {
    findings,
    ...(body.review ? { review: body.review } : {}),
    triage, differentials, patientSummary,
    technique: techniqueFor(meta, engine),
    qualityNote: engine === "image-review"
      ? "Yalnızca piksel istatistikleri hesaplanmıştır. Doppler RGB renkleri kalibrasyon olmadan hız/akış ölçümü değildir. Klinik tanısal sorumluluk radyoloğa aittir."
      : "Nihai tanısal sorumluluk raporu onaylayan radyoloğa aittir.",
    findingsText, impression, recommendation,
    model: `${card.name} v${card.version}${engine === "simulated-sample" ? " (simülasyon)" : engine === "cv-heuristic" ? " (kural tabanlı)" : engine === "image-review" ? " (tanısal değil)" : ""}`,
    engine, modelCard: card,
  };
  return { ok: true, result };
}
