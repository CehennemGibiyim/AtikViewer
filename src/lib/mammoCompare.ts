/**
 * Mamografi sağ-sol karşılaştırma çekirdeği.
 *
 * Tarayıcıdan ve testten aynı şekilde çağrılabilen saf fonksiyonlar:
 *  - aynı pozdaki (CC/MLO) sağ ve sol meme serilerini eşleştirme
 *  - iki meme arasında kare (kesit) indeksi eşleme — DBT'de kare sayıları farklı olabilir
 *  - yeniden örnekleme, pencere/seviye uygulama, fark görüntüsü
 *  - blink (yanıp sönme) zamanlaması
 *
 * Bu katman TANI ÜRETMEZ; yalnızca görsel karşılaştırma sağlar.
 */
import type { Pixels, SeriesData } from "./types";

export type CompareMode = "mirror" | "blink" | "diff";

/** Aynı pozun sağ ve sol memesi. */
export interface MammoPair {
  /** Normalize edilmiş poz: CC, MLO, ML vb. */
  view: string;
  right: SeriesData;
  left: SeriesData;
  tomosynthesis: boolean;
}

/** Üretici yazımları (Hologic/GE/Siemens) tek bir poza indirgenir. */
const VIEW_ALIASES: Record<string, string> = {
  XCCL: "CC",
  XCCM: "CC",
  XCC: "CC",
  FBCC: "CC",
  CCID: "CC",
  CC: "CC",
  ML: "ML",
  LM: "ML",
  XMLO: "MLO",
  MLOS: "MLO",
  QMLO: "MLO",
  TAN: "MLO",
  MLO: "MLO",
};

export function normalizeView(raw: string | undefined): string {
  const v = (raw ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!v) return "";
  const alias = VIEW_ALIASES[v];
  if (alias) return alias;
  if (v.startsWith("CC")) return "CC";
  if (v.includes("MLO")) return "MLO";
  return v;
}

export function isMammoSeries(s: SeriesData): boolean {
  return (
    s.modality.trim().toUpperCase() === "MG" ||
    Boolean(s.mammo?.laterality) ||
    Boolean(s.mammo?.viewPosition)
  );
}

function groupKey(view: string, tomosynthesis: boolean): string {
  return `${view}|${tomosynthesis ? "dbt" : "2d"}`;
}

/**
 * Serileri sağ/sol çiftlerine ayırır. Aynı poz + aynı görüntü tipi (2D ya da DBT)
 * eşleşir; DBT ile 2D asla karıştırılmaz. Eşleşmeyen seriler `unpaired` içinde döner.
 */
export function pairMammoSeries(series: SeriesData[]): { pairs: MammoPair[]; unpaired: SeriesData[] } {
  const groups = new Map<string, { right?: SeriesData; left?: SeriesData; extras: SeriesData[] }>();
  const unpaired: SeriesData[] = [];

  for (const s of series) {
    if (!isMammoSeries(s)) {
      unpaired.push(s);
      continue;
    }
    const view = normalizeView(s.mammo?.viewPosition);
    const laterality = (s.mammo?.laterality ?? "").trim().toUpperCase();
    if (!view || (laterality !== "R" && laterality !== "L")) {
      unpaired.push(s);
      continue;
    }
    const key = groupKey(view, Boolean(s.mammo?.tomosynthesis));
    const group = groups.get(key) ?? { extras: [] };
    if (laterality === "R" && !group.right) group.right = s;
    else if (laterality === "L" && !group.left) group.left = s;
    else group.extras.push(s);
    groups.set(key, group);
  }

  const pairs: MammoPair[] = [];
  for (const [key, group] of groups) {
    unpaired.push(...group.extras);
    if (group.right && group.left) {
      pairs.push({
        view: normalizeView(group.right.mammo?.viewPosition),
        right: group.right,
        left: group.left,
        tomosynthesis: key.endsWith("|dbt"),
      });
      continue;
    }
    if (group.right) unpaired.push(group.right);
    if (group.left) unpaired.push(group.left);
  }

  // 2D önce, sonra DBT; her grupta poz alfabetik (CC → MLO).
  pairs.sort((a, b) =>
    a.tomosynthesis === b.tomosynthesis ? a.view.localeCompare(b.view) : a.tomosynthesis ? 1 : -1,
  );
  return { pairs, unpaired };
}

/** Açık serinin karşıt tarafını (aynı poz, zıt laterality) döndürür. */
export function counterpartOf(s: SeriesData, series: SeriesData[]): SeriesData | null {
  const { pairs } = pairMammoSeries(series);
  for (const p of pairs) {
    if (p.right.id === s.id) return p.left;
    if (p.left.id === s.id) return p.right;
  }
  return null;
}

/** Üst bilgi çubuğu için kısa etiket: "R/MLO ⇄ L/MLO". */
export function pairLabel(p: MammoPair): string {
  const suffix = p.tomosynthesis ? " · DBT" : "";
  return `R/${p.view} ⇄ L/${p.view}${suffix}`;
}

/**
 * Kare indeksini hedef seriye eşler (oransal). DBT'de sol ve sağ meme farklı
 * sayıda kare içerebilir; uçlar tam oturur, ara kareler yuvarlanır.
 */
export function frameIndexFor(sourceCount: number, targetCount: number, index: number): number {
  if (sourceCount <= 0 || targetCount <= 0) return 0;
  const clamped = Math.max(0, Math.min(index, targetCount - 1));
  if (sourceCount === targetCount) return clamped;
  if (targetCount === 1) return 0;
  const ratio = clamped / (targetCount - 1);
  return Math.max(0, Math.min(sourceCount - 1, Math.round(ratio * (sourceCount - 1))));
}

export function toFloat(pixels: Pixels): Float32Array {
  return pixels instanceof Float32Array ? pixels : Float32Array.from(pixels);
}

/** En yakın komşuyla `dstW×dstH` boyutuna yeniden örnekler (karşılaştırma için yeterli). */
export function resample(
  src: Float32Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Float32Array {
  if (srcW === dstW && srcH === dstH) return src.slice();
  const out = new Float32Array(dstW * dstH);
  const sx = srcW / dstW;
  const sy = srcH / dstH;
  for (let y = 0; y < dstH; y++) {
    const yy = Math.min(srcH - 1, Math.floor((y + 0.5) * sy));
    const rowIn = yy * srcW;
    const rowOut = y * dstW;
    for (let x = 0; x < dstW; x++) {
      const xx = Math.min(srcW - 1, Math.floor((x + 0.5) * sx));
      out[rowOut + x] = src[rowIn + xx];
    }
  }
  return out;
}

/** Pencere/seviye uygulayıp 8-bit gri tona çevirir. */
export function toGray(pixels: Float32Array, wl: number, ww: number, invert = false): Uint8Array {
  const out = new Uint8Array(pixels.length);
  const lo = wl - ww / 2;
  const span = ww || 1;
  for (let i = 0; i < pixels.length; i++) {
    let v = (pixels[i] - lo) / span;
    v = v < 0 ? 0 : v > 1 ? 1 : v;
    const g = Math.round(v * 255);
    out[i] = invert ? 255 - g : g;
  }
  return out;
}

/** Mutlak fark, gri ton (0–255). `gain` düşük farkları görünür kılar. */
export function diffGray(a: Uint8Array, b: Uint8Array, gain = 2): Uint8Array {
  const n = Math.min(a.length, b.length);
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const d = Math.abs(a[i] - b[i]) * gain;
    out[i] = d > 255 ? 255 : d;
  }
  return out;
}

/**
 * İşaretli fark (RGBA): kırmızı = sol meme daha parlak, mavi = sağ meme daha parlak.
 * Opaklık farkın büyüklüğüne bağlıdır; eşit bölgeler saydam kalır.
 */
export function diffRgba(a: Uint8Array, b: Uint8Array, gain = 2): Uint8ClampedArray {
  const n = Math.min(a.length, b.length);
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const d = (a[i] - b[i]) * gain;
    const mag = Math.min(255, Math.abs(d));
    const o = i * 4;
    out[o] = d > 0 ? mag : 0;
    out[o + 1] = 0;
    out[o + 2] = d < 0 ? mag : 0;
    out[o + 3] = mag;
  }
  return out;
}

export const BLINK_MIN_HZ = 0.5;
export const BLINK_MAX_HZ = 3;
export const BLINK_DEFAULT_HZ = 1.5;

export function clampBlinkHz(hz: number): number {
  if (!Number.isFinite(hz)) return BLINK_DEFAULT_HZ;
  return Math.min(BLINK_MAX_HZ, Math.max(BLINK_MIN_HZ, hz));
}

/** Bir tarafın ekranda kalma süresi (ms). Sağ ve sol eşit süre görünür. */
export function blinkIntervalMs(hz: number): number {
  return Math.round(1000 / clampBlinkHz(hz));
}

/** Blink oynarken `elapsedMs` anında hangi taraf görünür. */
export function blinkSideAt(elapsedMs: number, hz: number): "right" | "left" {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return "right";
  const period = blinkIntervalMs(hz);
  return Math.floor(elapsedMs / period) % 2 === 0 ? "right" : "left";
}
