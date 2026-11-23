import type { AiProtocol, BBox, Finding, Pixels, SeriesData, Severity } from "../types";

/**
 * Kural tabanlı aday bulgu motoru (derin öğrenme DEĞİL, klinik olarak doğrulanmamış).
 * Piksel verisinden gerçekten hesaplar: HU eşikleme → kafatası/akciğer maskesi → kesit başına 2B bileşenler →
 * kesitler arası örtüşmeyle 3B birleştirme → boyut/şekil süzgeci → ölçümler.
 */
export type Protocol = "ct-head" | "ct-chest" | "image-review" | "none";

/** Otomatik mod: tanımlı BT dedektörü yoksa gerçek piksel incelemesine düş; tanı uydurma. */
export function resolveProtocol(s: SeriesData, req: AiProtocol): Protocol {
  if (req === "none" || (s.specialType && s.specialType !== "image") || !s.slices.length) return "none";
  if (req === "review") return "image-review";
  const huCt = s.modality.toUpperCase() === "CT" && s.unit === "HU" && !s.isColor && s.slices.length >= 5;
  if (req === "ct-head" || req === "ct-chest") return huCt ? req : "image-review";
  if (huCt) {
    const txt = `${s.bodyPart} ${s.description}`.toUpperCase().replace(/İ/g, "I").replace(/Ş/g, "S").replace(/Ö/g, "O");
    if (/(HEAD|BRAIN|BEYIN|KAFA|NEURO|CRANI)/.test(txt)) return "ct-head";
    if (/(CHEST|THORAX|THORAC|TORAKS|TORAX|LUNG|AKCIGER)/.test(txt)) return "ct-chest";
  }
  return "image-review";
}

export interface EngineOutput {
  findings: Finding[];
  /** bulgu id → kesit → maske (genişlik×yükseklik, 0/1) */
  masks: Map<string, Map<number, Uint8Array>>;
  notes: string[];
}

export interface EngineHooks {
  onSlice: (slice: number, total: number) => Promise<void>;
  aborted: () => boolean;
}

interface Comp2D {
  slice: number;
  gid: number;
  pix: Int32Array;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  sum: number;
  sumSq: number;
  max: number;
}

// ───────────── Görüntü işleme yardımcıları ─────────────
/** blocked olmayan ve kenara 4-bağlantılı ulaşabilen pikselleri 1 yapar. */
function floodBorder(blocked: Uint8Array, w: number, h: number): Uint8Array {
  const reach = new Uint8Array(w * h);
  const q = new Int32Array(w * h);
  let t = 0;
  const push = (i: number) => {
    if (!blocked[i] && !reach[i]) {
      reach[i] = 1;
      q[t++] = i;
    }
  };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  let hd = 0;
  while (hd < t) {
    const p = q[hd++];
    const x = p % w;
    const y = (p / w) | 0;
    if (x > 0) push(p - 1);
    if (x < w - 1) push(p + 1);
    if (y > 0) push(p - w);
    if (y < h - 1) push(p + w);
  }
  return reach;
}

/** Ayrılabilir kutu erozyonu (dışarısı 0 sayılır). */
function erodeBox(src: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  const pz = new Int32Array(Math.max(w, h) + 1);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) pz[x + 1] = pz[x] + (src[y * w + x] ? 0 : 1);
    for (let x = r; x < w - r; x++) tmp[y * w + x] = pz[x + r + 1] - pz[x - r] === 0 ? 1 : 0;
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) pz[y + 1] = pz[y] + (tmp[y * w + x] ? 0 : 1);
    for (let y = r; y < h - r; y++) out[y * w + x] = pz[y + r + 1] - pz[y - r] === 0 ? 1 : 0;
  }
  return out;
}

/** Ayrılabilir kutu genişletme (dilation). */
function dilateBox(src: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  const pc = new Int32Array(Math.max(w, h) + 1);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) pc[x + 1] = pc[x] + (src[y * w + x] ? 1 : 0);
    for (let x = 0; x < w; x++) tmp[y * w + x] = pc[Math.min(w - 1, x + r) + 1] - pc[Math.max(0, x - r)] > 0 ? 1 : 0;
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) pc[y + 1] = pc[y] + (tmp[y * w + x] ? 1 : 0);
    for (let y = 0; y < h; y++) out[y * w + x] = pc[Math.min(h - 1, y + r) + 1] - pc[Math.max(0, y - r)] > 0 ? 1 : 0;
  }
  return out;
}

function label2D(mask: Uint8Array, w: number, h: number, minArea: number, slice: number, hu: Pixels): { comps: Comp2D[]; labels: Int32Array } {
  const n = w * h;
  const labels = new Int32Array(n);
  const seen = new Uint8Array(n);
  const q = new Int32Array(n);
  const comps: Comp2D[] = [];
  for (let i = 0; i < n; i++) {
    if (!mask[i] || seen[i]) continue;
    let hd = 0;
    let t = 0;
    q[t++] = i;
    seen[i] = 1;
    let minX = w, maxX = 0, minY = h, maxY = 0, sum = 0, sumSq = 0, max = -Infinity;
    while (hd < t) {
      const p = q[hd++];
      const x = p % w;
      const y = (p / w) | 0;
      const v = hu[p];
      sum += v; sumSq += v * v; if (v > max) max = v;
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (x > 0 && mask[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; q[t++] = p - 1; }
      if (x < w - 1 && mask[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; q[t++] = p + 1; }
      if (y > 0 && mask[p - w] && !seen[p - w]) { seen[p - w] = 1; q[t++] = p - w; }
      if (y < h - 1 && mask[p + w] && !seen[p + w]) { seen[p + w] = 1; q[t++] = p + w; }
    }
    if (t < minArea) continue;
    const pix = q.slice(0, t);
    const id = comps.length + 1;
    for (let k = 0; k < t; k++) labels[pix[k]] = id;
    comps.push({ slice, gid: -1, pix, minX, maxX, minY, maxY, sum, sumSq, max });
  }
  return { comps, labels };
}

// ───────────── Kesit dedektörleri ─────────────
interface SliceResult {
  cand: Uint8Array;
  ok: boolean;
  midX: number;
  midY: number;
}

function headSlice(sl: Pixels, w: number, h: number, pxMm: number): SliceResult {
  const n = w * h;
  const empty = { cand: new Uint8Array(n), ok: false, midX: w / 2, midY: h / 2 };
  const bone = new Uint8Array(n);
  let bc = 0;
  for (let i = 0; i < n; i++) if (sl[i] > 300) { bone[i] = 1; bc++; }
  if (bc < n * 0.003) return empty;
  const reach = floodBorder(bone, w, h);
  const inside = new Uint8Array(n);
  let ins = 0, sx = 0, sy = 0;
  for (let i = 0; i < n; i++) if (!bone[i] && !reach[i]) { inside[i] = 1; ins++; sx += i % w; sy += (i / w) | 0; }
  if (ins < n * 0.02) return empty;
  const core = erodeBox(inside, w, h, Math.max(2, Math.round(4 / pxMm)));
  const cand = new Uint8Array(n);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!core[i]) continue;
      const m = (sl[i - w - 1] + sl[i - w] + sl[i - w + 1] + sl[i - 1] + sl[i] + sl[i + 1] + sl[i + w - 1] + sl[i + w] + sl[i + w + 1]) / 9;
      if (m >= 52 && m <= 95) cand[i] = 1;
    }
  }
  // Morfolojik açma: ~4 mm'den ince yapıları (falks, sinüs çizgisi, kenar artefaktı) ele; kalın odakların şeklini koru.
  const ro = Math.max(1, Math.round(1.8 / pxMm));
  const opened = dilateBox(erodeBox(cand, w, h, ro), w, h, ro);
  for (let i = 0; i < n; i++) if (!opened[i]) cand[i] = 0;
  return { cand, ok: true, midX: sx / ins, midY: sy / ins };
}

function chestSlice(sl: Pixels, w: number, h: number): SliceResult {
  const n = w * h;
  const empty = { cand: new Uint8Array(n), ok: false, midX: w / 2, midY: h / 2 };
  const notAir = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (sl[i] >= -320) notAir[i] = 1;
  const outsideAir = floodBorder(notAir, w, h); // kenara bağlı hava = vücut dışı
  const lung = new Uint8Array(n);
  let lc = 0, sx = 0, sy = 0;
  for (let i = 0; i < n; i++) if (!notAir[i] && !outsideAir[i]) { lung[i] = 1; lc++; sx += i % w; sy += (i / w) | 0; }
  if (lc < n * 0.01) return empty;
  const reach = floodBorder(lung, w, h);
  const cand = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (!reach[i] && !lung[i] && sl[i] > -300) cand[i] = 1; // akciğer içine gömülü yumuşak doku
  return { cand, ok: true, midX: sx / lc, midY: sy / lc };
}

// ───────────── Union-Find ─────────────
function makeDsu() {
  const p: number[] = [];
  const find = (a: number): number => {
    while (p[a] !== a) { p[a] = p[p[a]]; a = p[a]; }
    return a;
  };
  return { add: () => { p.push(p.length); return p.length - 1; }, find, union: (a: number, b: number) => { const ra = find(a), rb = find(b); if (ra !== rb) p[ra] = rb; } };
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

function isStandardAxial(o?: number[]): boolean {
  return !!o && o.length >= 6 && Math.abs(o[0] - 1) < 0.1 && Math.abs(o[4] - 1) < 0.1 && Math.abs(o[1]) < 0.1 && Math.abs(o[2]) < 0.1 && Math.abs(o[3]) < 0.1 && Math.abs(o[5]) < 0.1;
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ───────────── Ana akış ─────────────
export async function runEngine(series: SeriesData, protocol: "ct-head" | "ct-chest", hooks: EngineHooks): Promise<EngineOutput | null> {
  const w = series.width;
  const h = series.height;
  const N = series.slices.length;
  const px = series.pixelSpacing || 1;
  const dz = series.sliceSpacing || series.sliceThickness || 1;
  const minArea = Math.max(2, Math.round(1 / (px * px)));
  const notes: string[] = [];

  const dsu = makeDsu();
  const all: Comp2D[] = [];
  const mids: { x: number; y: number }[] = [];
  let prev: { labels: Int32Array; comps: Comp2D[] } | null = null;
  let skipped = 0;

  for (let s = 0; s < N; s++) {
    if (hooks.aborted()) return null;
    const sl = series.slices[s];
    const r = protocol === "ct-head" ? headSlice(sl, w, h, px) : chestSlice(sl, w, h);
    if (!r.ok) skipped++;
    mids.push({ x: r.midX, y: r.midY });
    const { comps, labels } = label2D(r.cand, w, h, minArea, s, sl);
    for (const c of comps) c.gid = dsu.add();
    if (prev) {
      for (const c of comps) {
        let last = -1;
        for (let k = 0; k < c.pix.length; k++) {
          const pl = prev.labels[c.pix[k]];
          if (pl > 0 && pl !== last) { dsu.union(c.gid, prev.comps[pl - 1].gid); last = pl; }
        }
      }
    }
    prev = { labels, comps };
    all.push(...comps);
    await hooks.onSlice(s, N);
  }
  if (skipped > 0) {
    notes.push(
      protocol === "ct-head"
        ? `${skipped}/${N} kesitte kapalı kafatası boşluğu bulunamadı (kafa tabanı/üst kalvaryum olabilir) — bu kesitler atlandı.`
        : `${skipped}/${N} kesitte akciğer maskesi çıkarılamadı — bu kesitler atlandı.`
    );
  }

  const groups = new Map<number, Comp2D[]>();
  for (const c of all) {
    const root = dsu.find(c.gid);
    const g = groups.get(root);
    if (g) g.push(c); else groups.set(root, [c]);
  }

  const std = isStandardAxial(series.orientation);
  interface Cand { finding: Omit<Finding, "id">; mask: Map<number, Uint8Array>; score: number }
  const cands: Cand[] = [];

  for (const comps of groups.values()) {
    let vox = 0, sum = 0, sumSq = 0, maxHu = -Infinity;
    let bx0 = w, bx1 = 0, by0 = h, by1 = 0, s0 = N, s1 = 0;
    const perSlice = new Map<number, { n: number; minX: number; maxX: number; minY: number; maxY: number; sx: number; sy: number }>();
    for (const c of comps) {
      vox += c.pix.length; sum += c.sum; sumSq += c.sumSq; if (c.max > maxHu) maxHu = c.max;
      bx0 = Math.min(bx0, c.minX); bx1 = Math.max(bx1, c.maxX); by0 = Math.min(by0, c.minY); by1 = Math.max(by1, c.maxY);
      s0 = Math.min(s0, c.slice); s1 = Math.max(s1, c.slice);
      const e = perSlice.get(c.slice) ?? { n: 0, minX: w, maxX: 0, minY: h, maxY: 0, sx: 0, sy: 0 };
      e.n += c.pix.length; e.minX = Math.min(e.minX, c.minX); e.maxX = Math.max(e.maxX, c.maxX); e.minY = Math.min(e.minY, c.minY); e.maxY = Math.max(e.maxY, c.maxY);
      for (let k = 0; k < c.pix.length; k++) { e.sx += c.pix[k] % w; e.sy += (c.pix[k] / w) | 0; }
      perSlice.set(c.slice, e);
    }
    const nSl = s1 - s0 + 1;
    const mean = sum / vox;
    const sd = Math.sqrt(Math.max(0, sumSq / vox - mean * mean));
    const volMm3 = vox * px * px * dz;
    let peak = s0, peakN = 0;
    for (const [s, e] of perSlice) if (e.n > peakN) { peakN = e.n; peak = s; }
    const pe = perSlice.get(peak)!;
    const wMm = (pe.maxX - pe.minX + 1) * px;
    const hMm = (pe.maxY - pe.minY + 1) * px;
    const zMm = nSl * dz;
    let maxInPlane = 0;
    for (const e of perSlice.values()) maxInPlane = Math.max(maxInPlane, (e.maxX - e.minX + 1) * px, (e.maxY - e.minY + 1) * px);
    const compact = vox / ((bx1 - bx0 + 1) * (by1 - by0 + 1) * nSl);

    const cx = pe.sx / pe.n;
    const cy = pe.sy / pe.n;
    const m = mids[peak];
    const lat = std ? (cx < m.x ? "Sağ" : "Sol") : "";
    const ap = cy < m.y ? "ön" : "arka";

    let severity: Severity;
    let label: string, category: string, detail: string, score: number;
    const metrics: NonNullable<Finding["metrics"]> = { meanHu: Number(mean.toFixed(1)), maxHu: Number(maxHu.toFixed(0)), zExtentMm: Number(zMm.toFixed(1)), maxDiameterMm: Number(maxInPlane.toFixed(1)) };
    let location: string;

    if (protocol === "ct-head") {
      const volMl = volMm3 / 1000;
      if (volMl < 0.5 || mean < 54 || mean > 92) continue;
      metrics.volumeMl = Number(volMl.toFixed(2));
      severity = volMl >= 5 ? "kritik" : "yuksek";
      label = "Hiperdens odak (akut kanama adayı)";
      category = "Kanama";
      location = `${lat ? `${lat} hemisfer, ` : ""}${ap} kısım${lat ? "" : " (yön bilinmiyor)"}`;
      detail = `Kesit ${s0 + 1}–${s1 + 1} arasında, ortalama ${mean.toFixed(0)} HU (maks. ${maxHu.toFixed(0)}) dansitesinde, ${wMm.toFixed(0)}×${hMm.toFixed(0)} mm (aksiyel), kraniokaudal ${zMm.toFixed(0)} mm uzanımlı, ölçülen hacmi ${volMl.toFixed(1)} mL olan hiperdens odak. Kural tabanlı aday: kalsifikasyon, venöz sinüs veya artefakt dışlanmalıdır.`;
      score = clamp01(0.45 * clamp01((mean - 50) / 30) + 0.35 * clamp01(volMl / 5) + 0.2 * (1 - clamp01(sd / 20)));
    } else {
      const ext = Math.max(maxInPlane, zMm);
      const minExt = Math.max(1, Math.min(wMm, hMm, zMm));
      // solid nodül: yumuşak doku dansitesi (kısmi hacimli damar uçlarını ele), 4–40 mm, kompakt ve uzamış olmayan şekil
      if (volMm3 < 34 || maxInPlane < 4 || mean < -60 || maxInPlane > 40 || zMm > 40 + dz || compact < 0.2 || ext / minExt > 4) continue;
      const dia = (wMm + hMm) / 2;
      metrics.volumeMl = Number((volMm3 / 1000).toFixed(3));
      metrics.lungRads = dia < 6 ? "2" : dia < 8 ? "3" : dia < 15 ? "4A" : "4B";
      severity = dia >= 15 ? "yuksek" : dia >= 8 ? "orta" : "dusuk";
      label = "Pulmoner nodül adayı";
      category = "Nodül";
      location = `${lat ? `${lat} akciğer` : "Akciğer"}, ${ap} kısım${lat ? "" : " (yön bilinmiyor)"}`;
      detail = `Kesit ${s0 + 1}–${s1 + 1} arasında, aksiyel ${wMm.toFixed(0)}×${hMm.toFixed(0)} mm (ort. çap ${dia.toFixed(1)} mm), kraniokaudal ${zMm.toFixed(0)} mm, hacim ${volMm3.toFixed(0)} mm³, ortalama ${mean.toFixed(0)} HU solid yumuşak doku odağı. Boyuta göre Lung-RADS ${metrics.lungRads} eşiği (solid, başlangıç varsayımı). Damar kesiti/yanlış pozitif olasılığı vardır.`;
      score = clamp01(0.4 * clamp01(compact / 0.6) + 0.3 * clamp01(dia / 10) + 0.3 * (1 - clamp01((ext / minExt - 1) / 3)));
    }

    const sliceBoxes: Record<number, BBox> = {};
    for (const [s, e] of perSlice) {
      const pad = 3;
      const x0 = Math.max(0, e.minX - pad), y0 = Math.max(0, e.minY - pad);
      const x1 = Math.min(w - 1, e.maxX + pad), y1 = Math.min(h - 1, e.maxY + pad);
      sliceBoxes[s] = { x: x0 / w, y: y0 / h, w: (x1 - x0 + 1) / w, h: (y1 - y0 + 1) / h };
    }
    const mask = new Map<number, Uint8Array>();
    for (const c of comps) {
      let mk = mask.get(c.slice);
      if (!mk) { mk = new Uint8Array(w * h); mask.set(c.slice, mk); }
      for (let k = 0; k < c.pix.length; k++) mk[c.pix[k]] = 1;
    }
    const pos = series.slicePositions;
    cands.push({
      score,
      mask,
      finding: {
        sliceIndex: peak, sliceStart: s0, sliceEnd: s1, keySliceNumber: peak + 1,
        sliceRangeStr: s0 === s1 ? `Kesit ${s0 + 1}` : `Kesit ${s0 + 1} – ${s1 + 1} (${nSl} kesitte)`,
        zLocationMm: Number((pos ? pos[peak] - pos[0] : (peak - N / 2) * dz).toFixed(1)),
        anatomicalLocation: location, densityOrSignal: `ort. ${mean.toFixed(0)} HU (maks. ${maxHu.toFixed(0)})`,
        sizeMmStr: `${wMm.toFixed(0)} × ${hMm.toFixed(0)} × ${zMm.toFixed(0)} mm`,
        bbox: sliceBoxes[peak], sliceBoxes, label, detail, category, severity,
        confidence: score, confidenceKind: "heuristic", source: "cv-heuristic", metrics,
      },
    });
  }

  const rank: Record<Severity, number> = { kritik: 4, yuksek: 3, orta: 2, dusuk: 1, normal: 0 };
  cands.sort((a, b) => rank[b.finding.severity] - rank[a.finding.severity] || b.score - a.score);
  const top = cands.slice(0, 8);
  if (cands.length > top.length) notes.push(`${cands.length - top.length} düşük öncelikli aday daha bulundu; ilk ${top.length} gösteriliyor.`);

  const masks = new Map<string, Map<number, Uint8Array>>();
  const findings = top.map((c, i) => {
    const id = `cv${i + 1}`;
    masks.set(id, c.mask);
    return { id, ...c.finding };
  });
  return { findings, masks, notes };
}
