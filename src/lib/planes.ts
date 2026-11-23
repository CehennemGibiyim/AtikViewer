import type { SeriesData } from "./types";

export type V3 = [number, number, number];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/** Bir kesitin hasta koordinatındaki (LPS, mm) düzlemi. Sürekli görüntü koordinatı u,v: piksel i, [i, i+1) aralığını kaplar. */
export interface PlaneGeo {
  o: V3;      // (0,0) piksel MERKEZİNİN konumu (ImagePositionPatient)
  r: V3;      // satır yönü (x artarken)
  c: V3;      // sütun yönü (y artarken)
  n: V3;      // normal = r × c
  psX: number;
  psY: number;
  w: number;
  h: number;
}

export function planeOf(s: SeriesData, slice: number): PlaneGeo | null {
  const o = s.ipp?.[slice];
  const iop = s.orientation;
  if (!o || !iop || iop.length < 6) return null;
  const r: V3 = [iop[0], iop[1], iop[2]];
  const c: V3 = [iop[3], iop[4], iop[5]];
  return { o: [o[0], o[1], o[2]], r, c, n: cross(r, c), psX: s.pixelSpacingX ?? s.pixelSpacing ?? 1, psY: s.pixelSpacing ?? 1, w: s.width, h: s.height };
}

/** Görüntü (u,v) → hasta koordinatı. */
export function toPatient(p: PlaneGeo, u: number, v: number): V3 {
  const a = (u - 0.5) * p.psX, b = (v - 0.5) * p.psY;
  return [p.o[0] + a * p.r[0] + b * p.c[0], p.o[1] + a * p.r[1] + b * p.c[1], p.o[2] + a * p.r[2] + b * p.c[2]];
}

/**
 * `other` düzleminin `target` kesiti üzerindeki kesişim doğrusu (target piksel koordinatlarında,
 * görüntü sınırlarına kırpılmış). Paralel düzlemlerde veya görüntü dışında null.
 */
export function intersectLine(target: PlaneGeo, other: PlaneGeo): { a: { x: number; y: number }; b: { x: number; y: number } } | null {
  if (Math.abs(dot(target.n, other.n)) > 0.9995) return null; // paralel: çizgi yok
  const A = target.psX * dot(other.n, target.r);
  const B = target.psY * dot(other.n, target.c);
  const C = dot(other.n, sub(target.o, other.o)) - 0.5 * A - 0.5 * B;
  if (Math.hypot(A, B) < 1e-9) return null;
  // A u + B v + C = 0 ile [0,w]x[0,h] dikdörtgeninin kesişimi
  const pts: { x: number; y: number }[] = [];
  const add = (x: number, y: number) => { if (x >= -1e-6 && x <= target.w + 1e-6 && y >= -1e-6 && y <= target.h + 1e-6) pts.push({ x, y }); };
  if (Math.abs(B) > 1e-9) { add(0, -C / B); add(target.w, -(C + A * target.w) / B); }
  if (Math.abs(A) > 1e-9) { add(-C / A, 0); add(-(C + B * target.h) / A, target.h); }
  if (pts.length < 2) return null;
  // en uzak iki nokta
  let best: [number, number] = [0, 1], bd = -1;
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
    const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
    if (d > bd) { bd = d; best = [i, j]; }
  }
  if (bd < 1) return null;
  return { a: pts[best[0]], b: pts[best[1]] };
}

/** Bir serinin kesit konum anahtarı (ipp·normal), eşleme için. */
export function sliceKeys(s: SeriesData): number[] | null {
  if (!s.ipp || !s.orientation || s.orientation.length < 6) return null;
  const p = planeOf(s, 0);
  if (!p) return null;
  return s.ipp.map((o) => dot([o[0], o[1], o[2]], p.n));
}

/** İki seri aynı hasta koordinat sistemini paylaşıyor mu (füzyon/referans için)? */
export function sameFrame(a: SeriesData, b: SeriesData): boolean {
  return !!a.frameOfRef && a.frameOfRef === b.frameOfRef;
}

/**
 * `target` kesitindeki her piksel için `other` serisinden örnek alır (en yakın kesit, düzlem içi çift doğrusal).
 * Dönüş: other piksel değerleri (NaN = kapsam dışı). Geometri yoksa null.
 */
export function resampleOnto(target: SeriesData, slice: number, other: SeriesData): Float32Array | null {
  const t = planeOf(target, slice);
  const keys = sliceKeys(other);
  const p0 = planeOf(other, 0);
  if (!t || !keys || !p0 || !other.ipp) return null;
  const W = target.width, H = target.height, W2 = other.width, H2 = other.height;
  const out = new Float32Array(W * H).fill(NaN);
  const spacing = other.sliceSpacing || other.sliceThickness || 1;
  const nKey = keys;
  // kesit bulucu: keys sıralı (artan veya azalan) kabul edilir; doğrusal tarama yerine ikili arama
  const asc = nKey.length < 2 || nKey[nKey.length - 1] >= nKey[0];
  const nearest = (k: number) => {
    let lo = 0, hi = nKey.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if ((nKey[mid] <= k) === asc) lo = mid; else hi = mid;
    }
    return Math.abs(nKey[lo] - k) <= Math.abs(nKey[hi] - k) ? lo : hi;
  };
  const planes = other.ipp.map((o) => ({ ...p0, o: [o[0], o[1], o[2]] as V3 }));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const P = toPatient(t, x + 0.5, y + 0.5);
      const k = dot(P, p0.n);
      const si = nearest(k);
      if (Math.abs(nKey[si] - k) > spacing * 0.75) continue;
      const q = planes[si];
      const d = sub(P, q.o);
      const fi = dot(d, q.r) / q.psX, fj = dot(d, q.c) / q.psY;
      if (fi < -0.5 || fj < -0.5 || fi > W2 - 0.5 || fj > H2 - 0.5) continue;
      const i0 = Math.max(0, Math.min(W2 - 2, Math.floor(fi))), j0 = Math.max(0, Math.min(H2 - 2, Math.floor(fj)));
      const ax = Math.max(0, Math.min(1, fi - i0)), ay = Math.max(0, Math.min(1, fj - j0));
      const sl = other.slices[si];
      if (W2 < 2 || H2 < 2) { out[y * W + x] = sl[0]; continue; }
      const v00 = sl[j0 * W2 + i0], v10 = sl[j0 * W2 + i0 + 1], v01 = sl[(j0 + 1) * W2 + i0], v11 = sl[(j0 + 1) * W2 + i0 + 1];
      out[y * W + x] = v00 * (1 - ax) * (1 - ay) + v10 * ax * (1 - ay) + v01 * (1 - ax) * ay + v11 * ax * ay;
    }
  }
  return out;
}

/**
 * İki serinin kesit düzlemleri paralel mi? Yönelim bilgisi yoksa eski davranış korunur (paralel kabul).
 * Farklı düzlemlerde (ör. aksiyel ↔ sagital) kesit konumu eşlemesi anlamsızdır.
 */
export function parallelSeries(a: SeriesData, b: SeriesData): boolean {
  if (!a.orientation || !b.orientation || a.orientation.length < 6 || b.orientation.length < 6) return true;
  const pa = planeOf({ ...a, ipp: [[0, 0, 0]] } as SeriesData, 0), pb = planeOf({ ...b, ipp: [[0, 0, 0]] } as SeriesData, 0);
  if (!pa || !pb) return true;
  return Math.abs(dot(pa.n, pb.n)) > 0.98;
}
