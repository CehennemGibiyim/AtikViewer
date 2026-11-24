/**
 * Akciğer grafisi (CR/DX) DOĞRULAMA SETİ üreteci.
 *
 * Etiketleri bilinen sentetik (phantom) akciğer grafileri üretir: normal, kardiyomegali,
 * plevral efüzyon, konsolidasyon, pnömotoraks ve nodül sınıfları. Amaç, dedektörün
 * kendi verimizdeki duyarlılık/özgüllüğünü ÖLÇMEK; klinik doğrulama yerine geçmez.
 *
 * Aynı tohum her zaman aynı seti üretir (yeniden üretilebilir ölçüm).
 */
import type { SeriesData } from "../src/lib/types";

export const CXR_LABELS = ["Kardiyomegali", "Plevral efüzyon", "Konsolidasyon", "Pnömotoraks", "Nodül"] as const;
export type CxrLabel = (typeof CXR_LABELS)[number];

export interface CxrCase {
  id: string;
  series: SeriesData;
  labels: Record<CxrLabel, boolean>;
}

const W = 512;
const H = 512;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Basit 2B değer gürültüsü (deterministik). */
function noiseField(seed: number) {
  const rnd = mulberry32(seed);
  const grid = new Float32Array(64 * 64);
  for (let i = 0; i < grid.length; i++) grid[i] = rnd() * 2 - 1;
  return (u: number, v: number) => {
    const gx = Math.min(63, Math.max(0, Math.floor(u * 63)));
    const gy = Math.min(63, Math.max(0, Math.floor(v * 63)));
    return grid[gy * 64 + gx];
  };
}

const smooth = (t: number) => {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
};

interface Side {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

interface RenderOpts {
  seed: number;
  cardiomegaly: boolean;
  effusion: "R" | "L" | null;
  consolidation: "R" | "L" | null;
  pneumothorax: "R" | "L" | null;
  nodule: "R" | "L" | null;
}

function render(o: RenderOpts): Float32Array {
  const rnd = mulberry32(o.seed * 7919 + 13);
  const n1 = noiseField(o.seed + 1);
  const n2 = noiseField(o.seed + 2);
  // Anatomik ölçü jitter'ı: gerçek hastalarda olduğu gibi hasta boyutu değişsin.
  const jitter = (amp: number) => (rnd() * 2 - 1) * amp;
  const bodyRx = 0.405 + jitter(0.012);
  const bodyRy = 0.475 + jitter(0.012);
  const lungs: Record<"R" | "L", Side> = {
    R: { cx: 0.325 + jitter(0.008), cy: 0.415 + jitter(0.008), rx: 0.135, ry: 0.25 },
    L: { cx: 0.675 + jitter(0.008), cy: 0.415 + jitter(0.008), rx: 0.14, ry: 0.25 },
  };
  const heart = o.cardiomegaly
    ? { cx: 0.552 + jitter(0.006), cy: 0.55, rx: 0.216, ry: 0.19 }
    : { cx: 0.556 + jitter(0.006), cy: 0.552, rx: 0.132, ry: 0.16 };
  const iod = 0.012 + rnd() * 0.006; // görüntü gürültüsü

  const lungBottom = (side: Side, u: number) => {
    const t = Math.abs((u - side.cx) / side.rx);
    // Diyafram kubbesi medialde yüksek, kostofrenik girinti lateralde alçak.
    return side.cy + side.ry * 0.78 + t * t * side.ry * 0.55;
  };
  const lungTop = (side: Side) => side.cy - side.ry;

  // Lezyon konumları (her durum için deterministik)
  const conSide = o.consolidation ? lungs[o.consolidation] : null;
  // Konsolidasyon parankim içine (kalp sınırından uzak, lateral yarıya) yerleştirilir.
  const conPos = conSide
    ? {
        x: conSide.cx + (conSide.cx < 0.5 ? -1 : 1) * conSide.rx * (0.15 + rnd() * 0.3),
        y: conSide.cy + conSide.ry * (0.05 + rnd() * 0.35),
        r: 0.045 + rnd() * 0.012,
      }
    : null;
  const nodSide = o.nodule ? lungs[o.nodule] : null;
  const nodPos = nodSide
    ? { x: nodSide.cx + (rnd() * 2 - 1) * nodSide.rx * 0.35, y: nodSide.cy - nodSide.ry * (0.1 + rnd() * 0.3), r: 0.014 + rnd() * 0.004 }
    : null;

  const px = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W;
      const v = (y + 0.5) / H;
      let val = 0.03 + n2(u * 3, v * 3) * 0.012;

      const body = Math.hypot((u - 0.5) / bodyRx, (v - 0.5) / bodyRy);
      if (body <= 1) {
        val = 0.735 + n1(u * 2, v * 2) * 0.02 + (rnd() * 2 - 1) * iod * 0.3;
        // Batın/diyafram altı
        if (v > 0.70) val = Math.max(val, 0.80 + n1(u * 2, v) * 0.015);
      }

      // Akciğer alanları
      for (const key of ["R", "L"] as const) {
        const side = lungs[key];
        const nx = (u - side.cx) / side.rx;
        const t = Math.abs(nx);
        if (body > 1 || t > 1) continue;
        const top = lungTop(side);
        const bottom = lungBottom(side, u);
        if (v < top || v > bottom) continue;

        let lungVal = 0.30 + n1(u * 4, v * 4) * 0.022 + (rnd() * 2 - 1) * iod;
        // Kostalar
        if (Math.sin((v + u * 0.15) * 42) > 0.9) lungVal += 0.13;

        // Laterale doğru (0 = akciğer merkezi, 1 = lateral göğüs duvarı) normalleştirilmiş uzaklık
        const tLat = Math.max(0, key === "R" ? (side.cx - u) / side.rx : (u - side.cx) / side.rx);

        // Pnömotoraks: lateral avasküler bant + plevral çizgi
        if (o.pneumothorax === key && tLat > 0.62 && v < top + (bottom - top) * 0.7) {
          lungVal = 0.055 + n1(u * 4, v * 4) * 0.01;
          if (Math.abs(tLat - 0.62) < 0.01) lungVal = 0.92;
        }

        // Plevral efüzyon: meniske lateralde yükselir, kostofrenik açı küntleşir
        if (o.effusion === key) {
          const fluidTop = bottom - side.ry * 1.4 * tLat;
          if (v > fluidTop) lungVal = 0.78 + n1(u * 3, v * 3) * 0.012;
        }

        // Konsolidasyon
        if (conPos) {
          const d = Math.hypot((u - conPos.x) * 1.0, (v - conPos.y) * (W / H) * 1.0) / conPos.r;
          if (d < 1.35) lungVal = lungVal * (1 - smooth(1.35 - d)) + 0.82 * smooth(1.35 - d);
        }
        // Nodül
        if (nodPos) {
          const d = Math.hypot(u - nodPos.x, v - nodPos.y) / nodPos.r;
          if (d < 1.3) lungVal = lungVal * (1 - smooth(1.3 - d)) + 0.86 * smooth(1.3 - d);
        }

        val = lungVal;
      }

      // Mediasten, kalp, omurga
      if (body <= 1) {
        if (Math.abs(u - 0.5) < 0.024) val = 0.87 + n1(u, v) * 0.01;
        if (Math.abs(u - 0.5) < 0.012) val = 0.93;
        const hd = Math.hypot((u - heart.cx) / heart.rx, (v - heart.cy) / heart.ry);
        if (hd <= 1) val = 0.885 + n1(u * 2, v * 2) * 0.012;
        // Klavikulalar
        if (Math.abs(v - 0.165) < 0.014 && Math.abs(u - 0.5) > 0.08 && Math.abs(u - 0.5) < 0.3) val = 0.9;
      }

      px[y * W + x] = Math.max(0, Math.min(1, val));
    }
  }
  return px;
}

function makeCase(id: string, opts: RenderOpts): CxrCase {
  const pixels = render(opts);
  const labels: Record<CxrLabel, boolean> = {
    Kardiyomegali: opts.cardiomegaly,
    "Plevral efüzyon": opts.effusion !== null,
    Konsolidasyon: opts.consolidation !== null,
    Pnömotoraks: opts.pneumothorax !== null,
    Nodül: opts.nodule !== null,
  };
  const slice = new Float32Array(pixels); // kopya: seri paylaşılmasın
  const series: SeriesData = {
    id,
    modality: "CR",
    description: "CHEST PA",
    bodyPart: "CHEST",
    patientName: "DOĞRULAMA PHANTOM",
    patientId: id,
    patientAge: "050Y",
    patientSex: "M",
    studyDate: "20260101",
    institution: "ATIKVIEWER DOĞRULAMA",
    studyUid: `1.2.826.0.1.3680043.10.999.${id}`,
    width: W,
    height: H,
    pixelSpacing: 0.7,
    sliceThickness: 0,
    defaultWL: 0.5,
    defaultWW: 1,
    unit: "SI",
    photometric: "MONOCHROME2",
    slices: [slice],
    lesions: [],
    tags: [],
    isSample: false,
  };
  return { id, series, labels };
}

/**
 * Etiketli set üretir: `perClass` vaka her bulgu sınıfı için + `normals` normal vaka.
 * Her anormal vakada TEK bulgu vardır (bulgular arası karışma ölçümü bozmasın).
 */
export function buildCxrDataset(seed = 4242, perClass = 20, normals = 40): CxrCase[] {
  const rnd = mulberry32(seed);
  const side = (): "R" | "L" => (rnd() < 0.5 ? "R" : "L");
  const cases: CxrCase[] = [];
  const base = (id: string, patch: Partial<RenderOpts>): CxrCase =>
    makeCase(id, {
      seed: Math.floor(rnd() * 1e6),
      cardiomegaly: false,
      effusion: null,
      consolidation: null,
      pneumothorax: null,
      nodule: null,
      ...patch,
    });

  for (let i = 0; i < normals; i++) cases.push(base(`normal-${seed}-${i}`, {}));
  for (let i = 0; i < perClass; i++) cases.push(base(`kardiyomegali-${seed}-${i}`, { cardiomegaly: true }));
  for (let i = 0; i < perClass; i++) cases.push(base(`efuzyon-${seed}-${i}`, { effusion: side() }));
  for (let i = 0; i < perClass; i++) cases.push(base(`konsolidasyon-${seed}-${i}`, { consolidation: side() }));
  for (let i = 0; i < perClass; i++) cases.push(base(`pnomotoraks-${seed}-${i}`, { pneumothorax: side() }));
  for (let i = 0; i < perClass; i++) cases.push(base(`nodul-${seed}-${i}`, { nodule: side() }));
  return cases;
}
