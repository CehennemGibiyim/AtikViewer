/**
 * Akciğer grafisi (CR/DX projeksiyon grafi) için kural tabanlı aday bulgu motoru.
 *
 * TAMAMEN YERLİ ve ÜCRETSİZ çalışır: hasta verisi ağa çıkmaz, ücretli servis çağrılmaz.
 * Derin öğrenme KULLANMAZ; gerçek piksel verisinden ölçüm yapar:
 *   gövde/akciğer maskesi (Otsu eşikleme + bağlantılı bileşen) → kolon bazlı diyafram profili
 *   → kardiyotorasik oran, kostofrenik açı/meniske ölçümü, dansite bileşenleri, periferik saydamlık.
 *
 * Ölçülen her şey ÖLÇÜMDÜR; yalnızca doğrulama kapısından geçen tipler "bulgu" olarak
 * gösterilir (bkz. cxrValidation.ts). Kapı kapalıysa ölçümler not olarak verilir,
 * bulgu üretilmez.
 */
import type { BBox, Finding, SeriesData, Severity } from "../types";
import type { EngineHooks } from "./engine";
import { cxrGate, cxrIsClinical, cxrValidationSentence, type CxrCategory } from "./cxrValidation";
import { CXR_VALIDATION_REPORT } from "./cxrValidationData";

/** Ölçülebilir eşikler (doğrulama raporuna yazılır). */
export const CXR_THRESHOLDS = {
  ctrUpperLimit: 0.5,
  /** Lateral kostofrenik eğim bu değerin altına düşerse açı küntleşmiş sayılır (mm). */
  effusionSlopeMm: 2,
  effusionBelowFraction: 0.45,
  consolidationMinDiaMm: 15,
  noduleMinDiaMm: 3,
  noduleMaxDiaMm: 15,
  noduleFillRatio: 0.6,
  ptxDarkFraction: 0.25,
  ptxAsymmetry: 0.12,
  maxWorkDim: 1024,
} as const;

const MAX_DIM = CXR_THRESHOLDS.maxWorkDim;

// ───────────── Görüntü işleme yardımcıları ─────────────

function histogram(v: Float32Array, mask?: Uint8Array): Int32Array {
  const H = new Int32Array(256);
  for (let i = 0; i < v.length; i++) {
    if (mask && !mask[i]) continue;
    let b = Math.round(v[i] * 255);
    if (b < 0) b = 0;
    else if (b > 255) b = 255;
    H[b]++;
  }
  return H;
}

/** Otsu eşiği; [0,1] aralığında normalize değer döndürür. */
function otsu(v: Float32Array, mask?: Uint8Array): number {
  const H = histogram(v, mask);
  let total = 0;
  let sum = 0;
  for (let i = 0; i < 256; i++) {
    total += H[i];
    sum += i * H[i];
  }
  if (total === 0) return 0.5;
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let bestVar = -1;
  for (let t = 0; t < 256; t++) {
    wB += H[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * H[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > bestVar) {
      bestVar = between;
      best = t;
    }
  }
  return best / 255;
}

interface Comp {
  pix: Int32Array;
  area: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  /** ağırlık merkezi */
  cx: number;
  cy: number;
}

function components(mask: Uint8Array, w: number, h: number, minArea: number): Comp[] {
  const n = w * h;
  const seen = new Uint8Array(n);
  const queue = new Int32Array(n);
  const out: Comp[] = [];
  for (let start = 0; start < n; start++) {
    if (!mask[start] || seen[start]) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    seen[start] = 1;
    let minX = w, maxX = -1, minY = h, maxY = -1, sx = 0, sy = 0;
    while (head < tail) {
      const p = queue[head++];
      const x = p % w;
      const y = (p / w) | 0;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      sx += x;
      sy += y;
      if (x > 0 && mask[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; queue[tail++] = p - 1; }
      if (x < w - 1 && mask[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; queue[tail++] = p + 1; }
      if (y > 0 && mask[p - w] && !seen[p - w]) { seen[p - w] = 1; queue[tail++] = p - w; }
      if (y < h - 1 && mask[p + w] && !seen[p + w]) { seen[p + w] = 1; queue[tail++] = p + w; }
    }
    if (tail < minArea) continue;
    out.push({ pix: queue.slice(0, tail), area: tail, minX, maxX, minY, maxY, cx: sx / tail, cy: sy / tail });
  }
  return out;
}

/** Maskenin deliklerini (kenara bağlanmayan boşlukları) doldurur. */
function fillHoles(mask: Uint8Array, w: number, h: number): Uint8Array {
  const n = w * h;
  const outside = new Uint8Array(n);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  const push = (i: number) => {
    if (!mask[i] && !outside[i]) { outside[i] = 1; queue[tail++] = i; }
  };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (head < tail) {
    const p = queue[head++];
    const x = p % w;
    const y = (p / w) | 0;
    if (x > 0) push(p - 1);
    if (x < w - 1) push(p + 1);
    if (y > 0) push(p - w);
    if (y < h - 1) push(p + w);
  }
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = mask[i] || !outside[i] ? 1 : 0;
  return out;
}

/** Ayrılabilir kutu erozyonu (dışarısı 0). */
function erode(src: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return src.slice();
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  const acc = new Int32Array(Math.max(w, h) + 1);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) acc[x + 1] = acc[x] + (src[y * w + x] ? 0 : 1);
    for (let x = r; x < w - r; x++) tmp[y * w + x] = acc[x + r + 1] - acc[x - r] === 0 ? 1 : 0;
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) acc[y + 1] = acc[y] + (tmp[y * w + x] ? 0 : 1);
    for (let y = r; y < h - r; y++) out[y * w + x] = acc[y + r + 1] - acc[y - r] === 0 ? 1 : 0;
  }
  return out;
}

/** Ayrılabilir kutu genişletmesi (dilation). */
function dilate(src: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return src.slice();
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  const acc = new Int32Array(Math.max(w, h) + 1);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) acc[x + 1] = acc[x] + (src[y * w + x] ? 1 : 0);
    for (let x = 0; x < w; x++) tmp[y * w + x] = acc[Math.min(w - 1, x + r) + 1] - acc[Math.max(0, x - r)] > 0 ? 1 : 0;
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) acc[y + 1] = acc[y] + (tmp[y * w + x] ? 1 : 0);
    for (let y = 0; y < h; y++) out[y * w + x] = acc[Math.min(h - 1, y + r) + 1] - acc[Math.max(0, y - r)] > 0 ? 1 : 0;
  }
  return out;
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * q)));
  return sorted[i];
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

// ───────────── Kare hazırlığı ─────────────

interface Prepared {
  w: number;
  h: number;
  /** çalışma pikseli başına mm */
  mmPerPx: number;
  v: Float32Array;
}

function prepare(series: SeriesData, index: number): Prepared {
  const sw = series.width;
  const sh = series.height;
  const src = series.slices[index];
  if (!src || src.length !== sw * sh) throw new Error(`Görüntü ${index + 1} piksel boyutu tutarsız; analiz durduruldu.`);
  const f = Math.max(1, Math.ceil(Math.max(sw, sh) / MAX_DIM));
  const w = Math.max(8, Math.floor(sw / f));
  const h = Math.max(8, Math.floor(sh / f));
  const v = new Float32Array(w * h);

  const step = Math.max(1, Math.floor((sw * sh) / 8192));
  const samples: number[] = [];
  for (let i = 0; i < sw * sh; i += step) {
    const s = src[i];
    if (Number.isFinite(s)) samples.push(s);
  }
  samples.sort((a, b) => a - b);
  const lo = quantile(samples, 0.01);
  const hi = quantile(samples, 0.99);
  const span = Math.max(1e-6, hi - lo);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = src[y * f * sw + x * f];
      v[y * w + x] = clamp01((s - lo) / span);
    }
  }

  // Polarite: MONOCHROME1 ise ya da çerçeve ortalaması merkezden parlak ise ters çevir
  // (akciğer grafisinde kenar hava = koyu olmalıdır).
  let borderSum = 0;
  let borderN = 0;
  let centreSum = 0;
  let centreN = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const val = v[y * w + x];
      const edge = x < w * 0.06 || x > w * 0.94 || y < h * 0.06 || y > h * 0.94;
      if (edge) { borderSum += val; borderN++; } else { centreSum += val; centreN++; }
    }
  }
  const declaredInverted = (series.photometric ?? "").toUpperCase().includes("MONOCHROME1");
  const looksInverted = borderN > 0 && centreN > 0 && borderSum / borderN > centreSum / centreN;
  if (declaredInverted || looksInverted) {
    for (let i = 0; i < v.length; i++) v[i] = 1 - v[i];
  }
  return { w, h, mmPerPx: (series.pixelSpacing || 1) * f, v };
}

// ───────────── Kare ölçümü ─────────────

interface Lung {
  side: "R" | "L";
  mask: Uint8Array;
  /** maskenin delikleri doldurulmuş hâli: akciğer içindeki yoğun lezyonlar da bu alandadır. */
  field: Uint8Array;
  area: number;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  /** kolon bazlı akciğer alt sınırı (yoksa -1) */
  bottom: Int32Array;
  /** akciğer içi yoğunluk persentilleri (normalize) */
  p05: number;
  p25: number;
  p50: number;
  p95: number;
  mean: number;
}

interface FrameInfo {
  prep: Prepared;
  body: Uint8Array;
  bodyCx: number;
  bodyTop: number;
  diaphragmY: number;
  thoraxWidthPx: number;
  softP50: number;
  ctr: number | null;
  heartBox: { x0: number; x1: number; y0: number; y1: number } | null;
  lungs: Lung[];
  notes: string[];
}

function extractLungs(
  v: Float32Array,
  body: Uint8Array,
  w: number,
  h: number,
  bodyCx: number,
  tSoft: number,
  /** Akciğere bu yarıçap (px) içinde komşu hava, plevral boşluk olarak alana eklenir. */
  airReachPx: number,
): Lung[] {
  const lungMask = new Uint8Array(w * h);
  for (let i = 0; i < v.length; i++) if (body[i] && v[i] < tSoft) lungMask[i] = 1;
  const minArea = Math.round(w * h * 0.004);
  const comps = components(lungMask, w, h, minArea);
  const lungs: Lung[] = [];
  for (const side of ["R", "L"] as const) {
    const pool = comps.filter((c) => (side === "R" ? c.cx < bodyCx : c.cx > bodyCx));
    if (!pool.length) continue;
    const best = pool.reduce((a, b) => (b.area > a.area ? b : a));
    const mask = new Uint8Array(w * h);
    for (let k = 0; k < best.pix.length; k++) mask[best.pix[k]] = 1;
    // Akciğer alanı: içindeki yoğun lezyonlar (konsolidasyon/nodül) delik doldurmayla alana girer.
    // Akciğere komşu hava (plevral çizgiyle ayrılmış pnömotoraks bandı) da alana eklenir; aksi hâlde
    // bu bant akciğer maskesinin dışında kalır ve hiç ölçülemez.
    const core = fillHoles(dilate(mask, w, h, 3), w, h);
    const reach = dilate(mask, w, h, airReachPx);
    const field = new Uint8Array(w * h);
    for (let i = 0; i < field.length; i++) {
      if (core[i]) field[i] = 1;
      else if (reach[i] && body[i] && v[i] < 0.12) field[i] = 1;
    }
    const bottom = new Int32Array(w).fill(-1);
    const values: number[] = [];
    for (let k = 0; k < best.pix.length; k++) {
      const p = best.pix[k];
      const x = p % w;
      const y = (p / w) | 0;
      if (y > bottom[x]) bottom[x] = y;
      values.push(v[p]);
    }
    values.sort((a, b) => a - b);
    const mean = values.reduce((s, x) => s + x, 0) / Math.max(1, values.length);
    lungs.push({
      side, mask, field, area: best.area,
      xMin: best.minX, xMax: best.maxX, yMin: best.minY, yMax: best.maxY,
      bottom,
      p05: quantile(values, 0.05), p25: quantile(values, 0.25), p50: quantile(values, 0.5), p95: quantile(values, 0.95),
      mean,
    });
  }
  return lungs;
}

function columnExtent(mask: Uint8Array, w: number, row: number): { min: number; max: number } | null {
  let min = -1;
  let max = -1;
  for (let x = 0; x < w; x++) {
    if (mask[row * w + x]) {
      if (min < 0) min = x;
      max = x;
    }
  }
  return min < 0 ? null : { min, max };
}

function measureFrame(series: SeriesData, index: number): FrameInfo {
  const prep = prepare(series, index);
  const { w, h, v } = prep;
  const notes: string[] = [];

  // 1) Gövde: hava seviyesinin hemen üstündeki tüm pikseller (akciğer de gövdenin parçasıdır).
  //    Global Otsu hava+akciğeri tek sınıf saydığı için eşik olarak kullanılamaz.
  const tBody = otsu(v);
  const rawBody = new Uint8Array(w * h);
  for (let i = 0; i < v.length; i++) if (v[i] > 0.12) rawBody[i] = 1;
  let bodyComps = components(rawBody, w, h, Math.round(w * h * 0.05));
  if (!bodyComps.length) {
    for (let i = 0; i < v.length; i++) if (v[i] > tBody) rawBody[i] = 1;
    bodyComps = components(rawBody, w, h, Math.round(w * h * 0.05));
  }
  if (!bodyComps.length) {
    notes.push("Gövde alanı bulunamadı (görüntü boyutu/kontrastı yetersiz olabilir).");
    return {
      prep, body: rawBody, bodyCx: w / 2, bodyTop: 0, diaphragmY: h - 1, thoraxWidthPx: w,
      softP50: 0.5, ctr: null, heartBox: null, lungs: [], notes,
    };
  }
  const bodyMask = new Uint8Array(w * h);
  const biggest = bodyComps.reduce((a, b) => (b.area > a.area ? b : a));
  for (let k = 0; k < biggest.pix.length; k++) bodyMask[biggest.pix[k]] = 1;
  const body = fillHoles(bodyMask, w, h);
  let sx = 0;
  let count = 0;
  for (let i = 0; i < body.length; i++) if (body[i]) { sx += i % w; count++; }
  const bodyCx = count ? sx / count : w / 2;

  // 2) Akciğer maskesi: gövde içindeki koyu (hava) bileşenleri, her yarımda en büyüğü.
  //    Eşik: gövde değerlerinin %20–%80 aralığının ortası (akciğer alt ucu, yumuşak doku üst ucu).
  const bodyValues: number[] = [];
  const bodyStep = Math.max(1, Math.floor(v.length / 20000));
  for (let i = 0; i < v.length; i += bodyStep) if (body[i]) bodyValues.push(v[i]);
  bodyValues.sort((a, b) => a - b);
  const b20 = quantile(bodyValues, 0.2);
  const b80 = quantile(bodyValues, 0.8);
  const tSoft = b20 + 0.45 * Math.max(0.02, b80 - b20);
  const lungs = extractLungs(v, body, w, h, bodyCx, tSoft, Math.round(30 / Math.max(0.1, prep.mmPerPx)));
  const bodyTop = biggest.minY;
  const bodyBottom = biggest.maxY;

  // Yumuşak doku (akciğer dışı) medyanı: eşik referansı
  const softValues: number[] = [];
  const softStep = Math.max(1, Math.floor(v.length / 12000));
  for (let i = 0; i < v.length; i += softStep) if (body[i] && v[i] >= tSoft) softValues.push(v[i]);
  softValues.sort((a, b) => a - b);
  const softP50 = quantile(softValues, 0.5) || tSoft;

  let diaphragmY = bodyBottom;
  let thoraxWidthPx = w;
  if (lungs.length) {
    const allBottoms: number[] = [];
    for (const lung of lungs) for (let x = lung.xMin; x <= lung.xMax; x++) if (lung.bottom[x] >= 0) allBottoms.push(lung.bottom[x]);
    allBottoms.sort((a, b) => a - b);
    diaphragmY = quantile(allBottoms, 0.75) || bodyBottom;
    const widths: number[] = [];
    for (let row = Math.max(bodyTop, Math.round(diaphragmY - h * 0.25)); row <= diaphragmY; row++) {
      const ext = columnExtent(body, w, row);
      if (ext) widths.push(ext.max - ext.min + 1);
    }
    widths.sort((a, b) => a - b);
    thoraxWidthPx = quantile(widths, 0.5) || w;
  } else {
    notes.push("Akciğer alanları ayrıştırılamadı; kardiyotorasik oran ve akciğer ölçümleri hesaplanamadı.");
  }

  // 3) Kardiyotorasik oran: kalp/mediasten silueti = iki akciğer arasındaki en geniş aralık.
  //    (Yoğunluk sütunu eşiği diyafram/abdomen ile karışıyordu; sınır tabanlı ölçüm daha sağlam.)
  let ctr: number | null = null;
  let heartBox: FrameInfo["heartBox"] = null;
  if (lungs.length === 2 && thoraxWidthPx > 20) {
    const rows = lungs.map((lung) => {
      const min = new Int32Array(h).fill(-1);
      const max = new Int32Array(h).fill(-1);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (!lung.mask[y * w + x]) continue;
          if (min[y] < 0) min[y] = x;
          max[y] = x;
        }
      }
      return { min, max };
    });
    const [ri, li] = lungs[0].side === "R" ? [0, 1] : [1, 0];
    const maxRowWidth = (i: number) => {
      let best = 0;
      for (let y = 0; y < h; y++) if (rows[i].min[y] >= 0) best = Math.max(best, rows[i].max[y] - rows[i].min[y] + 1);
      return best;
    };
    const rMaxW = maxRowWidth(ri);
    const lMaxW = maxRowWidth(li);
    const lungTop = Math.min(lungs[0].yMin, lungs[1].yMin);
    const yStart = Math.round(lungTop + (diaphragmY - lungTop) * 0.25);
    const yEnd = Math.round(diaphragmY - h * 0.02);
    let bestGap = 0;
    let bestRow = -1;
    for (let y = Math.max(0, yStart); y <= yEnd && y < h; y++) {
      const rMin = rows[ri].min[y];
      const rMax = rows[ri].max[y];
      const lMin = rows[li].min[y];
      const lMax = rows[li].max[y];
      if (rMin < 0 || lMin < 0) continue;
      // Her iki akciğer de bu satırda anlamlı genişlikte olmalı (ince dilimler sayılmasın).
      if (rMax - rMin + 1 < rMaxW * 0.12 || lMax - lMin + 1 < lMaxW * 0.12) continue;
      const gap = lMin - rMax;
      if (gap > bestGap) { bestGap = gap; bestRow = y; }
    }
    if (bestRow >= 0 && bestGap > 4 && bestGap <= thoraxWidthPx * 0.7) {
      ctr = bestGap / thoraxWidthPx;
      heartBox = {
        x0: rows[ri].max[bestRow],
        x1: rows[li].min[bestRow],
        y0: Math.max(bodyTop, bestRow - Math.round(h * 0.12)),
        y1: yEnd,
      };
    }
  }

  return { prep, body, bodyCx, bodyTop, diaphragmY, thoraxWidthPx, softP50, ctr, heartBox, lungs, notes };
}

// ───────────── Aday bulgular ─────────────

interface Candidate {
  category: CxrCategory;
  bbox: BBox | null;
  score: number;
  severity: Severity;
  label: string;
  location: string;
  measure: string;
  detail: string;
  sizeMmStr: string;
  density: string;
  metrics: Finding["metrics"];
}

const SEV_ORDER: Record<Severity, number> = { kritik: 4, yuksek: 3, orta: 2, dusuk: 1, normal: 0 };

/** Sentetik doğrulama setiyle çalışırken öncelik "orta"yı aşmaz (kritik bildirim üretilmez). */
function capped(sev: Severity): Severity {
  if (cxrIsClinical()) return sev;
  return SEV_ORDER[sev] > SEV_ORDER.orta ? "orta" : sev;
}

function sideName(lung: Lung): string {
  return lung.side === "R" ? "Sağ akciğer (görüntü solu)" : "Sol akciğer (görüntü sağı)";
}

function normBox(x0: number, x1: number, y0: number, y1: number, w: number, h: number): BBox {
  const bx = Math.max(0, Math.min(1, x0 / w));
  const by = Math.max(0, Math.min(1, y0 / h));
  return {
    x: bx,
    y: by,
    w: Math.max(0.005, Math.min(1 - bx, (x1 - x0 + 1) / w)),
    h: Math.max(0.005, Math.min(1 - by, (y1 - y0 + 1) / h)),
  };
}

function detectCandidates(frame: FrameInfo): Candidate[] {
  const { prep, lungs, ctr, heartBox, bodyCx, diaphragmY, softP50, body } = frame;
  const { w, h, v, mmPerPx } = prep;
  const out: Candidate[] = [];

  // ── Kardiyomegali ──
  if (ctr !== null && heartBox) {
    const expanded = ctr >= CXR_THRESHOLDS.ctrUpperLimit;
    if (expanded) {
      const widthMm = (heartBox.x1 - heartBox.x0 + 1) * mmPerPx;
      out.push({
        category: "Kardiyomegali",
        bbox: normBox(heartBox.x0, heartBox.x1, heartBox.y0, heartBox.y1, w, h),
        score: clamp01((ctr - CXR_THRESHOLDS.ctrUpperLimit) / 0.18),
        severity: capped(ctr >= 0.58 ? "yuksek" : "orta"),
        label: "Kardiyomegali adayı (kardiyotorasik oran artmış)",
        location: "Kalp silueti / toraks orta hattı",
        measure: `Kardiyotorasik oran (KTO) %${(ctr * 100).toFixed(0)}; kalp silueti genişliği ≈${widthMm.toFixed(0)} mm.`,
        sizeMmStr: `kalp genişliği ≈${widthMm.toFixed(0)} mm`,
        density: `KTO %${(ctr * 100).toFixed(0)}`,
        detail:
          `Diyafram üstü orta bantta yoğun sütun genişliği toraks genişliğine oranlandı: KTO %${(ctr * 100).toFixed(0)} ` +
          `(erişkin PA grafide üst sınır ≈%${Math.round(CXR_THRESHOLDS.ctrUpperLimit * 100)}). ` +
          `AP/supin pozisyon, rotasyon ve inspirasyon derinliği KTO'yu yapay olarak artırır; ekokardiyografi ile doğrulanmalıdır.`,
        metrics: { ctrPercent: Number((ctr * 100).toFixed(1)) },
      });
    }
  }

  const lungDenseCut = (lung: Lung) => lung.p50 + 0.5 * Math.max(0.02, softP50 - lung.p50);

  // ── Plevral efüzyon (kostofrenik açı / meniske) ──
  for (const lung of lungs) {
    const lateralEnd = lung.side === "R" ? lung.xMin : lung.xMax;
    const medialEnd = lung.side === "R" ? lung.xMax : lung.xMin;
    const span = Math.abs(medialEnd - lateralEnd) + 1;
    const dir = lung.side === "R" ? 1 : -1;
    const lateralCols: number[] = [];
    for (let k = 0; k <= Math.round(span * 0.35); k++) {
      const x = lateralEnd + dir * k;
      if (x >= lung.xMin && x <= lung.xMax && lung.bottom[x] >= 0) lateralCols.push(x);
    }
    /** Lateral kenardan içeri doğru (yüzde aralığı) akciğer tabanı y değerleri. */
    const bottomBand = (fromFrac: number, toFrac: number): number[] => {
      const vals: number[] = [];
      for (let k = Math.round(span * fromFrac); k <= Math.round(span * toFrac); k++) {
        const x = lateralEnd + dir * k;
        if (x >= lung.xMin && x <= lung.xMax && lung.bottom[x] >= 0) vals.push(lung.bottom[x]);
      }
      return vals.sort((a, b) => a - b);
    };
    // Lateral kostofrenik açının şekli: dış bant (kenara komşu) ile 20–35% içerideki bant.
    const outerBottoms = bottomBand(0, 0.08);
    const innerBottoms = bottomBand(0.2, 0.35);
    if (!lateralCols.length || !outerBottoms.length || !innerBottoms.length) continue;
    const bOuter = quantile(outerBottoms, 0.5);
    const bInner = quantile(innerBottoms, 0.5);
    // Normalde akciğer tabanı laterale doğru İNER (pozitif eğim). Sıvı birikince lateral taban
    // yükselir, eğim sıfıra/negatife döner ve kostofrenik açı küntleşir.
    const edgeSlopeMm = (bOuter - bInner) * mmPerPx;
    const lateralRiseMm = Math.max(0, (bInner - bOuter) * mmPerPx);

    // Akciğer alt sınırının altında yoğun (sıvı) alan oranı
    const effThresh = lung.p50 + 0.4 * Math.max(0.02, softP50 - lung.p50);
    const searchDepth = Math.max(3, Math.round(h * 0.12));
    let denseCount = 0;
    let sampleCount = 0;
    let dx0 = w, dx1 = -1, dy0 = h, dy1 = -1;
    for (const x of lateralCols) {
      for (let y = lung.bottom[x] + 1; y <= Math.min(h - 1, lung.bottom[x] + searchDepth); y++) {
        sampleCount++;
        if (v[y * w + x] >= effThresh) {
          denseCount++;
          if (x < dx0) dx0 = x;
          if (x > dx1) dx1 = x;
          if (y < dy0) dy0 = y;
          if (y > dy1) dy1 = y;
        }
      }
    }
    const belowFraction = sampleCount ? denseCount / sampleCount : 0;
    const effusion = edgeSlopeMm <= CXR_THRESHOLDS.effusionSlopeMm && belowFraction >= CXR_THRESHOLDS.effusionBelowFraction;
    if (!effusion) continue;
    out.push({
      category: "Plevral efüzyon",
      bbox: dx1 > dx0 ? normBox(dx0, dx1, Math.min(dy0, bOuter), Math.max(dy1, bOuter), w, h) : null,
      score: clamp01(0.55 * clamp01(lateralRiseMm / 20) + 0.45 * belowFraction),
      severity: capped(lateralRiseMm >= 12 || belowFraction >= 0.9 ? "orta" : "dusuk"),
      label: "Plevral efüzyon adayı (kostofrenik açı küntleşmiş)",
      location: `${sideName(lung)}, lateral kostofrenik bölge`,
      measure: `Lateral kostofrenik taban eğimi ${edgeSlopeMm.toFixed(1)} mm (normalde pozitif), lateral yükselme ≈${lateralRiseMm.toFixed(0)} mm; taban altı yoğunluk oranı %${(belowFraction * 100).toFixed(0)}.`,
      sizeMmStr: `meniske yüksekliği ≈${lateralRiseMm.toFixed(0)} mm`,
      density: `akciğer p50 ${lung.p50.toFixed(2)} / yumuşak doku p50 ${softP50.toFixed(2)}`,
      detail:
        `Kostofrenik bölgede akciğer alt sınırının laterale inişi kaybolmuş (eğim ${edgeSlopeMm.toFixed(1)} mm) ve taban altında ` +
        `yumuşak doku yoğunluğu %${(belowFraction * 100).toFixed(0)} oranında devam ediyor; lateral yükselme ≈${lateralRiseMm.toFixed(0)} mm. ` +
        `Plevral efüzyon, plevral kalınlaşma ve diyafram elevasyonu ayırt edilmelidir (yan grafi / US).`,
      metrics: {},
    });
  }

  // ── Dansite bileşenleri: konsolidasyon ve nodül ──
  const denseRegions = (lung: Lung) => {
    const cut = lungDenseCut(lung);
    const mask = new Uint8Array(w * h);
    for (let i = 0; i < v.length; i++) if (lung.field[i] && v[i] >= cut) mask[i] = 1;
    return components(mask, w, h, Math.max(6, Math.round(Math.PI * 4 / (mmPerPx * mmPerPx))));
  };

  const effusionBoxes = out.filter((c) => c.category === "Plevral efüzyon" && c.bbox).map((c) => c.bbox!);
  const overlapsEffusion = (b: BBox) => effusionBoxes.some((e) => b.x < e.x + e.w && b.x + b.w > e.x && b.y < e.y + e.h && b.y + b.h > e.y);

  for (const lung of lungs) {
    for (const comp of denseRegions(lung)) {
      const wPx = comp.maxX - comp.minX + 1;
      const hPx = comp.maxY - comp.minY + 1;
      const fill = comp.area / (wPx * hPx);
      const diaMm = 2 * Math.sqrt(comp.area / Math.PI) * mmPerPx;
      const aspect = Math.max(wPx / hPx, hPx / wPx);
      const box = normBox(comp.minX, comp.maxX, comp.minY, comp.maxY, w, h);
      if (overlapsEffusion(box)) continue;
      const nearMediastinum = Math.abs(comp.cx - bodyCx) < w * 0.05;
      const touchesBorder = comp.minX <= lung.xMin + 1 || comp.maxX >= lung.xMax - 1 || comp.minY <= lung.yMin + 1 || comp.maxY >= lung.yMax - 1;

      if (diaMm >= CXR_THRESHOLDS.consolidationMinDiaMm && diaMm <= 120 && fill >= 0.3) {
        out.push({
          category: "Konsolidasyon",
          bbox: box,
          score: clamp01(0.5 * clamp01(diaMm / 60) + 0.5 * clamp01(fill / 0.8)),
          severity: capped(diaMm >= 40 ? "orta" : "dusuk"),
          label: "Konsolidasyon / infiltrat adayı",
          location: `${sideName(lung)}, ${comp.cy < lung.yMin + (lung.yMax - lung.yMin) * 0.4 ? "üst" : comp.cy > lung.yMin + (lung.yMax - lung.yMin) * 0.6 ? "alt" : "orta"} zon`,
          measure: `Akciğer içi yoğun alan ≈${diaMm.toFixed(0)} mm (${(wPx * mmPerPx).toFixed(0)}×${(hPx * mmPerPx).toFixed(0)} mm), doluluk %${(fill * 100).toFixed(0)}.`,
          sizeMmStr: `≈${diaMm.toFixed(0)} mm`,
          density: `ortalamanın üzerinde dansite (eşik akciğer p50 + 0.5·(yumuşak doku − akciğer))`,
          detail:
            `Akciğer alanı içinde komşu hava ile çevrili, ≈${diaMm.toFixed(0)} mm çaplı (${(wPx * mmPerPx).toFixed(0)}×${(hPx * mmPerPx).toFixed(0)} mm) ` +
            `homojen yoğunluk artışı ölçüldü. Konsolidasyon, atelektazi, kitle ve plevral sıvı ayrımı için ` +
            `yan grafi ve/veya BT gerekir; silik sınırlı infiltratlar bu eşiğin altında kalabilir.`,
          metrics: { maxDiameterMm: Number(diaMm.toFixed(1)) },
        });
        continue;
      }

      if (
        diaMm >= CXR_THRESHOLDS.noduleMinDiaMm && diaMm <= CXR_THRESHOLDS.noduleMaxDiaMm &&
        fill >= CXR_THRESHOLDS.noduleFillRatio && aspect <= 1.8 && !nearMediastinum && !touchesBorder
      ) {
        out.push({
          category: "Nodül",
          bbox: box,
          score: clamp01(0.5 * clamp01(diaMm / 12) + 0.5 * clamp01(fill)),
          severity: "dusuk",
          label: "Pulmoner nodül adayı (projeksiyon grafi)",
          location: `${sideName(lung)}, ${comp.cy < lung.yMin + (lung.yMax - lung.yMin) * 0.4 ? "üst" : comp.cy > lung.yMin + (lung.yMax - lung.yMin) * 0.6 ? "alt" : "orta"} zon`,
          measure: `Yuvarlak yoğun odak ≈${diaMm.toFixed(0)} mm, doluluk %${(fill * 100).toFixed(0)}.`,
          sizeMmStr: `≈${diaMm.toFixed(0)} mm`,
          density: `yuvarlak, kompakt dansite artışı`,
          detail:
            `Akciğer içinde ≈${diaMm.toFixed(0)} mm çaplı, yuvarlak/kompakt dansite artışı ölçüldü. ` +
            `Projeksiyon grafide damar kesiti, kemik süperpozisyonu ve meme gölgesi nodül taklidi yapar; ` +
            `gerçek boyut ve solidite için BT gerekir.`,
          metrics: { maxDiameterMm: Number(diaMm.toFixed(1)) },
        });
      }
    }
  }

  // ── Pnömotoraks: periferik avasküler bant ──
  if (lungs.length === 2) {
    // Pnömotoraks, akciğer ile göğüs duvarı ARASINDAKİ plevral boşlukta hava olarak görünür.
    // Ölçüm: akciğer alanına ~12 mm komşu, akciğer ve gövde içinde kalan bölgede hava oranı.
    // Ölçüm: akciğerin LATERAL %22 şeridinin üst %60'ında hava yoğunluğu. Normal akciğerde bu
    // şerit damarlı parankimdir (akciğer medyanı civarı); pnömotoraksta hava kadar koyudur.
    const airCut = Math.max(0.06, ((lungs[0].p50 + lungs[1].p50) / 2) * 0.4);
    const stats = lungs.map((lung) => {
      const span = lung.xMax - lung.xMin + 1;
      const stripW = Math.max(4, Math.round(span * 0.22));
      const yTop = lung.yMin;
      const yBot = Math.round(lung.yMin + (lung.yMax - lung.yMin) * 0.6);
      let count = 0;
      let air = 0;
      for (let y = yTop; y <= yBot; y++) {
        for (let k = 0; k < stripW; k++) {
          const x = lung.side === "R" ? lung.xMin + k : lung.xMax - k;
          const i = y * w + x;
          if (!lung.field[i]) continue;
          count++;
          if (v[i] < airCut) air++;
        }
      }
      return { lung, airFraction: count ? air / count : 0, samples: count };
    });
    for (const s of stats) {
      const other = stats.find((o) => o.lung !== s.lung)!;
      const asymmetry = s.airFraction - other.airFraction;
      if (s.airFraction >= CXR_THRESHOLDS.ptxDarkFraction && asymmetry >= CXR_THRESHOLDS.ptxAsymmetry) {
        const bandMm = (s.lung.xMax - s.lung.xMin + 1) * mmPerPx * 0.15;
        out.push({
          category: "Pnömotoraks",
          bbox: normBox(s.lung.xMin, s.lung.xMax, s.lung.yMin, s.lung.yMin + (s.lung.yMax - s.lung.yMin) * 0.55, w, h),
          score: clamp01(0.6 * clamp01((s.airFraction - 0.25) / 0.5) + 0.4 * clamp01(asymmetry / 0.4)),
          severity: capped("orta"),
          label: "Pnömotoraks adayı (periferik avasküler bant)",
          location: `${sideName(s.lung)}, apeks/periferik bölge`,
          measure: `Lateral periferik şeritte hava oranı %${(s.airFraction * 100).toFixed(0)} (karşı taraf %${(other.airFraction * 100).toFixed(0)}).`,
          sizeMmStr: `periferik bant ≈${bandMm.toFixed(0)} mm kalınlık tahmini`,
          density: `periferik hava indeksi ${s.airFraction.toFixed(2)} / asimetri ${asymmetry.toFixed(2)}`,
          detail:
            `Akciğerin lateral periferik şeridinde hava yoğunluğu %${(s.airFraction * 100).toFixed(0)} oranında ölçüldü ` +
            `(karşı taraf %${(other.airFraction * 100).toFixed(0)}). Plevral çizgi, cilt katlantısı ve yamalı saydamlık ayırt edilmelidir; ` +
            `kuşkulu olguda inspiryum/ekspiryum grafileri veya BT gerekir.`,
          metrics: {},
        });
      }
    }
  }

  return out;
}

// ───────────── Dışa açılan akış ─────────────

export interface CxrOutput {
  findings: Finding[];
  notes: string[];
}

/** Akciğer grafisi dedektörü bu seri için uygun mu? Uygunsa null, değilse gerekçe. */
export function cxrEligible(s: SeriesData): string | null {
  if (s.specialType && s.specialType !== "image") return "seri bir görüntü serisi değil (belge/EKG)";
  if (s.isColor || (s.rgbaSlices?.length ?? 0) > 0) return "renkli (RGB) görüntü";
  if (!s.slices.length) return "görüntü yok";
  if (s.width < 128 || s.height < 128) return `görüntü boyutu çok küçük (${s.width}×${s.height})`;
  const modality = s.modality.trim().toUpperCase();
  if (modality !== "CR" && modality !== "DX") {
    return `modalite ${s.modality || "?"} — akciğer grafisi dedektörü yalnızca CR/DX projeksiyon grafilerinde çalışır`;
  }
  return null;
}

const frameWord = (_s: SeriesData) => "Görüntü";

export interface CxrRawHit {
  category: CxrCategory;
  score: number;
  measure: string;
}

/**
 * Doğrulama ölçümü için ham dedektör çıktısı: DOĞRULAMA KAPISI UYGULANMAZ.
 * Yalnızca scripts/cxr-validate.ts ve testler kullanır; klinik akışta çağrılmaz.
 */
export function detectCxrCategories(series: SeriesData): CxrRawHit[] {
  const hits: CxrRawHit[] = [];
  const seen = new Set<CxrCategory>();
  for (let index = 0; index < series.slices.length; index++) {
    const frame = measureFrame(series, index);
    for (const c of detectCandidates(frame)) {
      if (seen.has(c.category)) continue;
      seen.add(c.category);
      hits.push({ category: c.category, score: c.score, measure: c.measure });
    }
  }
  return hits;
}

export async function runChestXray(series: SeriesData, hooks: EngineHooks): Promise<CxrOutput | null> {
  const reason = cxrEligible(series);
  if (reason) throw new Error(`Akciğer grafisi analizi uygulanamaz: ${reason}`);
  if (hooks.aborted()) return null;

  const notes: string[] = [];
  const findings: Finding[] = [];
  const report = CXR_VALIDATION_REPORT;
  const clinical = cxrIsClinical(report);
  let yielded = 0;

  for (let index = 0; index < series.slices.length; index++) {
    if (hooks.aborted()) return null;
    const frame = measureFrame(series, index);
    notes.push(...frame.notes.map((n) => `${frameWord(series)} ${index + 1}: ${n}`));
    const candidates = detectCandidates(frame);
    const { w, h, v, mmPerPx } = frame.prep;

    // Ölçüm kartı: her karede gerçekten hesaplanan nicel değerler (bulgu değildir).
    const lungText = frame.lungs.length
      ? frame.lungs
          .map((l) => {
            const areaMm2 = l.area * mmPerPx * mmPerPx;
            return `${l.side === "R" ? "sağ" : "sol"} akciğer alanı ${(areaMm2 / 100).toFixed(0)} cm², ortalama sinyal ${l.mean.toFixed(2)}, p50 ${l.p50.toFixed(2)}`;
          })
          .join("; ")
      : "akciğer alanı ayrıştırılamadı";
    const ctrText = frame.ctr !== null ? `KTO %${(frame.ctr * 100).toFixed(1)}` : "KTO hesaplanamadı";
    findings.push({
      id: `cxr-m${index + 1}`,
      sliceIndex: index,
      sliceStart: index,
      sliceEnd: index,
      keySliceNumber: index + 1,
      sliceRangeStr: `${frameWord(series)} ${index + 1}`,
      anatomicalLocation: "—",
      densityOrSignal: `${ctrText} · ${series.width}×${series.height} piksel`,
      sizeMmStr: `${(frame.thoraxWidthPx * mmPerPx).toFixed(0)} mm toraks genişliği`,
      bbox: null,
      label: "Akciğer grafisi nicel ölçümleri",
      detail:
        `${ctrText}; ${lungText}; diyafram düzeyi ${(frame.diaphragmY / h * 100).toFixed(0)}% yükseklikte. ` +
        `Bu kart ölçümdür, tanı değildir. Aday bulgular yalnızca kendi verimizde duyarlılık/özgüllük ölçülen tiplerde gösterilir ` +
        `(${clinical ? "klinik" : "sentetik phantom"} doğrulama seti, ${report.dataset.cases} vaka).`,
      category: "Sistem",
      severity: "normal",
      confidence: 0,
      confidenceKind: "none",
      source: "cv-heuristic",
    });

    for (const c of candidates) {
      const gate = cxrGate(c.category, report);
      if (!gate.unlocked || !gate.metrics) {
        notes.push(
          `${frameWord(series)} ${index + 1}: ${c.category} ölçüldü (${c.measure}) ancak bulgu olarak gösterilmedi — ${gate.reason}.`,
        );
        continue;
      }
      findings.push({
        id: `cxr-${findingIdSafe(c.category)}-${index + 1}-${yielded++}`,
        sliceIndex: index,
        sliceStart: index,
        sliceEnd: index,
        keySliceNumber: index + 1,
        sliceRangeStr: `${frameWord(series)} ${index + 1}`,
        zLocationMm: undefined,
        anatomicalLocation: c.location,
        densityOrSignal: c.density,
        sizeMmStr: c.sizeMmStr,
        bbox: c.bbox,
        label: c.label,
        detail: `${c.detail} ${cxrValidationSentence(report, gate.metrics)} ADAY BULGUDUR; radyoloji uzmanı onayı olmadan geçerli değildir.`,
        category: c.category,
        severity: c.severity,
        confidence: c.score,
        confidenceKind: "heuristic",
        source: "cv-heuristic",
        metrics: c.metrics,
      });
    }

    // Kare bazlı parlaklık bilgisi tek satır (görüntü kalitesi göstergesi, bulgu değil)
    let sum = 0;
    for (let i = 0; i < v.length; i++) sum += v[i];
    notes.push(
      `${frameWord(series)} ${index + 1}: ortalama parlaklık ${(sum / v.length).toFixed(2)} (0–1 normalize), ` +
        `çalışma çözünürlüğü ${w}×${h}, ${mmPerPx.toFixed(2)} mm/piksel.`,
    );
    await hooks.onSlice(index, series.slices.length);
  }

  if (hooks.aborted()) return null;
  if (!clinical) {
    notes.push(
      "Doğrulama kapısı: bulgu tipleri yalnızca kendi verimizde ölçülen duyarlılık/özgüllük ile birlikte gösterilir. " +
        "Mevcut rapor SENTETİK (phantom) setten gelir; gerçek hasta verisiyle klinik doğrulama yapılmamıştır.",
    );
  }
  return { findings, notes };
}

function findingIdSafe(category: CxrCategory): string {
  return category
    .toLowerCase()
    .replace(/ı/g, "i").replace(/ü/g, "u").replace(/ö/g, "o").replace(/ş/g, "s").replace(/ç/g, "c").replace(/ğ/g, "g")
    .replace(/[^a-z0-9]+/g, "-");
}
