import type { SeriesData } from "./types";
import { planeOf } from "./planes";

export type SlabMode = "single" | "avg" | "mip" | "minip";

export interface VolGeo { w: number; h: number; n: number; sx: number; sy: number; sz: number }
export function volGeo(s: SeriesData): VolGeo {
  const sz = s.sliceSpacing || s.sliceThickness || 1;
  return { w: s.width, h: s.height, n: s.slices.length, sx: s.pixelSpacingX ?? s.pixelSpacing ?? 1, sy: s.pixelSpacing ?? 1, sz };
}

/** Voksel koordinatında (x,y,z; merkezler tamsayı) üç doğrusal örnek; kapsam dışı: NaN. */
export function sampleTrilinear(s: SeriesData, x: number, y: number, z: number): number {
  const W = s.width, H = s.height, N = s.slices.length;
  if (x < 0 || y < 0 || z < 0 || x > W - 1 || y > H - 1 || z > N - 1) return NaN;
  const x0 = Math.min(W - 2 < 0 ? 0 : W - 2, Math.floor(x)), y0 = Math.min(H - 2 < 0 ? 0 : H - 2, Math.floor(y));
  const z0 = Math.min(N - 2 < 0 ? 0 : N - 2, Math.floor(z));
  const x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1), z1 = Math.min(N - 1, z0 + 1);
  const fx = x - x0, fy = y - y0, fz = z - z0;
  const a = s.slices[z0], b = s.slices[z1];
  const i00 = y0 * W + x0, i10 = y0 * W + x1, i01 = y1 * W + x0, i11 = y1 * W + x1;
  const c0 = a[i00] * (1 - fx) * (1 - fy) + a[i10] * fx * (1 - fy) + a[i01] * (1 - fx) * fy + a[i11] * fx * fy;
  if (z1 === z0) return c0;
  const c1 = b[i00] * (1 - fx) * (1 - fy) + b[i10] * fx * (1 - fy) + b[i01] * (1 - fx) * fy + b[i11] * fx * fy;
  return c0 * (1 - fz) + c1 * fz;
}

export interface ObliqueOpts {
  /** Düzlemin merkezi (voksel koordinatı). */
  cx: number; cy: number; cz: number;
  /** Derece: X ekseni etrafında eğim, Y ekseni etrafında eğim, Z ekseni etrafında dönüş. */
  rotX: number; rotY: number; rotZ: number;
  size?: number;
  slabMm?: number;
  mode?: SlabMode;
}
export interface ObliqueImage { data: Float32Array; w: number; h: number; stepMm: number; u: [number, number, number]; v: [number, number, number]; n: [number, number, number] }

/** mm uzayında dönüş matrisi R = Rz · Ry · Rx uygulanmış (u,v,n) tabanı. */
export function obliqueBasis(rotX: number, rotY: number, rotZ: number) {
  const d = Math.PI / 180;
  const cxr = Math.cos(rotX * d), sxr = Math.sin(rotX * d), cyr = Math.cos(rotY * d), syr = Math.sin(rotY * d), czr = Math.cos(rotZ * d), szr = Math.sin(rotZ * d);
  const rot = (p: [number, number, number]): [number, number, number] => {
    let [x, y, z] = p;
    [y, z] = [y * cxr - z * sxr, y * sxr + z * cxr];       // Rx
    [x, z] = [x * cyr + z * syr, -x * syr + z * cyr];      // Ry
    [x, y] = [x * czr - y * szr, x * szr + y * czr];       // Rz
    return [x, y, z];
  };
  return { u: rot([1, 0, 0]), v: rot([0, 1, 0]), n: rot([0, 0, 1]) };
}

/** Rastgele eğimli (oblik) düzlem; hacmin mm uzayında örneklenir. Kalın kesit için normal boyunca ort./MIP/MinIP. */
export function obliquePlane(s: SeriesData, o: ObliqueOpts): ObliqueImage {
  const g = volGeo(s);
  const size = o.size ?? 384;
  const extent = Math.max(g.w * g.sx, g.h * g.sy, g.n * g.sz);
  const step = extent / size;
  const { u, v, n } = obliqueBasis(o.rotX, o.rotY, o.rotZ);
  const out = new Float32Array(size * size);
  const cMm: [number, number, number] = [o.cx * g.sx, o.cy * g.sy, o.cz * g.sz];
  const mode = o.mode ?? "single";
  const slab = o.slabMm ?? 0;
  const ks = mode === "single" || slab <= step ? 0 : Math.round(slab / 2 / step);
  const BG = -3.4e38;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const a = (i - size / 2) * step, b = (j - size / 2) * step;
      const px = cMm[0] + a * u[0] + b * v[0], py = cMm[1] + a * u[1] + b * v[1], pz = cMm[2] + a * u[2] + b * v[2];
      let acc = mode === "mip" ? -Infinity : mode === "minip" ? Infinity : 0;
      let cnt = 0;
      for (let k = -ks; k <= ks; k++) {
        const t = k * step;
        const val = sampleTrilinear(s, (px + t * n[0]) / g.sx, (py + t * n[1]) / g.sy, (pz + t * n[2]) / g.sz);
        if (Number.isNaN(val)) continue;
        cnt++;
        acc = mode === "mip" ? Math.max(acc, val) : mode === "minip" ? Math.min(acc, val) : acc + val;
      }
      out[j * size + i] = cnt === 0 ? BG : mode === "avg" ? acc / cnt : mode === "single" || ks === 0 ? acc / Math.max(1, cnt) * (mode === "single" ? 1 : 1) : acc;
    }
  }
  return { data: out, w: size, h: size, stepMm: step, u, v, n };
}

// ───────────── Yüzey (STL) ─────────────

export interface Mesh { tris: Float32Array; count: number }

/** voksel (x,y,z) → RAS mm (3D Slicer ile uyumlu: +X sağ, +Y ön, +Z baş). Konum etiketi varsa gerçek hasta koordinatı kullanılır. */
export function voxelToRas(s: SeriesData, g: VolGeo): (x: number, y: number, z: number) => [number, number, number] {
  const p0 = s.ipp ? planeOf(s, 0) : null;
  if (p0 && s.ipp) {
    const ipp = s.ipp, N = s.slices.length;
    return (x, y, z) => {
      const k0 = Math.max(0, Math.min(N - 1, Math.floor(z))), k1 = Math.min(N - 1, k0 + 1), f = Math.max(0, Math.min(1, z - k0));
      const o0 = ipp[k0], o1 = ipp[k1];
      const ox = o0[0] + (o1[0] - o0[0]) * f, oy = o0[1] + (o1[1] - o0[1]) * f, oz = o0[2] + (o1[2] - o0[2]) * f;
      const a = x * g.sx, b = y * g.sy;
      const L = ox + a * p0.r[0] + b * p0.c[0], P = oy + a * p0.r[1] + b * p0.c[1], S = oz + a * p0.r[2] + b * p0.c[2];
      return [-L, -P, S]; // LPS → RAS
    };
  }
  return (x, y, z) => [-(x * g.sx), -(y * g.sy), z * g.sz];
}

/**
 * Eşik yüzeyi (marching tetrahedra). `maxDim`: en uzun eksendeki en çok örnek sayısı (kalite/hız ayarı).
 * Eşik üstü "iç" kabul edilir; üçgen yönü dıştan bakışa göre tutarlıdır.
 */
export function isoSurface(s: SeriesData, threshold: number, maxDim = 128, onTick?: () => void): Mesh {
  const g = volGeo(s);
  const f = Math.max(1, Math.ceil(Math.max(g.w, g.h) / maxDim));
  const fz = Math.max(1, Math.ceil(g.n / maxDim));
  const gx = Math.floor((g.w - 1) / f) + 1, gy = Math.floor((g.h - 1) / f) + 1, gz = Math.floor((g.n - 1) / fz) + 1;
  const grid = new Float32Array(gx * gy * gz);
  for (let z = 0; z < gz; z++) {
    const sl = s.slices[Math.min(g.n - 1, z * fz)];
    for (let y = 0; y < gy; y++) for (let x = 0; x < gx; x++) grid[(z * gy + y) * gx + x] = sl[Math.min(g.h - 1, y * f) * g.w + Math.min(g.w - 1, x * f)];
  }
  // dış sınırı kapat (açık yüzey kalmasın): kenarlara düşük değer
  const LOW = -1e30;
  for (let z = 0; z < gz; z++) for (let y = 0; y < gy; y++) for (let x = 0; x < gx; x++) {
    if (x === 0 || y === 0 || z === 0 || x === gx - 1 || y === gy - 1 || z === gz - 1) grid[(z * gy + y) * gx + x] = Math.min(grid[(z * gy + y) * gx + x], LOW);
  }
  const toRas = voxelToRas(s, g);
  const out: number[] = [];
  const TETS = [[0, 5, 1, 6], [0, 1, 2, 6], [0, 2, 3, 6], [0, 3, 7, 6], [0, 7, 4, 6], [0, 4, 5, 6]];
  const CORNER: [number, number, number][] = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
  const val = new Float64Array(8);
  const pos = (cx: number, cy: number, cz: number, k: number): [number, number, number] => [(cx + CORNER[k][0]) * f, (cy + CORNER[k][1]) * f, (cz + CORNER[k][2]) * fz];
  const lerp = (pa: [number, number, number], pb: [number, number, number], va: number, vb: number): [number, number, number] => {
    const t = (threshold - va) / (vb - va || 1e-12);
    return [pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t, pa[2] + (pb[2] - pa[2]) * t];
  };
  const tri = (a: [number, number, number], b: [number, number, number], c: [number, number, number], inside: [number, number, number]) => {
    const A = toRas(...a), B = toRas(...b), C = toRas(...c), I = toRas(...inside);
    const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    // normal "içeriden dışarı" bakmalı: iç noktaya doğru olan yön negatif olmalı
    const flip = nx * (I[0] - A[0]) + ny * (I[1] - A[1]) + nz * (I[2] - A[2]) > 0;
    out.push(...(flip ? [...A, ...C, ...B] : [...A, ...B, ...C]));
  };
  for (let z = 0; z < gz - 1; z++) {
    if (onTick && z % 8 === 0) onTick();
    for (let y = 0; y < gy - 1; y++) for (let x = 0; x < gx - 1; x++) {
      let mn = Infinity, mx = -Infinity;
      for (let k = 0; k < 8; k++) { const v = grid[((z + CORNER[k][2]) * gy + (y + CORNER[k][1])) * gx + (x + CORNER[k][0])]; val[k] = v; if (v < mn) mn = v; if (v > mx) mx = v; }
      if (!(mn < threshold && mx >= threshold)) continue;
      for (const t of TETS) {
        const ins: number[] = [], outs: number[] = [];
        for (const k of t) (val[k] >= threshold ? ins : outs).push(k);
        if (ins.length === 0 || outs.length === 0) continue;
        const P = (k: number) => pos(x, y, z, k);
        if (ins.length === 1) {
          const a = ins[0];
          tri(lerp(P(a), P(outs[0]), val[a], val[outs[0]]), lerp(P(a), P(outs[1]), val[a], val[outs[1]]), lerp(P(a), P(outs[2]), val[a], val[outs[2]]), P(a));
        } else if (outs.length === 1) {
          const a = outs[0];
          tri(lerp(P(a), P(ins[0]), val[a], val[ins[0]]), lerp(P(a), P(ins[1]), val[a], val[ins[1]]), lerp(P(a), P(ins[2]), val[a], val[ins[2]]), P(ins[0]));
        } else {
          const [i0, i1] = ins, [o0, o1] = outs;
          const p00 = lerp(P(i0), P(o0), val[i0], val[o0]), p01 = lerp(P(i0), P(o1), val[i0], val[o1]);
          const p10 = lerp(P(i1), P(o0), val[i1], val[o0]), p11 = lerp(P(i1), P(o1), val[i1], val[o1]);
          tri(p00, p01, p11, P(i0));
          tri(p00, p11, p10, P(i0));
        }
      }
    }
  }
  return { tris: new Float32Array(out), count: out.length / 9 };
}

/** İkili STL (80 bayt başlık + üçgen sayısı + üçgen başına 50 bayt). Birim: mm. */
export function toBinaryStl(m: Mesh, name = "AtikViewer"): Uint8Array {
  const buf = new ArrayBuffer(84 + m.count * 50);
  const dv = new DataView(buf);
  const head = new TextEncoder().encode(`${name} - mm - RAS`);
  new Uint8Array(buf, 0, 80).set(head.slice(0, 80));
  dv.setUint32(80, m.count, true);
  let o = 84;
  for (let t = 0; t < m.count; t++) {
    const b = t * 9, T = m.tris;
    const ux = T[b + 3] - T[b], uy = T[b + 4] - T[b + 1], uz = T[b + 5] - T[b + 2], vx = T[b + 6] - T[b], vy = T[b + 7] - T[b + 1], vz = T[b + 8] - T[b + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    dv.setFloat32(o, nx, true); dv.setFloat32(o + 4, ny, true); dv.setFloat32(o + 8, nz, true);
    for (let k = 0; k < 9; k++) dv.setFloat32(o + 12 + k * 4, T[b + k], true);
    dv.setUint16(o + 48, 0, true);
    o += 50;
  }
  return new Uint8Array(buf);
}
