import type {
  DicomECGWaveform,
  DicomGSPS,
  DicomOverlayPlane,
  DicomSRDocument,
  DicomTag,
  EncapsulatedPDFDocument,
  Lesion,
  SeriesData,
} from "./types";

// ---------- deterministic RNG + value noise ----------
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeNoise(seed: number, grid = 48) {
  const rng = mulberry32(seed);
  const g = new Float32Array(grid * grid);
  for (let i = 0; i < g.length; i++) g[i] = rng();
  return (xIn: number, yIn: number) => {
    const x = ((xIn % 1) + 1) % 1;
    const y = ((yIn % 1) + 1) % 1;
    const fx = x * (grid - 1);
    const fy = y * (grid - 1);
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const x1 = Math.min(x0 + 1, grid - 1);
    const y1 = Math.min(y0 + 1, grid - 1);
    const tx = fx - x0;
    const ty = fy - y0;
    const a = g[y0 * grid + x0];
    const b = g[y0 * grid + x1];
    const c = g[y1 * grid + x0];
    const d = g[y1 * grid + x1];
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  };
}

const smooth = (t: number) => Math.max(0, Math.min(1, t)) ** 2 * (3 - 2 * Math.max(0, Math.min(1, t)));

function ellipseDist(px: number, py: number, cx: number, cy: number, rx: number, ry: number) {
  const dx = (px - cx) / rx;
  const dy = (py - cy) / ry;
  return Math.sqrt(dx * dx + dy * dy);
}

function commonTags(extra: Record<string, [string, string]>): DicomTag[] {
  const base: Record<string, [string, string]> = {
    "0008,0020": ["Study Date", "20260215"],
    "0008,0060": ["Modality", "CT"],
    "0008,0070": ["Manufacturer", "ATIK Medical Systems"],
    "0008,0080": ["Institution Name", "ARTVIN DEVLET HASTANESI"],
    "0008,1090": ["Model Name", "AtikScan Ultra 128"],
    "0010,0010": ["Patient Name", "MURAT UYGUR"],
    "0010,0020": ["Patient ID", "L7084261 SD"],
    "0010,0040": ["Patient Sex", "M"],
    "0010,1010": ["Patient Age", "054Y"],
    "0018,0050": ["Slice Thickness", "5.0"],
    "0028,0010": ["Rows", "256"],
    "0028,0011": ["Columns", "256"],
    "0028,0100": ["Bits Allocated", "16"],
    "0028,1050": ["Window Center", "40"],
    "0028,1051": ["Window Width", "80"],
    ...extra,
  };
  return Object.entries(base)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([tag, [name, value]]) => ({ tag: `(${tag})`, name, value }));
}

// ====================================================
// 1) CR — Akciğer Grafisi PA (Overlay + GSPS demo ile)
// ====================================================
function buildChestXray(): SeriesData {
  const W = 448;
  const H = 448;
  const n1 = makeNoise(11, 72);
  const n2 = makeNoise(23, 24);
  const px = new Float32Array(W * H);
  const nod = { cx: 0.655, cy: 0.42, r: 0.028 };

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W;
      const v = y / H;
      let val = 180 + n2(u, v) * 60;

      const body = ellipseDist(u, v, 0.5, 0.52, 0.42, 0.52);
      if (body < 1) {
        val = 620 + n1(u, v) * 80;
        const lungL = ellipseDist(u, v, 0.335, 0.42, 0.145, 0.27);
        const lungR = ellipseDist(u, v, 0.665, 0.42, 0.15, 0.28);
        const inL = lungL < 1;
        const inR = lungR < 1;
        if (inL || inR) {
          val = 300 + n1(u * 2, v * 2) * 110;
          const hx = inL ? 0.42 : 0.58;
          const ang = Math.atan2(v - 0.42, u - hx);
          val += Math.abs(Math.sin(ang * 9 + n1(u, v) * 4)) < 0.14 ? 70 : 0;
        }
        const rib = Math.sin((v + u * 0.12) * 46);
        if ((inL || inR) && rib > 0.78) val += 120;
        const heart = ellipseDist(u, v, 0.555, 0.56, 0.13, 0.16);
        if (heart < 1) val = Math.max(val, 640 + (1 - heart) * 60);
        if (Math.abs(u - 0.5) < 0.045) val = Math.max(val, 660 + Math.sin(v * 70) * 25);
        const diaL = 0.66 + Math.sin((u - 0.33) * 6) * 0.03;
        const diaR = 0.63 + Math.sin((u - 0.66) * 6) * 0.035;
        if ((inL && v > diaL) || (inR && v > diaR)) val = 650 + n1(u, v) * 50;
        if (Math.abs(v - (0.2 + Math.abs(u - 0.5) * 0.1)) < 0.012 && Math.abs(u - 0.5) < 0.3) val += 130;
        const nd = Math.hypot(u - nod.cx, v - nod.cy) / nod.r;
        if (nd < 1) val += 190 * smooth(1 - nd);
      }
      px[y * W + x] = val;
    }
  }

  // 6000 DICOM Overlay Plane demo
  const overlayMask = new Uint8Array(W * H);
  for (let y = 20; y < 40; y++) {
    for (let x = 20; x < 120; x++) {
      if (y === 20 || y === 39 || x === 20 || x === 119) overlayMask[y * W + x] = 1;
    }
  }

  const overlays: DicomOverlayPlane[] = [
    {
      group: 0x6000,
      rows: H,
      cols: W,
      originX: 1,
      originY: 1,
      data: overlayMask,
      type: "G",
      label: "Katman 0x6000 (Radyoloji Kalibrasyon Markörü)",
      visible: true,
    },
  ];

  const gsps: DicomGSPS[] = [
    {
      id: "gsps-cr-1",
      label: "GSPS Odak Çizgileri",
      description: "Pulmoner apeks ve kardiyak sınır anotasyonları",
      graphics: [
        { type: "ELLIPSE", data: [nod.cx * W, nod.cy * H, 20, 20] },
      ],
      texts: [{ text: "Soliter Nodül Alanı", anchorPoint: { x: nod.cx * W, y: (nod.cy - 0.06) * H } }],
    },
  ];

  const lesions: Lesion[] = [
    {
      sliceStart: 0,
      sliceEnd: 0,
      bbox: { x: nod.cx - 0.05, y: nod.cy - 0.05, w: 0.1, h: 0.1 },
      label: "Pulmoner nodül",
      detail: "Sağ akciğer orta zonda yaklaşık 12 mm çapında düzgün sınırlı nonkalsifiye nodül.",
      category: "Nodül",
      severity: "orta",
      confidence: 0.91,
      anatomicalLocation: "Sağ Akciğer Orta Zon",
      densityOrSignal: "Yumuşak Doku Dansitesi",
      sizeMmStr: "12 mm",
    },
  ];

  return {
    id: "cr-chest",
    modality: "CR",
    description: "Akciğer Grafisi PA",
    bodyPart: "TORAKS",
    patientName: "MURAT UYGUR",
    patientId: "L7084261 SD",
    patientAge: "54",
    patientSex: "M",
    studyDate: "20260215",
    institution: "ARTVİN DEVLET HASTANESİ",
    studyUid: "1.2.840.113619.2.55.1001",
    width: W,
    height: H,
    pixelSpacing: 0.7,
    sliceThickness: 0,
    defaultWL: 470,
    defaultWW: 850,
    unit: "SI",
    slices: [px],
    overlays,
    gsps,
    lesions,
    tags: commonTags({
      "0008,0060": ["Modality", "CR"],
      "0008,103E": ["Series Description", "CHEST PA DIRECT"],
      "0018,0015": ["Body Part Examined", "CHEST"],
      "0028,0010": ["Rows", String(H)],
      "0028,0011": ["Columns", String(W)],
      "0028,1050": ["Window Center", "470"],
      "0028,1051": ["Window Width", "850"],
    }),
    isSample: true,
  };
}

// ====================================================
// 2) CT — Beyin BT kontrastsız (26 kesit)
// ====================================================
function buildBrainCT(): SeriesData {
  const W = 256;
  const H = 256;
  const N = 26;
  const n1 = makeNoise(41, 64);
  const n2 = makeNoise(42, 20);
  const slices: Float32Array[] = [];
  const hem = { cx: 0.615, cy: 0.4, s0: 13, s1: 18 };

  for (let s = 0; s < N; s++) {
    const t = (s + 1) / (N + 1);
    const prof = Math.sin(Math.PI * t) ** 0.55;
    const px = new Float32Array(W * H);
    const vent = s >= 9 && s <= 17 ? 1 - Math.abs(s - 13) / 5 : 0;
    const hemAct = s >= hem.s0 && s <= hem.s1 ? 1 - Math.abs(s - (hem.s0 + hem.s1) / 2) / 3.2 : 0;

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const u = x / W;
        const v = y / H;
        let val = -1000;
        const d = ellipseDist(u, v, 0.5, 0.5, 0.345 * prof, 0.43 * prof);
        if (d < 1.16) val = 45 + n1(u, v) * 15;
        if (d < 1.1) val = 980 + n2(u, v) * 120;
        if (d < 0.96) {
          const gw = n1(u * 1.6, v * 1.6);
          val = 31 + gw * 10 + Math.sin(d * 22) * 2;
          if (d > 0.82 && n1(u * 3, v * 3) > 0.62) val = 12;
          if (Math.abs(u - 0.5) < 0.004 && (d < 0.4 || d > 0.6)) val = 55;
          if (vent > 0) {
            const vl = ellipseDist(u, v, 0.45, 0.47, 0.055 * vent + 0.015, 0.11 * vent + 0.02);
            const vr = ellipseDist(u, v, 0.55, 0.47, 0.055 * vent + 0.015, 0.11 * vent + 0.02);
            if (vl < 1 || vr < 1) val = 7 + n1(u * 4, v * 4) * 4;
          }
          if (hemAct > 0) {
            const hd = ellipseDist(u, v, hem.cx, hem.cy, 0.055 * hemAct + 0.012, 0.045 * hemAct + 0.01);
            if (hd < 1.6) val = Math.min(val, 22);
            if (hd < 1) val = 68 + smooth(1 - hd) * 14;
          }
        }
        px[y * W + x] = val;
      }
    }
    slices.push(px);
  }

  return {
    id: "ct-brain",
    modality: "CT",
    description: "Beyin BT (kontrastsız)",
    bodyPart: "BEYİN",
    patientName: "MURAT UYGUR",
    patientId: "L7084261 SD",
    patientAge: "54",
    patientSex: "M",
    studyDate: "20260215",
    institution: "ARTVİN DEVLET HASTANESİ",
    studyUid: "1.2.840.113619.2.55.1002",
    width: W,
    height: H,
    pixelSpacing: 0.9,
    sliceThickness: 5,
    defaultWL: 40,
    defaultWW: 80,
    unit: "HU",
    slices,
    lesions: [],
    tags: commonTags({
      "0008,103E": ["Series Description", "HEAD AXIAL 5MM"],
      "0018,0015": ["Body Part Examined", "HEAD"],
      "0018,0060": ["KVP", "120"],
      "0018,1151": ["X-Ray Tube Current", "320"],
    }),
    isSample: true,
  };
}

// ====================================================
// 3) CT — Toraks BT (32 kesit)
// ====================================================
function buildChestCT(): SeriesData {
  const W = 256;
  const H = 256;
  const N = 32;
  const n1 = makeNoise(71, 72);
  const n2 = makeNoise(72, 28);
  const slices: Float32Array[] = [];
  const nod = { cx: 0.67, cy: 0.42, s0: 15, s1: 21 };

  for (let s = 0; s < N; s++) {
    const t = (s + 1) / (N + 1);
    const prof = 0.72 + Math.sin(Math.PI * t) * 0.28;
    const lungProf = Math.sin(Math.PI * Math.min(1, Math.max(0, (t - 0.04) / 0.92))) ** 0.5;
    const px = new Float32Array(W * H);
    const nodAct = s >= nod.s0 && s <= nod.s1 ? 1 - Math.abs(s - (nod.s0 + nod.s1) / 2) / 4 : 0;

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const u = x / W;
        const v = y / H;
        let val = -1000;
        const body = ellipseDist(u, v, 0.5, 0.54, 0.43 * prof, 0.31 * prof);
        if (body < 1.07) val = -60 + n1(u, v) * 40;
        if (body < 1) {
          val = 35 + n1(u, v) * 25;
          const lL = ellipseDist(u, v, 0.345, 0.5, 0.155 * lungProf + 0.01, 0.21 * lungProf + 0.012);
          const lR = ellipseDist(u, v, 0.655, 0.5, 0.16 * lungProf + 0.01, 0.22 * lungProf + 0.012);
          if (lL < 1 || lR < 1) {
            val = -870 + n1(u * 2.4, v * 2.4) * 90;
            if (n1(u * 4 + s * 0.045, v * 4 + s * 0.03) > 0.76) val = -250 + n2(u, v) * 150;
            const hx = lL < 1 ? 0.42 : 0.58;
            if (Math.hypot(u - hx, v - 0.5) < 0.02) val = -990;
          }
          if (lL >= 1 && lR >= 1 && Math.abs(u - 0.5) < 0.12 && v > 0.42 && v < 0.68 && t > 0.35) {
            val = 45 + n2(u, v) * 20;
          }
          const sp = ellipseDist(u, v, 0.5, 0.77, 0.045, 0.05);
          if (sp < 1) val = 750 + n2(u, v) * 250;
          if (sp < 0.45) val = 150;
          if (ellipseDist(u, v, 0.5, 0.27, 0.035, 0.02) < 1) val = 600;
          const ribAng = Math.atan2(v - 0.54, u - 0.5);
          const ribR = ellipseDist(u, v, 0.5, 0.54, 0.41 * prof, 0.295 * prof);
          if (ribR > 0.93 && ribR < 1 && Math.abs(Math.sin(ribAng * 6 + s * 0.4)) > 0.55) val = 700;
          if (nodAct > 0 && lR < 1) {
            const ndd = ellipseDist(u, v, nod.cx, nod.cy, 0.034 * nodAct + 0.006, 0.03 * nodAct + 0.006);
            if (ndd < 1.4 && ndd >= 1) val = Math.max(val, -600);
            if (ndd < 1) val = -20 + smooth(1 - ndd) * 50;
          }
        }
        px[y * W + x] = val;
      }
    }
    slices.push(px);
  }

  return {
    id: "ct-chest",
    modality: "CT",
    description: "Toraks BT (akciğer penceresi)",
    bodyPart: "TORAKS",
    patientName: "MURAT UYGUR",
    patientId: "L7084261 SD",
    patientAge: "54",
    patientSex: "M",
    studyDate: "20260215",
    institution: "ARTVİN DEVLET HASTANESİ",
    studyUid: "1.2.840.113619.2.55.1003",
    width: W,
    height: H,
    pixelSpacing: 1.2,
    sliceThickness: 3,
    defaultWL: -600,
    defaultWW: 1500,
    unit: "HU",
    slices,
    lesions: [],
    tags: commonTags({
      "0008,103E": ["Series Description", "THORAX AXIAL LUNG 3MM"],
      "0018,0015": ["Body Part Examined", "CHEST"],
      "0018,0060": ["KVP", "120"],
      "0028,1050": ["Window Center", "-600"],
      "0028,1051": ["Window Width", "1500"],
    }),
    isSample: true,
  };
}

// ====================================================
// 4) MR — Beyin / Orbit MR (24 kesit)
// ====================================================
function buildBrainMR(): SeriesData {
  const W = 256;
  const H = 256;
  const N = 24;
  const n1 = makeNoise(91, 64);
  const n2 = makeNoise(92, 32);
  const slices: Float32Array[] = [];
  const les = { cx: 0.56, cy: 0.38, s0: 9, s1: 14 };

  for (let s = 0; s < N; s++) {
    const t = (s + 1) / (N + 1);
    const prof = Math.sin(Math.PI * t) ** 0.5;
    const mid = 1 - Math.abs(t - 0.5) * 2;
    const px = new Float32Array(W * H);
    const lesAct = s >= les.s0 && s <= les.s1 ? 1 - Math.abs(s - (les.s0 + les.s1) / 2) / 3.5 : 0;

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const u = x / W;
        const v = y / H;
        let val = 30 + n1(u, v) * 25;
        const head = ellipseDist(u, v, 0.5, 0.46, 0.36 * prof, 0.4 * prof);
        if (head < 1.1) val = 620 + n1(u, v) * 120;
        if (head < 1.02) val = 90 + n1(u, v) * 40;
        if (head < 0.92) {
          val = 460 + n1(u * 1.8, v * 1.8) * 120;
          if (head > 0.84) val = 760 + n2(u, v) * 80;
          if (n1(u * 3.4, v * 3.4) > 0.64) val = 380;
          if (mid > 0.6) {
            const cc = ellipseDist(u, v, 0.5, 0.42, 0.13, 0.035);
            if (cc < 1 && cc > 0.62) val = 330;
            const lv = ellipseDist(u, v, 0.5, 0.45, 0.1 * mid, 0.03 * mid + 0.008);
            if (lv < 1) val = 900 + n2(u, v) * 60;
            const bs = ellipseDist(u, v, 0.44, 0.63, 0.045, 0.1);
            if (bs < 1) val = 420;
            const cb = ellipseDist(u, v, 0.37, 0.66, 0.085, 0.075);
            if (cb < 1) val = 440 + (n1(u * 6, v * 6) > 0.5 ? 90 : 0);
          }
          if (lesAct > 0) {
            const ld = ellipseDist(u, v, les.cx, les.cy, 0.045 * lesAct + 0.008, 0.035 * lesAct + 0.007);
            if (ld < 1) val = 880 + smooth(1 - ld) * 80;
          }
        }
        px[y * W + x] = val;
      }
    }
    slices.push(px);
  }

  const lesions: Lesion[] = [
    {
      sliceStart: les.s0,
      sliceEnd: les.s1,
      bbox: { x: les.cx - 0.08, y: les.cy - 0.07, w: 0.16, h: 0.14 },
      label: "Sağ maksiller sinüste mukozal kalınlaşma",
      detail: "Sağ maksiller sinüste parsiyel havalanma kaybı ve mukozal hipertrofi ile uyumlu T2 FLAIR hiperintens içerik.",
      category: "Sinüs / Mukoza",
      severity: "orta",
      confidence: 0.88,
      anatomicalLocation: "Sağ Maksiller Sinüs",
      densityOrSignal: "T2 FLAIR Hiperintens",
      sizeMmStr: "16×11 mm",
    },
  ];

  return {
    id: "mr-brain",
    modality: "MR",
    description: "Beyin / Orbit MR (T2 FLAIR)",
    bodyPart: "ORBIT",
    patientName: "MURAT UYGUR",
    patientId: "L7084261 SD",
    patientAge: "54",
    patientSex: "M",
    studyDate: "20170711",
    institution: "ARTVİN DEVLET HASTANESİ",
    studyUid: "1.2.840.113619.2.55.1004",
    width: W,
    height: H,
    pixelSpacing: 0.9,
    sliceThickness: 5,
    defaultWL: 480,
    defaultWW: 950,
    unit: "SI",
    slices,
    lesions,
    tags: commonTags({
      "0008,0060": ["Modality", "MR"],
      "0008,103E": ["Series Description", "BEYIN EK T2 FLAIR 5MM"],
      "0018,0015": ["Body Part Examined", "ORBIT"],
      "0018,0080": ["Repetition Time", "4500"],
      "0018,0081": ["Echo Time", "95"],
      "0018,0087": ["Magnetic Field Strength", "1.5"],
      "0028,1050": ["Window Center", "480"],
      "0028,1051": ["Window Width", "950"],
    }),
    isSample: true,
  };
}

// ====================================================
// 5) US — Renkli Doppler Ultrason (True RGB Color Multi-frame Cine)
// ====================================================
function buildColorUS(): SeriesData {
  const W = 320;
  const H = 240;
  const N = 12; // 12 frames multi-frame cine
  const slices: Int16Array[] = [];
  const rgbaSlices: Uint32Array[] = [];

  for (let f = 0; f < N; f++) {
    const px = new Int16Array(W * H);
    const rgba = new Uint32Array(W * H);
    const phase = (f / N) * Math.PI * 2;
    const pulse = Math.sin(phase);

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const u = x / W;
        const v = y / H;
        const idx = y * W + x;

        // Sector shape
        const angle = Math.atan2(u - 0.5, v);
        const radius = Math.hypot(u - 0.5, v);

        if (radius > 0.15 && radius < 0.95 && Math.abs(angle) < 0.65) {
          const tissueGray = Math.floor(40 + Math.sin(radius * 30 + angle * 10) * 20 + Math.random() * 15);
          let r = tissueGray;
          let g = tissueGray;
          let b = tissueGray;

          // Color Doppler Jet in center (Carotid artery flow)
          const inVessel = ellipseDist(u, v, 0.5, 0.55, 0.12, 0.08) < 1;
          if (inVessel) {
            if (pulse >= 0) {
              // Red/Yellow systolic forward flow
              r = Math.floor(180 + pulse * 75);
              g = Math.floor(pulse * 140);
              b = 20;
            } else {
              // Blue diastolic flow
              r = 20;
              g = Math.floor(Math.abs(pulse) * 120);
              b = Math.floor(180 + Math.abs(pulse) * 75);
            }
          }

          px[idx] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
          rgba[idx] = 0xff000000 | (b << 16) | (g << 8) | r;
        } else {
          px[idx] = 0;
          rgba[idx] = 0xff000000;
        }
      }
    }
    slices.push(px);
    rgbaSlices.push(rgba);
  }

  return {
    id: "us-color-doppler",
    modality: "US",
    description: "Karotis Renkli Doppler USG (Cine)",
    bodyPart: "BOYUN",
    patientName: "MURAT UYGUR",
    patientId: "L7084261 SD",
    patientAge: "54",
    patientSex: "M",
    studyDate: "20260215",
    institution: "ARTVİN DEVLET HASTANESİ",
    studyUid: "1.2.840.113619.2.55.1005",
    width: W,
    height: H,
    pixelSpacing: 0.35,
    sliceThickness: 0,
    defaultWL: 128,
    defaultWW: 256,
    unit: "RGB",
    photometric: "RGB",
    isColor: true,
    rgbaSlices,
    slices,
    lesions: [],
    tags: commonTags({
      "0008,0060": ["Modality", "US"],
      "0008,103E": ["Series Description", "CAROTID COLOR DOPPLER CINE"],
      "0028,0004": ["Photometric Interpretation", "RGB"],
      "0028,0008": ["Number of Frames", "12"],
    }),
    isSample: true,
  };
}

// ====================================================
// 6) SR — DICOM Structured Report (Yapısal Rapor)
// ====================================================
function buildDemoSR(): SeriesData {
  const srData: DicomSRDocument = {
    id: "sr-demo-1",
    title: "Meme CAD / Tiroid Yapısal Bulgular Raporu (TID 4200)",
    sopInstanceUid: "1.2.840.10008.5.1.4.1.1.88.33.2026",
    completionFlag: "COMPLETE",
    verificationFlag: "VERIFIED",
    root: {
      id: "sr-root",
      valueType: "CONTAINER",
      relationship: undefined,
      conceptName: { code: "111036", scheme: "DCM", meaning: "Mamografi / Tiroid CAD Raporu" },
      children: [
        {
          id: "sr-c1",
          valueType: "CONTAINER",
          relationship: "CONTAINS",
          conceptName: { code: "111028", scheme: "DCM", meaning: "Görüntüleme Bulguları Özeti" },
          children: [
            {
              id: "sr-f1",
              valueType: "TEXT",
              relationship: "CONTAINS",
              conceptName: { code: "111059", scheme: "DCM", meaning: "Lezyon Tanımı" },
              textValue: "Sağ üst kadranda 14 mm boyutunda spiküle kenarlı hipoekoik solid lezyon saptandı (BI-RADS 4C).",
              referencedSlice: 16,
            },
            {
              id: "sr-m1",
              valueType: "NUM",
              relationship: "HAS PROPERTIES",
              conceptName: { code: "121206", scheme: "DCM", meaning: "Maksimum Lezyon Çapı" },
              numValue: { value: 14.2, unit: "mm" },
            },
            {
              id: "sr-code1",
              valueType: "CODE",
              relationship: "HAS PROPERTIES",
              conceptName: { code: "111031", scheme: "DCM", meaning: "BI-RADS / TI-RADS Değerlendirmesi" },
              codeValue: { code: "F-017D4", scheme: "SRT", meaning: "Kategori 4C (Yüksek Malignite Şüphesi)" },
            },
          ],
        },
        {
          id: "sr-c2",
          valueType: "CONTAINER",
          relationship: "CONTAINS",
          conceptName: { code: "111023", scheme: "DCM", meaning: "Klinik Öneri ve Takip" },
          children: [
            {
              id: "sr-rec1",
              valueType: "TEXT",
              relationship: "CONTAINS",
              conceptName: { code: "111025", scheme: "DCM", meaning: "Önerilen İşlem" },
              textValue: "US eşliğinde kalın iğne biyopsisi (Tru-cut) ve histopatolojik korelasyon önerilir.",
            },
          ],
        },
      ],
    },
  };

  return {
    id: "sr-sample-case",
    modality: "SR",
    description: "CAD Yapısal Rapor (TID 4200)",
    bodyPart: "MEME / TIROID",
    patientName: "MURAT UYGUR",
    patientId: "L7084261 SD",
    patientAge: "54",
    patientSex: "M",
    studyDate: "20260215",
    institution: "ARTVİN DEVLET HASTANESİ",
    studyUid: "1.2.840.113619.2.55.1006",
    width: 256,
    height: 256,
    pixelSpacing: 1,
    sliceThickness: 0,
    defaultWL: 128,
    defaultWW: 256,
    unit: "SI",
    specialType: "sr",
    srData,
    slices: [new Int16Array(256 * 256)],
    lesions: [],
    tags: commonTags({
      "0008,0060": ["Modality", "SR"],
      "0008,103E": ["Series Description", "MAMMOGRAPHY CAD STRUCTURED REPORT"],
    }),
    isSample: true,
  };
}

// ====================================================
// 7) PDF — DICOM Encapsulated PDF Document
// ====================================================
function buildDemoPDF(): SeriesData {
  // Simple valid minimal data URL PDF document (1-page Medical Consultation Note)
  const pdfDataUrl =
    "data:application/pdf;base64,JVBERi0xLjQKJcTl8uXrCjEgMCBvYmoKPDwKL1RpdGxlIChSQURZT0xPSkkgS09OU1VMVEFTWU9OIFJBUE9SVSkKL0NyZWF0b3IgKEFUSUtWSUVXRVIgTUVESUNBTCkKPj4KZW5kb2JqCjIgMCBvYmoKPDwKL1R5cGUgL0NhdGFsb2cKL1BhZ2VzIDMgMCBSCj4+CmVuZG9iagozIDAgb2JqCjw8Ci9UeXBlIC9QYWdlcwovS2lkcyBbNCAwIFJdCi9Db3VudCAxCj4+CmVuZG9iago0IDAgb2JqCjw8Ci9UeXBlIC9QYWdlCi9QYXJlbnQgMyAwIFIKL01lZGlhQm94IFswIDAgNTk1IDg0Ml0KL0NvbnRlbnRzIDUgMCBSCj4+CmVuZG9iago1IDAgb2JqCjw8Ci9MZW5ndGggMTI4Cj4+CnN0cmVhbQpCVAovSGVsdiAyMCBUZgoxMDAgNzUwIFRkCihBVElLVklFV0VSIC0gUkFEWU9MT0pJIEtPTlNVTFRBU1lPTiBSQVBPUlUpIFRqCi9IZWx2IDEyIFRmCjAgLTQwIFRkCihIYXN0YTogTVVSQVQgVVlHVVIgICAkSGFzdGEgSUQ6IEw3MDg0MjYxIFNEKSBUagowIC0yNSBUZAooVGFyaWg6IDE1LjAyLjIwMjYgICAkVHVtIHNlcmlsZXIgZXZhbHVhdGVkLikgVGoKRVQKZW5kc3RyZWFtCmVuZG9iagp4cmVmCjAgNgowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMTUgMDAwMDAgbiAKMDAwMDAwMDA5NiAwMDAwMCBuIAowMDAwMDAwMTQ2MDAwMDAgbiAKMDAwMDAwMDIwNCAwMDAwMCBuIAowMDAwMDAwMjg4IDAwMDAwIG4gCnRyYWlsZXIKPDwKL1NpemUgNgovUm9vdCAyIDAgUgo+PgpzdGFydHhyZWYKNDY3CiUlRU9G";

  const pdfDoc: EncapsulatedPDFDocument = {
    id: "pdf-demo-1",
    title: "Klinik Konsültasyon ve Epikriz Belgesi (DICOM PDF)",
    sopInstanceUid: "1.2.840.10008.5.1.4.1.1.104.1.2026",
    dataUrl: pdfDataUrl,
    sizeBytes: 1024,
  };

  return {
    id: "pdf-sample-case",
    modality: "DOC",
    description: "DICOM Konsültasyon Raporu (PDF)",
    bodyPart: "RAPOR",
    patientName: "MURAT UYGUR",
    patientId: "L7084261 SD",
    patientAge: "54",
    patientSex: "M",
    studyDate: "20260215",
    institution: "ARTVİN DEVLET HASTANESİ",
    studyUid: "1.2.840.113619.2.55.1007",
    width: 256,
    height: 256,
    pixelSpacing: 1,
    sliceThickness: 0,
    defaultWL: 128,
    defaultWW: 256,
    unit: "SI",
    specialType: "pdf",
    pdfData: pdfDoc,
    slices: [new Int16Array(256 * 256)],
    lesions: [],
    tags: commonTags({
      "0008,0060": ["Modality", "DOC"],
      "0008,103E": ["Series Description", "ENCAPSULATED MEDICAL PDF REPORT"],
    }),
    isSample: true,
  };
}

// ====================================================
// 8) ECG — 12-Derivasyonlu Diyagnostik EKG (Waveform)
// ====================================================
function buildDemoECG(): SeriesData {
  const freq = 500; // 500 Hz sampling
  const duration = 10; // 10 seconds
  const totalSamples = freq * duration; // 5000 samples

  const leads = ["I", "II", "III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6"];
  const hr = 72; // 72 bpm
  const rIntervalSec = 60 / hr; // ~0.833s

  const channels = leads.map((leadName, leadIdx) => {
    const samples = new Float32Array(totalSamples);
    const polarity = leadName === "aVR" ? -1 : 1;
    const vScale = leadName.startsWith("V") ? 1.4 : 1.0;

    for (let s = 0; s < totalSamples; s++) {
      const t = s / freq;
      const beatTime = t % rIntervalSec; // time within current cardiac cycle

      let val = 0;
      // Baseline wander
      val += Math.sin(t * 0.5) * 0.05;

      // P wave (0.12 - 0.20s): small round
      if (beatTime > 0.12 && beatTime < 0.2) {
        val += Math.sin(((beatTime - 0.12) / 0.08) * Math.PI) * 0.15;
      }

      // QRS Complex (0.22 - 0.30s)
      if (beatTime >= 0.22 && beatTime < 0.24) {
        // Q wave
        val -= 0.15;
      } else if (beatTime >= 0.24 && beatTime < 0.27) {
        // R wave (sharp peak ~1.2 mV)
        val += 1.25 * ((beatTime - 0.24) / 0.015 > 1 ? 2 - (beatTime - 0.24) / 0.015 : (beatTime - 0.24) / 0.015);
      } else if (beatTime >= 0.27 && beatTime < 0.29) {
        // S wave
        val -= 0.25;
      }

      // T wave (0.38 - 0.52s)
      if (beatTime > 0.38 && beatTime < 0.52) {
        val += Math.sin(((beatTime - 0.38) / 0.14) * Math.PI) * 0.35;
      }

      samples[s] = val * polarity * vScale;
    }

    return {
      leadName,
      samples,
      samplingFrequency: freq,
      sensitivity: 10,
    };
  });

  const ecgData: DicomECGWaveform = {
    id: "ecg-demo-1",
    title: "12-Derivasyonlu İstirahat EKG (500 Hz, 10s)",
    samplingFrequency: freq,
    durationSec: duration,
    channels,
  };

  return {
    id: "ecg-sample-case",
    modality: "ECG",
    description: "12-Derivasyonlu Diyagnostik EKG",
    bodyPart: "KALP",
    patientName: "MURAT UYGUR",
    patientId: "L7084261 SD",
    patientAge: "54",
    patientSex: "M",
    studyDate: "20260215",
    institution: "ARTVİN DEVLET HASTANESİ",
    studyUid: "1.2.840.113619.2.55.1008",
    width: 256,
    height: 256,
    pixelSpacing: 1,
    sliceThickness: 0,
    defaultWL: 128,
    defaultWW: 256,
    unit: "mV",
    specialType: "ecg",
    ecgData,
    slices: [new Int16Array(256 * 256)],
    lesions: [],
    tags: commonTags({
      "0008,0060": ["Modality", "ECG"],
      "0008,103E": ["Series Description", "12-LEAD RESTING DIAGNOSTIC ECG"],
    }),
    isSample: true,
  };
}

export interface SampleCaseInfo {
  id: string;
  modality: string;
  title: string;
  subtitle: string;
  sliceCount: number;
}

export const SAMPLE_CASE_INFOS: SampleCaseInfo[] = [
  { id: "mr-brain", modality: "MR", title: "Beyin / Orbit MR (T2 FLAIR)", subtitle: "24 kesit · Murat Uygur", sliceCount: 24 },
  { id: "ct-brain", modality: "CT", title: "Beyin BT (kontrastsız)", subtitle: "26 kesit · Akut Kanama", sliceCount: 26 },
  { id: "ct-chest", modality: "CT", title: "Toraks BT (akciğer penceresi)", subtitle: "32 kesit · Spiküle Nodül", sliceCount: 32 },
  { id: "cr-chest", modality: "CR", title: "Akciğer Grafisi PA", subtitle: "Katman 0x6000 + GSPS Anotasyon", sliceCount: 1 },
  { id: "us-color-doppler", modality: "US", title: "Renkli Doppler USG (Cine)", subtitle: "True RGB 32-bit · 12 Kare", sliceCount: 12 },
  { id: "sr-sample-case", modality: "SR", title: "DICOM Yapısal Rapor (SR)", subtitle: "Meme/Tiroid CAD Ağacı", sliceCount: 1 },
  { id: "pdf-sample-case", modality: "DOC", title: "DICOM Encapsulated PDF", subtitle: "Tıbbi Konsültasyon Raporu", sliceCount: 1 },
  { id: "ecg-sample-case", modality: "ECG", title: "12-Derivasyonlu EKG", subtitle: "500 Hz · 12 Kanal + Ritim", sliceCount: 1 },
];

const cache = new Map<string, SeriesData>();

export function buildSampleCase(id: string): SeriesData | null {
  if (cache.has(id)) return cache.get(id)!;
  let s: SeriesData | null = null;
  if (id === "mr-brain") s = buildBrainMR();
  else if (id === "ct-brain") s = buildBrainCT();
  else if (id === "ct-chest") s = buildChestCT();
  else if (id === "cr-chest") s = buildChestXray();
  else if (id === "us-color-doppler") s = buildColorUS();
  else if (id === "sr-sample-case") s = buildDemoSR();
  else if (id === "pdf-sample-case") s = buildDemoPDF();
  else if (id === "ecg-sample-case") s = buildDemoECG();

  if (s) {
    s.sliceSpacing = s.sliceThickness || 1;
    if (id === "ct-brain" || id === "ct-chest") {
      s.lesions = [];
      s.orientation = [1, 0, 0, 0, 1, 0];
    }
    cache.set(id, s);
  }
  return s;
}
