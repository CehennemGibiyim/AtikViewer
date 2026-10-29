/**
 * Derin AI (yerel MONAI lung_nodule_ct_detection) istemci entegrasyonu.
 *
 * - CT serisinin gerçek HU pikselleri Int16 little-endian hacme paketlenir,
 *   gzip ile sıkıştırılır ve yerel AI worker'a (127.0.0.1:8787) yalnızca bu
 *   makine üzerinden iletilir. Hasta verisi ağ dışına ÇIKMAZ, ücretli servis KULLANILMAZ.
 * - Model: MONAI lung_nodule_ct_detection bundle (LUNA16 eğitimi, Apache-2.0).
 * - Kutu skorları model çıktısıdır (kalibre olasılık değildir); bulgular
 *   "aday" olarak işaretlenir ve rapor onayı radyoloji uzmanı olmadan verilemez.
 */
import { gzip } from "fflate";
import type { BBox, Finding, SeriesData } from "./types";

export interface DeepBox {
  x: number; y: number; w: number; h: number; // [0,1] normalize (gönderilen hacmin genişlik/yüksekliği)
  z0: number; z1: number; // gönderilen hacimde kesit indisleri
  score: number;
  /** Yalnızca beyin protokolü: kanama alt tipi etiketi (worker'dan gelir) */
  label?: string;
  subtype?: string;
}

export interface DeepScanMeta {
  elapsedMs: number;
  model: string;
  scoreThresh: number;
}

const MAX_Z = 600;          // çok kalın serilerde z adımlama (nodül modeli)
const MAX_Z_HEAD = 300;      // beyin modeli CPU'da yavaş → maks 300 model kesiti (~15 dk)
const MAX_VOXELS = 300_000_000; // ~600 MB int16 sınırı

export type DeepProtocol = "ct-chest" | "ct-head";

/** Protokole göre istemci zaman aşımı (ms). Beyin modeli CPU'da uzun sürer. */
const timeoutFor = (p: DeepProtocol) => (p === "ct-head" ? 1_500_000 : 300_000);

/** Derin AI için uygun değilse nedenini döndürür; uygunsa null. */
export function deepScanEligible(s: SeriesData): string | null {
  if (s.specialType && s.specialType !== "image") return "seri bir görüntü serisi değil";
  if (s.modality.toUpperCase() !== "CT") return "yalnızca BT serilerinde çalışır";
  if (s.unit !== "HU") return "piksel değerleri HU biriminde değil (Rescale yok)";
  if (s.isColor || s.rgbaSlices) return "renkli/görüntü serisi değil";
  if (s.slices.length < 30) return `seri çok kısa (${s.slices.length} kesit; en az 30 gerekli)`;
  return null;
}

interface PackedVolume {
  bytes: Uint8Array;      // gzip(int16 LE)
  dims: [number, number, number];      // Z', Y, X (gönderilen)
  spacing: [number, number, number];   // sz, sy, sx mm (zStep uygulanmış)
  zStep: number;
}

/** Seriyi HU hacmine paketler (gzip dahil). HU değilse null. */
export async function packHuVolume(s: SeriesData, maxZ: number = MAX_Z): Promise<PackedVolume | null> {
  const Z = s.slices.length, Y = s.height, X = s.width;
  if (!Z || !Y || !X) return null;
  if (s.slices.some((sl) => sl.length !== Y * X)) return null; // boyut tutarsız

  const zStep = Math.max(1, Math.ceil(Z / maxZ));
  const effZ = Math.ceil(Z / zStep);
  if (effZ * Y * X > MAX_VOXELS) return null;

  const vol = new Int16Array(effZ * Y * X);
  let o = 0;
  for (let z = 0; z < Z; z += zStep) {
    const sl = s.slices[z];
    for (let i = 0; i < sl.length; i++) {
      const v = sl[i] + 0.5;
      vol[o++] = v < -32768 ? -32768 : v > 32767 ? 32767 : v | 0;
    }
  }

  // Kesit aralığı: slicePositions > sliceSpacing > sliceThickness
  const dz = Math.abs((s.slicePositions?.[1] ?? 0) - (s.slicePositions?.[0] ?? 0)) || s.sliceSpacing || s.sliceThickness || 1;
  const dy = s.pixelSpacing || 1;
  const dx = s.pixelSpacingX || s.pixelSpacing || 1;

  const raw = new Uint8Array(vol.buffer, vol.byteOffset, vol.byteLength);
  const bytes = await new Promise<Uint8Array>((resolve, reject) => {
    gzip(raw, (err, out) => (err ? reject(err) : resolve(out)));
  });
  return { bytes, dims: [effZ, Y, X], spacing: [dz * zStep, dy, dx], zStep };
}

export interface DeepScanOutput extends DeepScanMeta {
  findings: Finding[];
  submittedZ: number;
  zStep: number;
}

/**
 * Seriyi yerel AI worker'a gönderir ve bbox'lı nodül adayı bulgularını döndürür.
 * Ağ hatası / worker kapalı ise fırlatır; çağıran akış devam eder.
 */
export async function deepScan(s: SeriesData, signal?: AbortSignal, protocol: DeepProtocol = "ct-chest"): Promise<DeepScanOutput> {
  const packed = await packHuVolume(s, protocol === "ct-head" ? MAX_Z_HEAD : MAX_Z);
  if (!packed) throw new Error("HU hacmi paketlenemedi (bellek/boyut sınırı)");

  const res = await fetch(`/api/deep-scan?protocol=${protocol}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "X-Dims": packed.dims.join(","),
      "X-Spacing": packed.spacing.map((v) => v.toFixed(4)).join(","),
      "X-Protocol": protocol,
    },
    body: packed.bytes.buffer as ArrayBuffer, // fflate taze tampon döndürür
    signal: signal ?? AbortSignal.timeout(timeoutFor(protocol)),
  });
  const data = (await res.json().catch(() => null)) as { error?: string } & DeepScanMeta & { boxes?: DeepBox[] } | null;
  if (!res.ok || !data) throw new Error((data as { error?: string } | null)?.error ?? `yerel AI worker hatası (${res.status})`);
  const boxes = Array.isArray(data.boxes) ? data.boxes : [];
  const findings = protocol === "ct-head"
    ? brainBoxesToFindings(boxes, s, packed)
    : boxesToFindings(boxes, s, packed);
  return { findings, elapsedMs: data.elapsedMs ?? 0, model: data.model ?? "MONAI lung_nodule_ct_detection", scoreThresh: data.scoreThresh ?? 0, submittedZ: packed.dims[0], zStep: packed.zStep };
}

const ICH_SUBTYPE_INFO: Record<string, { sev: string; note: string }> = {
  epidural: { sev: "kritik", note: "dural venöz sinüs/damar yaralanması ile uyumlu yüksek basınçlı ekstravazasyon düşünülür" },
  intraparenchymal: { sev: "kritik", note: "parankimal içinde doğrudan kanama; hipertansif kanama, damar tıkanıklığı veya travma ile uyumlu olabilir" },
  intraventricular: { sev: "kritik", note: "ventriküllere kanama; hidrosefali riski nedeniyle acil değerlendirme gerektirir" },
  subarachnoid: { sev: "kritik", note: "subaraknoid boşlukta kanama; anevrizmal kanama açısından acil araştırma gerekir" },
  subdural: { sev: "yuksek", note: "subdural alanda kanama; geçirilmiş travma/venöz yırtılma ile uyumlu olabilir" },
};

/** Beyin (ICH) worker kutularını rapor bulgularına çevirir. */
export function brainBoxesToFindings(boxes: DeepBox[], s: SeriesData, packed: PackedVolume): Finding[] {
  const Z = s.slices.length, Y = s.height, X = s.width;
  const [dz, dy, dx] = packed.spacing;
  const zStep = packed.zStep;
  const pos = s.slicePositions;

  return boxes
    .filter((b) => Number.isFinite(b.score) && b.score >= 0.30 && b.w > 0 && b.h > 0 && b.label)
    .slice(0, 8)
    .map((b, i) => {
      const z0 = Math.max(0, Math.min(Z - 1, Math.round(b.z0) * zStep));
      const z1 = Math.max(z0, Math.min(Z - 1, Math.round(b.z1) * zStep + (zStep - 1)));
      const peak = Math.round((z0 + z1) / 2);
      const wMm = b.w * X * dx;
      const hMm = b.h * Y * dy;
      const nSl = z1 - z0 + 1;
      const zMm = nSl * dz;
      const dia = Math.max(wMm, hMm);
      const info = ICH_SUBTYPE_INFO[b.subtype ?? ""] ?? { sev: "yuksek", note: "lokalizasyon alt tipi belirsiz" };
      const bbox: BBox = {
        x: Math.max(0, Math.min(1, b.x)),
        y: Math.max(0, Math.min(1, b.y)),
        w: Math.max(0.004, Math.min(1 - b.x, b.w)),
        h: Math.max(0.004, Math.min(1 - b.y, b.h)),
      };
      return {
        id: `bh${i + 1}`,
        sliceIndex: peak, sliceStart: z0, sliceEnd: z1, keySliceNumber: peak + 1,
        sliceRangeStr: z0 === z1 ? `Kesit ${z0 + 1}` : `Kesit ${z0 + 1} – ${z1 + 1} (${nSl} kesitte)`,
        zLocationMm: Number(((pos ? pos[peak] - pos[0] : (peak - Z / 2) * dz)).toFixed(1)),
        anatomicalLocation: "Beyin (kutu konumu maske tahmini)",
        densityOrSignal: `derin öğrenme skoru ${Math.round(b.score * 100)}/100`,
        sizeMmStr: `≈ ${dia.toFixed(1)} mm (${wMm.toFixed(0)} × ${hMm.toFixed(0)} × ${zMm.toFixed(0)} mm)`,
        bbox, label: b.label!,
        detail:
          `Yerel derin öğrenme modeli (ct-head-hemorrhage-detection, MIT/RSNA ICH) bu seride ${nSl} kesitlik bölgede ` +
          `${b.label} için model skoru ${Math.round(b.score * 100)}/100 işaretledi (kalibre olasılık değil). Radyolojik yorumda ${info.note}. ` +
          `Kesit aralığı: ${z0 + 1}–${z1 + 1}; odak boyutu ≈${dia.toFixed(1)} mm. ` +
          `BULGU YAPAY ZEKA ÇIKTISIDIR VE RADYOLOJİ UZMANI TARAFINDAN ONAYLANMADAN GEÇERLİ DEĞİLDİR.`,
        category: "Kanama", severity: info.sev as Finding["severity"],
        confidence: Math.max(0, Math.min(1, b.score)),
        confidenceKind: "heuristic" as const,
        source: "ai-model" as const,
        metrics: { maxDiameterMm: Number(dia.toFixed(1)), zExtentMm: Number(zMm.toFixed(1)) },
      } satisfies Finding;
    })
    .filter((f, i, arr) =>
      arr.findIndex((g) => g.sliceStart <= f.sliceEnd && g.sliceEnd >= f.sliceStart && iou(f.bbox!, g.bbox!) > 0.5) === i
    );
}

const lungRadsFor = (dia: number) => (dia < 6 ? "2" : dia < 8 ? "3" : dia < 15 ? "4A" : "4B");

/** Worker kutularını (gönderilen hacim uzayında) rapor bulgularına çevirir. */
export function boxesToFindings(boxes: DeepBox[], s: SeriesData, packed: PackedVolume): Finding[] {
  const Z = s.slices.length, Y = s.height, X = s.width;
  const [effZ, , ] = packed.dims;
  const [dz, dy, dx] = packed.spacing;
  const zStep = packed.zStep;
  const pos = s.slicePositions;

  return boxes
    .filter((b) => Number.isFinite(b.score) && b.score >= 0.30 && b.w > 0 && b.h > 0)
    .slice(0, 10)
    .map((b, i) => {
      // gönderilen hacim → orijinal kesit indisleri
      const z0 = Math.max(0, Math.min(Z - 1, Math.round(b.z0) * zStep));
      const z1 = Math.max(z0, Math.min(Z - 1, Math.round(b.z1) * zStep + (zStep - 1)));
      const peak = Math.round((z0 + z1) / 2);
      const wMm = b.w * X * dx;
      const hMm = b.h * Y * dy;
      const nSl = z1 - z0 + 1;
      const zMm = nSl * dz;
      const dia = Math.max(wMm, hMm);
      const severity = dia >= 15 ? "yuksek" : dia >= 8 ? "orta" : "dusuk";
      const lungRads = lungRadsFor(dia);
      const bbox: BBox = {
        x: Math.max(0, Math.min(1, b.x)),
        y: Math.max(0, Math.min(1, b.y)),
        w: Math.max(0.004, Math.min(1 - b.x, b.w)),
        h: Math.max(0.004, Math.min(1 - b.y, b.h)),
      };
      return {
        id: `dn${i + 1}`,
        sliceIndex: peak, sliceStart: z0, sliceEnd: z1, keySliceNumber: peak + 1,
        sliceRangeStr: z0 === z1 ? `Kesit ${z0 + 1}` : `Kesit ${z0 + 1} – ${z1 + 1} (${nSl} kesitte)`,
        zLocationMm: Number(((pos ? pos[peak] - pos[0] : (peak - Z / 2) * dz)).toFixed(1)),
        anatomicalLocation: "Akciğer (yön tahmini yapılmadı)",
        densityOrSignal: `derin öğrenme skoru ${Math.round(b.score * 100)}/100`,
        sizeMmStr: `≈ ${dia.toFixed(1)} mm (${wMm.toFixed(0)} × ${hMm.toFixed(0)} × ${zMm.toFixed(0)} mm)`,
        bbox, label: "Pulmoner nodül adayı (derin öğrenme)",
        detail:
          `Yerel derin öğrenme modeli (MONAI lung_nodule_ct_detection, LUNA16) bu seride ${nSl} kesitlik bölgede ` +
          `≈${dia.toFixed(1)} mm çapında solid yoğunlukta nodül adayı tespit etti (model skoru ${Math.round(b.score * 100)}/100, kalibre olasılık değil). ` +
          `Boysa göre Lung-RADS ${lungRads} eşiği (solid varsayımı, ön değerlendirme). ` +
          `Vasküler kesit, kalsifikasyon ve artefaktlar dışlanmalıdır; BULGU YAPAY ZEKA ÇIKTISIDIR VE RADYOLOJİ UZMANI TARAFINDAN ONAYLANMADAN GEÇERLİ DEĞİLDİR.`,
        category: "Nodül", severity,
        confidence: Math.max(0, Math.min(1, b.score)),
        confidenceKind: "heuristic" as const,
        source: "ai-model" as const,
        metrics: { maxDiameterMm: Number(dia.toFixed(1)), zExtentMm: Number(zMm.toFixed(1)), lungRads },
      } satisfies Finding;
    })
    .filter((f, i, arr) =>
      // aynı bölgeye çok yakın tekrarları ele (üst üste binen adaylar)
      arr.findIndex((g) => g.sliceStart <= f.sliceEnd && g.sliceEnd >= f.sliceStart && iou(f.bbox!, g.bbox!) > 0.5) === i
    );
}

function iou(a: BBox, b: BBox): number {
  const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h);
  if (x1 <= x0 || y1 <= y0) return 0;
  const inter = (x1 - x0) * (y1 - y0);
  return inter / (a.w * a.h + b.w * b.h - inter);
}

/**
 * Kural tabanlı ve derin öğrenme bulgularını birleştirir: aynı odakla örtüşen
 * kural tabanlı aday (kapsama > %25 + kesit kesişimi) derin model lehine çıkarılır
 * (maskesi de silinir); çakışmayanlar korunur.
 */
export function mergeDeepFindings(engineFindings: Finding[], deepFindings: Finding[]): { findings: Finding[]; dropped: string[] } {
  const dropped: string[] = [];
  const kept = engineFindings.filter((e) => {
    if (!e.bbox || e.category === "Sistem" || e.category === "ROI") return true;
    const dup = deepFindings.find(
      (d) => d.sliceStart <= e.sliceEnd && d.sliceEnd >= e.sliceStart && iou(e.bbox!, d.bbox!) > 0.25
    );
    if (dup) { dropped.push(e.id); return false; }
    return true;
  });
  return { findings: [...kept, ...deepFindings], dropped };
}