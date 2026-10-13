import type { SeriesData } from "./types";
import { resampleOnto } from "./planes";

export type CmapName = "hot" | "iron" | "rainbow" | "cool";
export interface FusionParams {
  series: SeriesData;
  alpha: number;     // 0..1
  cmap: CmapName;
  loPct: number;     // alt eşik, serinin (güçlü) maksimumunun yüzdesi
  hiPct: number;     // üst sınır, yüzde
}

export const CMAPS: Record<CmapName, string> = { hot: "Sıcak (PET)", iron: "Demir", rainbow: "Gökkuşağı", cool: "Soğuk" };

function ramp(stops: [number, number, number, number][]): Uint32Array {
  const lut = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let k = 0;
    while (k < stops.length - 2 && t > stops[k + 1][0]) k++;
    const [t0, r0, g0, b0] = stops[k], [t1, r1, g1, b1] = stops[k + 1];
    const f = Math.max(0, Math.min(1, (t - t0) / Math.max(1e-9, t1 - t0)));
    lut[i] = (Math.round(r0 + (r1 - r0) * f)) | (Math.round(g0 + (g1 - g0) * f) << 8) | (Math.round(b0 + (b1 - b0) * f) << 16);
  }
  return lut;
}
const LUTS: Record<CmapName, Uint32Array> = {
  hot: ramp([[0, 0, 0, 0], [0.35, 200, 0, 0], [0.7, 255, 200, 0], [1, 255, 255, 255]]),
  iron: ramp([[0, 20, 0, 60], [0.4, 180, 20, 100], [0.75, 255, 150, 0], [1, 255, 255, 200]]),
  rainbow: ramp([[0, 40, 0, 160], [0.25, 0, 120, 255], [0.5, 0, 220, 120], [0.75, 255, 220, 0], [1, 255, 40, 0]]),
  cool: ramp([[0, 0, 40, 120], [0.5, 0, 200, 255], [1, 220, 255, 255]]),
};

const maxCache = new WeakMap<SeriesData, number>();
/** Tek vokselli uç değerlere dayanıklı maksimum (99.99. yüzdelik; örneklemeli). */
export function robustMax(s: SeriesData): number {
  const c = maxCache.get(s);
  if (c !== undefined) return c;
  const vals: number[] = [];
  const step = Math.max(1, Math.floor((s.slices.length * s.width * s.height) / 200000));
  let i = 0;
  for (const sl of s.slices) for (let k = 0; k < sl.length; k++, i++) if (i % step === 0) vals.push(sl[k]);
  vals.sort((a, b) => a - b);
  const m = vals.length ? vals[Math.min(vals.length - 1, Math.floor(vals.length * 0.9999))] : 1;
  const v = m > 0 ? m : 1;
  maxCache.set(s, v);
  return v;
}

const resCache = new Map<string, Float32Array | null>();
/** Füzyon katmanı (RGBA, hedef kesit çözünürlüğünde). Geometri yoksa null. */
export function buildFusionLayer(target: SeriesData, slice: number, f: FusionParams): Uint32Array | null {
  const rk = `${target.id}|${slice}|${f.series.id}`;
  let res = resCache.get(rk);
  if (res === undefined) {
    res = resampleOnto(target, slice, f.series);
    if (resCache.size > 24) resCache.clear();
    resCache.set(rk, res);
  }
  if (!res) return null;
  const mx = robustMax(f.series);
  const lo = (f.loPct / 100) * mx, hi = Math.max(lo + 1e-6, (f.hiPct / 100) * mx);
  const lut = LUTS[f.cmap];
  const out = new Uint32Array(res.length);
  const a255 = Math.round(Math.max(0, Math.min(1, f.alpha)) * 255);
  for (let i = 0; i < res.length; i++) {
    const v = res[i];
    if (!(v > lo)) continue; // NaN dahil
    const t = Math.min(1, (v - lo) / (hi - lo));
    const soft = Math.min(1, t * 6); // eşik çevresinde yumuşak geçiş
    out[i] = (Math.round(a255 * soft) << 24) | lut[Math.round(t * 255)];
  }
  return out;
}
