import type { Annotation, AnnotationStats, SeriesData } from "./types";

export interface Pt {
  x: number;
  y: number;
}

export const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/** b köşeli, a-b-c açısı (derece). */
export function angleAt(a: Pt, b: Pt, c: Pt): number {
  const v1 = { x: a.x - b.x, y: a.y - b.y };
  const v2 = { x: c.x - b.x, y: c.y - b.y };
  const m = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y);
  if (!m) return 0;
  return (Math.acos(Math.max(-1, Math.min(1, (v1.x * v2.x + v1.y * v2.y) / m))) * 180) / Math.PI;
}

/** ab ve cd doğruları arasındaki dar açı (Cobb açısı). */
export function lineAngle(a: Pt, b: Pt, c: Pt, d: Pt): number {
  const t1 = Math.atan2(b.y - a.y, b.x - a.x);
  const t2 = Math.atan2(d.y - c.y, d.x - c.x);
  let deg = (Math.abs(t1 - t2) * 180) / Math.PI;
  deg %= 180;
  return deg > 90 ? 180 - deg : deg;
}

export function polygonArea(p: Pt[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i];
    const b = p[(i + 1) % p.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

export function polygonPerimeter(p: Pt[], closed = true): number {
  let s = 0;
  for (let i = 0; i < p.length - 1; i++) s += dist(p[i], p[i + 1]);
  if (closed && p.length > 2) s += dist(p[p.length - 1], p[0]);
  return s;
}

export function pointInPolygon(x: number, y: number, p: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    if (p[i].y > y !== p[j].y > y && x < ((p[j].x - p[i].x) * (y - p[i].y)) / (p[j].y - p[i].y) + p[i].x) inside = !inside;
  }
  return inside;
}

export const ellipseTest = (cx: number, cy: number, rx: number, ry: number) => (x: number, y: number) =>
  rx > 0 && ry > 0 && ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;

/** Bölge içi piksel istatistikleri (piksel merkezleri üzerinden). */
export function regionStats(
  series: SeriesData,
  slice: number,
  box: { x0: number; y0: number; x1: number; y1: number },
  inside: (x: number, y: number) => boolean
): AnnotationStats | null {
  const sl = series.slices[slice];
  if (!sl) return null;
  const x0 = Math.max(0, Math.floor(box.x0));
  const y0 = Math.max(0, Math.floor(box.y0));
  const x1 = Math.min(series.width - 1, Math.ceil(box.x1));
  const y1 = Math.min(series.height - 1, Math.ceil(box.y1));
  let n = 0, sum = 0, sum2 = 0, min = Infinity, max = -Infinity;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!inside(x + 0.5, y + 0.5)) continue;
      const v = sl[y * series.width + x];
      n++; sum += v; sum2 += v * v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (n === 0) return null;
  const mean = sum / n;
  return { mean, std: Math.sqrt(Math.max(0, sum2 / n - mean * mean)), min, max, pixelCount: n };
}

/** Birincil serinin kesitine anatomik olarak karşılık gelen ikinci seri kesiti. */
export function mapSliceByPosition(a: SeriesData, ia: number, b: SeriesData): number {
  const nb = b.slices.length;
  const sameFrame = !a.frameOfRef || !b.frameOfRef || a.frameOfRef === b.frameOfRef;
  if (a.slicePositions && b.slicePositions && sameFrame) {
    const target = a.slicePositions[Math.min(ia, a.slicePositions.length - 1)];
    let best = 0;
    let bd = Infinity;
    b.slicePositions.forEach((p, i) => {
      const d = Math.abs(p - target);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  }
  const na = a.slices.length;
  if (na <= 1 || nb <= 1) return Math.min(ia, nb - 1);
  return Math.round((ia / (na - 1)) * (nb - 1));
}

const f1 = (n: number) => n.toFixed(1);

/** Ölçüm etiketi (görüntüde ve listede). */
/** Bir noktanın (p) p0→p1 doğrusuna dik uzaklığı ve tarafı (ekranda yönün sağı/solu), piksel cinsinden. */
export function perpendicular(p0: Pt, p1: Pt, p: Pt): { dist: number; foot: Pt; side: "sağ" | "sol" } {
  const dx = p1.x - p0.x, dy = p1.y - p0.y;
  const len2 = dx * dx + dy * dy || 1;
  const t = ((p.x - p0.x) * dx + (p.y - p0.y) * dy) / len2;
  const foot = { x: p0.x + t * dx, y: p0.y + t * dy };
  const cr = dx * (p.y - p0.y) - dy * (p.x - p0.x);
  return { dist: Math.hypot(p.x - foot.x, p.y - foot.y), foot, side: cr > 0 ? "sağ" : "sol" };
}

/** Elipsoid hacmi (mL): V = π/6 · d1 · d2 · d3 (mm³ → mL). */
export const ellipsoidVolumeMl = (d1Mm: number, d2Mm: number, d3Mm: number) => (Math.PI / 6) * d1Mm * d2Mm * d3Mm / 1000;

/** Üçüncü eksen çapı (mm); annotation.text içinde saklanır, yoksa diğer ikisinin ortalaması. */
export function ellipsoidD3(a: Annotation, d1: number, d2: number): number {
  const v = parseFloat(a.text ?? "");
  return Number.isFinite(v) && v > 0 ? v : (d1 + d2) / 2;
}

export function annotationSummary(a: Annotation, pxMm: number, unit: string, suvFactor?: number | null): string {
  const p = a.points;
  switch (a.kind) {
    case "length": return `${f1(dist(p[0], p[1]) * pxMm)} mm`;
    case "angle": return `${f1(angleAt(p[0], p[1], p[2]))}°`;
    case "cobb": return `Cobb ${f1(lineAngle(p[0], p[1], p[2], p[3]))}°`;
    case "arrow": return a.text || "ok";
    case "deviation": {
      if (p.length < 3) return "";
      const d = perpendicular(p[0], p[1], p[2]);
      return `Sapma ${f1(d.dist * pxMm)} mm (${d.side})`;
    }
    case "ellipsoid": {
      const d1 = Math.abs(p[1].x - p[0].x) * pxMm, d2 = Math.abs(p[1].y - p[0].y) * pxMm;
      const d3 = ellipsoidD3(a, d1, d2);
      const vol = ellipsoidVolumeMl(d1, d2, d3);
      const st0 = a.stats;
      const suv = st0 && suvFactor ? ` · SUVort ${(st0.mean * suvFactor).toFixed(2)} · SUVmaks ${(st0.max * suvFactor).toFixed(2)}` : "";
      return `⌀ ${f1(d1)}×${f1(d2)}×${f1(d3)} mm · V ${vol < 10 ? vol.toFixed(2) : vol.toFixed(1)} mL${suv}`;
    }
    case "rect":
    case "ellipse":
    case "polygon": {
      const st = a.stats;
      let area = 0;
      let per = 0;
      if (a.kind === "rect") { area = Math.abs(p[1].x - p[0].x) * Math.abs(p[1].y - p[0].y); per = 2 * (Math.abs(p[1].x - p[0].x) + Math.abs(p[1].y - p[0].y)); }
      else if (a.kind === "ellipse") {
        const rx = Math.abs(p[1].x - p[0].x) / 2, ry = Math.abs(p[1].y - p[0].y) / 2;
        area = Math.PI * rx * ry;
        per = Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)));
      } else { area = polygonArea(p); per = polygonPerimeter(p); }
      const u = unit === "HU" ? " HU" : "";
      const suv = st && suvFactor ? ` · SUVort ${(st.mean * suvFactor).toFixed(2)} · SUVmaks ${(st.max * suvFactor).toFixed(2)}` : "";
      return `A ${f1(area * pxMm * pxMm)} mm² · ç ${f1(per * pxMm)} mm${st ? ` · ort ${st.mean.toFixed(0)}±${st.std.toFixed(0)}${u} · min/maks ${st.min.toFixed(0)}/${st.max.toFixed(0)}${suv}` : ""}`;
    }
    default: return "";
  }
}

export const KIND_LABEL: Record<Annotation["kind"], string> = {
  length: "Uzunluk", angle: "Açı", cobb: "Cobb açısı", arrow: "Ok", rect: "Dikdörtgen ROI", ellipse: "Elips ROI", polygon: "Çokgen ROI", calib: "Kalibrasyon", ellipsoid: "Elipsoid hacim", deviation: "Sapma",
};
