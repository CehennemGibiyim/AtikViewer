import { parseDicom, type DicomDataSet } from "dicom-parser";
import { inflateSync, unzipSync } from "fflate";
import { assertNotAborted, withImportTimeout } from "./importOperation";
import type { DicomOverlayPlane, DicomTag, PaletteColorLUT, Pixels, SeriesData } from "./types";
import { suvFromDataset, parseTm } from "./suv";
import { applyCharset } from "./dicomCharset";
import { codecName, decodeEncapsulatedFrames, isCodecSupported, type RawFrame } from "./codecs";
import {
  isSOPClass,
  parseECGWaveform,
  parseEncapsulatedPDF,
  parseOverlayPlanes,
  parsePaletteColorLUT,
  parsePresentationState,
  parseStructuredReport,
  SOP_ENCAPSULATED_PDF,
  SOP_GSPS,
  SOP_PREFIX_ECG,
  SOP_PREFIX_SR,
} from "./dicomSpecial";

const TAG_NAMES: Record<string, string> = {
  x00020010: "Transfer Syntax UID", x00080008: "Image Type", x00080016: "SOP Class UID",
  x00080018: "SOP Instance UID", x00080020: "Study Date", x00080030: "Study Time",
  x00080050: "Accession Number", x00080060: "Modality", x00080070: "Manufacturer",
  x00080080: "Institution Name", x00081030: "Study Description", x0008103e: "Series Description",
  x00081090: "Model Name", x00100010: "Patient Name", x00100020: "Patient ID",
  x00100030: "Patient Birth Date", x00100040: "Patient Sex", x00101010: "Patient Age",
  x00180015: "Body Part Examined", x00180050: "Slice Thickness", x00180060: "KVP",
  x00180080: "Repetition Time", x00180081: "Echo Time", x00180087: "Magnetic Field Strength",
  x00181151: "X-Ray Tube Current", x0020000d: "Study Instance UID", x0020000e: "Series Instance UID",
  x00200011: "Series Number", x00200013: "Instance Number", x00200032: "Image Position (Patient)",
  x00200037: "Image Orientation (Patient)", x00200052: "Frame of Reference UID",
  x00201041: "Slice Location", x00280002: "Samples Per Pixel", x00280004: "Photometric Interpretation",
  x00280006: "Planar Configuration", x00280008: "Number of Frames", x00280010: "Rows",
  x00280011: "Columns", x00280030: "Pixel Spacing", x00280100: "Bits Allocated",
  x00280101: "Bits Stored", x00280102: "High Bit", x00280103: "Pixel Representation",
  x00281050: "Window Center", x00281051: "Window Width", x00281052: "Rescale Intercept",
  x00281053: "Rescale Slope",
};

const TS_EXPLICIT_BE = "1.2.840.10008.1.2.2";
const UNCOMPRESSED = new Set(["1.2.840.10008.1.2", "1.2.840.10008.1.2.1", "1.2.840.10008.1.2.1.99", TS_EXPLICIT_BE]);

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "webp", "bmp"]);
const SKIP_EXT = new Set(["txt", "xml", "htm", "html", "js", "css", "exe", "dll", "inf", "ini", "db", "log", "json", "md", "lnk", "ds_store"]);

interface ParsedSlice {
  seriesUid: string;
  instanceNumber: number;
  sliceLocation: number;
  posKey: number | null;
  pixels: Pixels;
  rgba?: Uint32Array;
  width: number;
  height: number;
  photometric: string;
  isColor: boolean;
  overlays?: DicomOverlayPlane[];
  ipp?: number[];
  sopUid?: string;
  seriesTimeS?: number | null;
  file: File;
}

// ───────────── Piksel çıkarma ─────────────
interface PixelInfo {
  rows: number;
  cols: number;
  bitsAllocated: number;
  bitsStored: number;
  pixelRep: number;
  samples: number;
  frames: number;
  planar: boolean;
  photometric: string;
}

function readInfo(ds: DicomDataSet): PixelInfo | null {
  const rows = ds.uint16("x00280010");
  const cols = ds.uint16("x00280011");
  if (!rows || !cols || !ds.elements["x7fe00010"]) return null;
  const bitsAllocated = ds.uint16("x00280100") ?? 16;
  return {
    rows,
    cols,
    bitsAllocated,
    bitsStored: ds.uint16("x00280101") ?? bitsAllocated,
    pixelRep: ds.uint16("x00280103") ?? 0,
    samples: ds.uint16("x00280002") ?? 1,
    frames: Math.max(1, ds.intString("x00280008") ?? 1),
    planar: (ds.uint16("x00280006") ?? 0) === 1,
    photometric: (ds.string("x00280004") ?? "MONOCHROME2").trim().toUpperCase(),
  };
}

/** Sıkıştırılmamış piksel verisini oku. */
function readNative(ds: DicomDataSet, info: PixelInfo, bigEndian: boolean): RawFrame[] {
  const el = ds.elements["x7fe00010"];
  if (info.bitsAllocated !== 8 && info.bitsAllocated !== 16) {
    throw new Error(`${info.bitsAllocated} bit piksel desteklenmiyor`);
  }
  const buf = ds.byteArray.buffer as ArrayBuffer;
  const base = ds.byteArray.byteOffset + el.dataOffset;
  const limit = ds.byteArray.byteOffset + ds.byteArray.byteLength;
  const per = info.rows * info.cols * info.samples;
  const bytesPer = info.bitsAllocated >> 3;
  const out: RawFrame[] = [];

  for (let f = 0; f < info.frames; f++) {
    const offset = base + f * per * bytesPer;
    if (offset + per * bytesPer > limit) break;
    if (bytesPer === 1) {
      let arr = new Uint8Array(buf.slice(offset, offset + per));
      if (info.samples === 3 && info.planar) {
        const px = info.rows * info.cols;
        const inter = new Uint8Array(per);
        for (let i = 0; i < px; i++) {
          inter[i * 3] = arr[i];
          inter[i * 3 + 1] = arr[px + i];
          inter[i * 3 + 2] = arr[2 * px + i];
        }
        arr = inter;
      }
      out.push(arr);
    } else {
      const copy = new Uint8Array(buf.slice(offset, offset + per * 2));
      if (bigEndian) {
        for (let i = 0; i + 1 < copy.length; i += 2) {
          const t = copy[i];
          copy[i] = copy[i + 1];
          copy[i + 1] = t;
        }
      }
      out.push(info.pixelRep === 1 ? new Int16Array(copy.buffer) : new Uint16Array(copy.buffer));
    }
  }
  return out;
}

/** Palette Color LUT ile 32-bit RGBA tamponu oluşturur. */
function applyPaletteColor(raw: RawFrame, lut: PaletteColorLUT, n: number): Uint32Array {
  const rgba = new Uint32Array(n);
  const { r, g, b, firstMapped, numEntries } = lut;

  for (let i = 0; i < n; i++) {
    const idx = raw[i];
    const mappedIdx = Math.max(0, Math.min(numEntries - 1, idx - firstMapped));
    const red = r[mappedIdx] || 0;
    const green = g[mappedIdx] || 0;
    const blue = b[mappedIdx] || 0;

    // Convert to 8-bit if 16-bit LUT
    const r8 = lut.bits === 16 ? red >> 8 : red;
    const g8 = lut.bits === 16 ? green >> 8 : green;
    const b8 = lut.bits === 16 ? blue >> 8 : blue;

    rgba[i] = 0xff000000 | (b8 << 16) | (g8 << 8) | r8;
  }

  return rgba;
}

/** True Color RGB tamponunu 32-bit RGBA tamponuna çevirir. */
function buildColorRgba(raw: RawFrame, n: number, ybrRaw: boolean): Uint32Array {
  const rgba = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    const r = raw[i * 3];
    const g = raw[i * 3 + 1];
    const b = raw[i * 3 + 2];

    let r8 = r, g8 = g, b8 = b;
    if (ybrRaw) {
      // YCbCr to RGB conversion if needed
      const y = r, cb = g - 128, cr = b - 128;
      r8 = Math.max(0, Math.min(255, y + 1.402 * cr));
      g8 = Math.max(0, Math.min(255, y - 0.344136 * cb - 0.714136 * cr));
      b8 = Math.max(0, Math.min(255, y + 1.772 * cb));
    }

    rgba[i] = 0xff000000 | (b8 << 16) | (g8 << 8) | r8;
  }
  return rgba;
}

/** Gri tonlamaya çevir, bit maskesi/işaret uygula, Rescale Slope/Intercept uygula, kompakt tipe paketle. */
function toPixels(
  raw: RawFrame,
  info: PixelInfo,
  slope: number,
  intercept: number,
  ybrRaw: boolean,
  paletteLut?: PaletteColorLUT | null
): { pixels: Pixels; rgba?: Uint32Array; isColor: boolean } {
  const n = info.rows * info.cols;
  const isColor = info.samples >= 3 || info.photometric === "PALETTE COLOR";

  let rgba: Uint32Array | undefined = undefined;
  if (paletteLut && info.photometric === "PALETTE COLOR") {
    rgba = applyPaletteColor(raw, paletteLut, n);
  } else if (info.samples >= 3) {
    rgba = buildColorRgba(raw, n, ybrRaw);
  }

  const out = new Float32Array(n);
  if (info.samples >= 3) {
    const useY = ybrRaw && info.photometric.startsWith("YBR");
    for (let i = 0; i < n; i++) {
      const r = raw[i * 3];
      const lum = useY ? r : 0.299 * r + 0.587 * raw[i * 3 + 1] + 0.114 * raw[i * 3 + 2];
      out[i] = lum * slope + intercept;
    }
  } else if (info.bitsAllocated === 16 && info.bitsStored < 16) {
    const shift = 32 - info.bitsStored;
    const mask = (1 << info.bitsStored) - 1;
    const signed = info.pixelRep === 1;
    for (let i = 0; i < n; i++) {
      const v = signed ? (raw[i] << shift) >> shift : raw[i] & mask;
      out[i] = v * slope + intercept;
    }
  } else {
    for (let i = 0; i < n; i++) out[i] = raw[i] * slope + intercept;
  }

  return { pixels: packPixels(out), rgba, isColor };
}

function packPixels(f: Float32Array): Pixels {
  let min = Infinity;
  let max = -Infinity;
  let integral = true;
  for (let i = 0; i < f.length; i++) {
    const v = f[i];
    if (v < min) min = v;
    if (v > max) max = v;
    if (integral && v !== Math.round(v)) integral = false;
  }
  if (integral && min >= -32768 && max <= 32767) {
    const o = new Int16Array(f.length);
    for (let i = 0; i < f.length; i++) o[i] = f[i];
    return o;
  }
  if (integral && min >= 0 && max <= 65535) {
    const o = new Uint16Array(f.length);
    for (let i = 0; i < f.length; i++) o[i] = f[i];
    return o;
  }
  return f;
}

async function decodePixels(
  ds: DicomDataSet,
  ts: string | undefined,
  paletteLut?: PaletteColorLUT | null
): Promise<{ frames: Pixels[]; rgbaFrames?: Uint32Array[]; isColor: boolean; width: number; height: number } | null> {
  const info = readInfo(ds);
  if (!info) return null;
  const el = ds.elements["x7fe00010"];
  const slope = ds.floatString("x00281053") ?? 1;
  const intercept = ds.floatString("x00281052") ?? 0;
  const encapsulated = !!el.encapsulatedPixelData;
  const raws = encapsulated
    ? await decodeEncapsulatedFrames(ds, el, ts ?? "", info)
    : readNative(ds, info, ts === TS_EXPLICIT_BE);
  if (raws.length === 0) return null;
  const ybrRaw = !encapsulated || ts === "1.2.840.10008.1.2.5";

  const processed = raws.map((r) => toPixels(r, info, slope, intercept, ybrRaw, paletteLut));
  const frames = processed.map((p) => p.pixels);
  const rgbaFrames = processed.some((p) => p.rgba) ? processed.map((p) => p.rgba!) : undefined;
  const isColor = processed.some((p) => p.isColor);

  return { frames, rgbaFrames, isColor, width: info.cols, height: info.rows };
}

// ───────────── Yardımcılar ─────────────
function sliceKey(ds: DicomDataSet): number | null {
  const ipp = ds.string("x00200032");
  const iop = ds.string("x00200037");
  if (!ipp || !iop) return null;
  const p = ipp.split("\\").map(Number);
  const o = iop.split("\\").map(Number);
  if (p.length < 3 || o.length < 6 || [...p.slice(0, 3), ...o.slice(0, 6)].some((n) => Number.isNaN(n))) return null;
  const nx = o[1] * o[5] - o[2] * o[4];
  const ny = o[2] * o[3] - o[0] * o[5];
  const nz = o[0] * o[4] - o[1] * o[3];
  return p[0] * nx + p[1] * ny + p[2] * nz;
}

function parseVec3(s: string | undefined): number[] | undefined {
  if (!s) return undefined;
  const p = s.split("\\").map(Number);
  return p.length >= 3 && !p.slice(0, 3).some(Number.isNaN) ? p.slice(0, 3) : undefined;
}

function collectTags(ds: DicomDataSet): DicomTag[] {
  const tags: DicomTag[] = [];
  for (const key of Object.keys(ds.elements).sort()) {
    const el = ds.elements[key];
    if (key === "x7fe00010") {
      tags.push({ tag: "(7FE0,0010)", name: "Pixel Data", value: `<${el.length} bayt${el.encapsulatedPixelData ? ", sıkıştırılmış" : ""}>` });
      continue;
    }
    if (el.length > 256) continue;
    let value = "";
    try {
      value = ds.string(key) ?? "";
    } catch {
      value = "";
    }
    if (!value) continue;
    tags.push({ tag: `(${key.slice(1, 5).toUpperCase()},${key.slice(5, 9).toUpperCase()})`, name: TAG_NAMES[key] ?? "—", value });
  }
  return tags;
}

/** Deflated Explicit VR LE (1.2.840.10008.1.2.1.99): meta başlığından sonrası ham DEFLATE akışıdır. */
function inflater(byteArray: Uint8Array, position: number): Uint8Array {
  const inflated = inflateSync(byteArray.subarray(position));
  const out = new Uint8Array(position + inflated.length);
  out.set(byteArray.subarray(0, position));
  out.set(inflated, position);
  return out;
}

function tryParse(buf: Uint8Array): DicomDataSet | null {
  try {
    return applyCharset(parseDicom(buf, { inflater }));
  } catch {
    /* başlıksız dosya olabilir */
  }
  if (buf.length < 512) return null;
  for (const ts of ["1.2.840.10008.1.2.1", "1.2.840.10008.1.2"]) {
    try {
      const ds = applyCharset(parseDicom(buf, { TransferSyntaxUID: ts }));
      if (ds.elements["x7fe00010"] && ds.uint16("x00280010") && ds.uint16("x00280011")) return ds;
    } catch {
      /* sıradaki */
    }
  }
  return null;
}

async function expandZips(files: File[], onWarning?: (m: string) => void): Promise<File[]> {
  const out: File[] = [];
  for (const f of files) {
    if (!f.name.toLowerCase().endsWith(".zip")) {
      out.push(f);
      continue;
    }
    try {
      const entries = unzipSync(new Uint8Array(await f.arrayBuffer()));
      for (const [path, data] of Object.entries(entries)) {
        if (path.endsWith("/") || data.length === 0) continue;
        out.push(new File([data.slice().buffer as ArrayBuffer], path.split("/").pop() ?? path));
      }
    } catch {
      onWarning?.(`"${f.name}" ZIP arşivi açılamadı (şifreli veya bozuk olabilir).`);
    }
  }
  return out;
}

async function readStandardImageFile(file: File): Promise<SeriesData | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const src = e.target?.result as string;
      if (!src) return resolve(null);
      const img = new Image();
      img.onload = () => {
        const W = img.naturalWidth || 512;
        const H = img.naturalHeight || 512;
        const canvas = document.createElement("canvas");
        canvas.width = W;
        canvas.height = H;
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0);
        const d = ctx.getImageData(0, 0, W, H).data;
        const px = new Int16Array(W * H);
        const rgba = new Uint32Array(W * H);
        for (let i = 0; i < px.length; i++) {
          const r = d[i * 4];
          const g = d[i * 4 + 1];
          const b = d[i * 4 + 2];
          px[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
          rgba[i] = 0xff000000 | (b << 16) | (g << 8) | r;
        }
        const name = file.name.replace(/\.[^/.]+$/, "");
        resolve({
          id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          modality: "OT", description: name || "Tıbbi Görüntü", bodyPart: "TETKİK",
          patientName: name.toUpperCase() || "HASTA", patientId: `TR-${Math.floor(Math.random() * 900000 + 100000)}`,
          patientAge: "-", patientSex: "-", studyDate: new Date().toISOString().slice(0, 10),
          institution: "RADYOLOJİ KLİNİĞİ", studyUid: `1.2.826.0.1.3680043.${Date.now()}`,
          width: W, height: H, pixelSpacing: 1, sliceThickness: 0, defaultWL: 128, defaultWW: 256,
          unit: "SI", isColor: true, rgbaSlices: [rgba], slices: [px], lesions: [], isSample: false, files: [file],
          tags: [
            { tag: "(0008,0060)", name: "Modality", value: "OT" },
            { tag: "(0028,0010)", name: "Rows", value: String(H) },
            { tag: "(0028,0011)", name: "Columns", value: String(W) },
          ],
        });
      };
      img.onerror = () => resolve(null);
      img.src = src;
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

function median(a: number[]): number {
  if (a.length === 0) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
}

/**
 * DICOM dosyalarını okur (Görüntü, SR, PDF, ECG, Video, Overlay, GSPS).
 * SeriesInstanceUID'ye göre serilere ayırır.
 */
/** Klasör/dosya içe aktarımının dosya bazında dökümü (neden açılmadığını kullanıcıya göstermek için). */
export interface ImportStats {
  total: number;
  skippedNonMedical: number;
  dicom: number;
  images: number;
  unreadable: number;
  noPixel: number;
  unsupported: Record<string, number>;
  failed: Record<string, number>;
  seriesOpened: number;
  ms: number;
}

export async function loadMedicalFiles(
  files: File[],
  onProgress?: (loaded: number, total: number) => void,
  onWarning?: (msg: string) => void,
  options: { signal?: AbortSignal; timeoutMs?: number; onStats?: (s: ImportStats) => void } = {}
): Promise<SeriesData[]> {
  const { signal, timeoutMs = 30000, onStats } = options;
  const startedAt = Date.now();
  const stats: ImportStats = { total: files.length, skippedNonMedical: 0, dicom: 0, images: 0, unreadable: 0, noPixel: 0, unsupported: {}, failed: {}, seriesOpened: 0, ms: 0 };
  assertNotAborted(signal);
  const expanded = await withImportTimeout(expandZips(files, onWarning), signal, Math.max(timeoutMs, 60000));
  const parsed: ParsedSlice[] = [];
  const meta = new Map<string, DicomDataSet>();
  const specialSeries: SeriesData[] = [];
  const imageFiles: File[] = [];
  const unsupported = new Map<string, number>();
  const failed = new Map<string, number>();
  let unreadable = 0;

  stats.total = expanded.length;
  let count = 0;
  let lastProgress = 0;
  let lastYield = performance.now();
  for (const file of expanded) {
    assertNotAborted(signal);
    count++;
    // Büyük klasörlerde her dosyada yeniden çizim yapmak arayüzü yavaşlatır: ~120 ms'de bir ilerleme,
    // ~30 ms'de bir tarayıcıya nefes (tıklama/çizim) payı bırak.
    const now = performance.now();
    if (now - lastProgress > 120 || count === 1) { lastProgress = now; onProgress?.(count - 1, expanded.length); }
    if (now - lastYield > 30) { lastYield = now; await new Promise<void>((resolve) => setTimeout(resolve, 0)); assertNotAborted(signal); }
    const lower = file.name.toLowerCase();
    const ext = lower.includes(".") ? (lower.split(".").pop() ?? "") : "";
    if (file.name.toUpperCase() === "DICOMDIR" || SKIP_EXT.has(ext) || file.name.startsWith(".") || file.size < 128) { stats.skippedNonMedical++; continue; }
    const isImage = IMAGE_EXT.has(ext);

    try {
      const buf = new Uint8Array(await withImportTimeout(file.arrayBuffer(), signal, timeoutMs));
      const ds = isImage ? null : tryParse(buf);
      if (!ds) {
        if (isImage) imageFiles.push(file);
        else unreadable++;
        continue;
      }
      stats.dicom++;

      const sopClass = ds.string("x00080016") || "";

      // ─── 1. Specialized Non-Image DICOM: Encapsulated PDF ───
      if (isSOPClass(sopClass, SOP_ENCAPSULATED_PDF)) {
        const pdf = parseEncapsulatedPDF(ds);
        if (pdf) {
          specialSeries.push({
            id: `dicom-pdf-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            modality: "DOC",
            description: pdf.title,
            bodyPart: ds.string("x00180015") || "RAPOR",
            patientName: ds.string("x00100010")?.replace(/\^/g, " ") || "ANONİM HASTA",
            patientId: ds.string("x00100020") || `TR-${Math.floor(Math.random() * 900000 + 100000)}`,
            patientAge: ds.string("x00101010") || "-",
            patientSex: ds.string("x00100040") || "-",
            studyDate: ds.string("x00080020") || new Date().toISOString().slice(0, 10),
            institution: ds.string("x00080080") || "RADYOLOJİ KLİNİĞİ",
            studyUid: ds.string("x0020000d") || `study-${Date.now()}`,
            width: 512, height: 512, pixelSpacing: 1, sliceThickness: 0,
            defaultWL: 128, defaultWW: 256, unit: "SI",
            specialType: "pdf", pdfData: pdf,
            slices: [new Int16Array(512 * 512)], lesions: [], tags: collectTags(ds), isSample: false, files: [file],
          });
          continue;
        }
      }

      // ─── 2. Specialized Non-Image DICOM: Structured Report (SR) ───
      if (isSOPClass(sopClass, SOP_PREFIX_SR)) {
        const sr = parseStructuredReport(ds);
        if (sr) {
          specialSeries.push({
            id: `dicom-sr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            modality: "SR",
            description: sr.title,
            bodyPart: ds.string("x00180015") || "TÜM VÜCUT",
            patientName: ds.string("x00100010")?.replace(/\^/g, " ") || "ANONİM HASTA",
            patientId: ds.string("x00100020") || `TR-${Math.floor(Math.random() * 900000 + 100000)}`,
            patientAge: ds.string("x00101010") || "-",
            patientSex: ds.string("x00100040") || "-",
            studyDate: ds.string("x00080020") || new Date().toISOString().slice(0, 10),
            institution: ds.string("x00080080") || "RADYOLOJİ KLİNİĞİ",
            studyUid: ds.string("x0020000d") || `study-${Date.now()}`,
            width: 512, height: 512, pixelSpacing: 1, sliceThickness: 0,
            defaultWL: 128, defaultWW: 256, unit: "SI",
            specialType: "sr", srData: sr,
            slices: [new Int16Array(512 * 512)], lesions: [], tags: collectTags(ds), isSample: false, files: [file],
          });
          continue;
        }
      }

      // ─── 3. Specialized Non-Image DICOM: 12-Lead ECG / Waveform ───
      if (isSOPClass(sopClass, SOP_PREFIX_ECG)) {
        const ecg = parseECGWaveform(ds);
        if (ecg) {
          specialSeries.push({
            id: `dicom-ecg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            modality: "ECG",
            description: ecg.title,
            bodyPart: "KALP",
            patientName: ds.string("x00100010")?.replace(/\^/g, " ") || "ANONİM HASTA",
            patientId: ds.string("x00100020") || `TR-${Math.floor(Math.random() * 900000 + 100000)}`,
            patientAge: ds.string("x00101010") || "-",
            patientSex: ds.string("x00100040") || "-",
            studyDate: ds.string("x00080020") || new Date().toISOString().slice(0, 10),
            institution: ds.string("x00080080") || "RADYOLOJİ KLİNİĞİ",
            studyUid: ds.string("x0020000d") || `study-${Date.now()}`,
            width: 512, height: 512, pixelSpacing: 1, sliceThickness: 0,
            defaultWL: 128, defaultWW: 256, unit: "SI",
            specialType: "ecg", ecgData: ecg,
            slices: [new Int16Array(512 * 512)], lesions: [], tags: collectTags(ds), isSample: false, files: [file],
          });
          continue;
        }
      }

      // ─── 4. DICOM Image Series ───
      const ts = ds.string("x00020010");
      if (ts && !UNCOMPRESSED.has(ts) && !isCodecSupported(ts)) {
        unsupported.set(ts, (unsupported.get(ts) ?? 0) + 1);
        continue;
      }

      const paletteLut = parsePaletteColorLUT(ds);
      const overlays = parseOverlayPlanes(ds);

      let dec: Awaited<ReturnType<typeof decodePixels>>;
      try {
        dec = await withImportTimeout(decodePixels(ds, ts, paletteLut), signal, timeoutMs);
      } catch (e) {
        assertNotAborted(signal);
        const msg = `${ts ? codecName(ts) : "DICOM"}: ${e instanceof Error ? e.message : String(e)}`;
        failed.set(msg, (failed.get(msg) ?? 0) + 1);
        continue;
      }
      if (!dec) {
        stats.noPixel++;
        continue;
      }

      const seriesUid = ds.string("x0020000e") || `series-${ds.string("x0008103e") || "default"}`;
      if (!meta.has(seriesUid)) meta.set(seriesUid, ds);
      const instNum = ds.intString("x00200013") ?? parsed.length;
      const sliceLoc = ds.floatString("x00201041") ?? instNum;
      const photometric = (ds.string("x00280004") || "MONOCHROME2").trim().toUpperCase();
      const key = dec.frames.length > 1 ? null : sliceKey(ds);

      dec.frames.forEach((pixels, f) =>
        parsed.push({
          seriesUid,
          instanceNumber: instNum + f,
          sliceLocation: sliceLoc + f,
          posKey: key,
          pixels,
          rgba: dec!.rgbaFrames ? dec!.rgbaFrames[f] : undefined,
          width: dec!.width,
          height: dec!.height,
          photometric,
          isColor: dec!.isColor,
          overlays: overlays.length > 0 ? overlays : undefined,
          ipp: dec.frames.length > 1 ? undefined : parseVec3(ds.string("x00200032")),
          sopUid: dec.frames.length > 1 ? undefined : ds.string("x00080018")?.trim(),
          seriesTimeS: parseTm(ds.string("x00080031") || ds.string("x00080032")),
          file,
        })
      );
    } catch (e) {
      assertNotAborted(signal);
      console.warn("Dosya okuma hatası:", file.name, e);
      unreadable++;
    }
  }

  for (const [uid, n] of unsupported) {
    onWarning?.(`${n} dosya "${codecName(uid)}" biçiminde — bu sürümde çözülemiyor. Atlandı.`);
  }
  for (const [msg, n] of failed) onWarning?.(`${n} dosya çözülemedi — ${msg}. Atlandı.`);
  if (unreadable > 0) onWarning?.(`${unreadable} dosya DICOM veya desteklenen bir görüntü olarak okunamadı — atlandı.`);

  const result: SeriesData[] = [...specialSeries];
  const groups = new Map<string, ParsedSlice[]>();
  for (const s of parsed) {
    const arr = groups.get(s.seriesUid) ?? [];
    arr.push(s);
    groups.set(s.seriesUid, arr);
  }

  for (const [uid, raw] of groups) {
    const first = meta.get(uid);
    if (!first || raw.length === 0) continue;
    const w0 = raw[0].width;
    const h0 = raw[0].height;
    const list = raw.filter((s) => s.width === w0 && s.height === h0);
    const modality = first.string("x00080060") ?? "OT";
    const seriesDesc = first.string("x0008103e") || first.string("x00081030") || `${modality} Serisi (${list.length} Kesit)`;
    if (list.length < raw.length) onWarning?.(`"${seriesDesc}" serisinde ${raw.length - list.length} kesit farklı boyutta olduğu için atlandı.`);

    const keyed = list.every((s) => s.posKey !== null);
    list.sort((a, b) => {
      if (keyed) return (a.posKey as number) - (b.posKey as number);
      if (a.instanceNumber !== b.instanceNumber) return a.instanceNumber - b.instanceNumber;
      return a.sliceLocation - b.sliceLocation;
    });

    let slices: Pixels[] = list.map((p) => p.pixels);
    const isColor = list.some((p) => p.isColor);
    const rgbaSlices = list.some((p) => p.rgba) ? list.map((p) => p.rgba!) : undefined;
    const allOverlays = list.flatMap((p) => p.overlays || []);

    const thickness = first.floatString("x00180050") ?? 0;
    const positions = keyed ? list.map((s) => s.posKey as number) : undefined;
    const diffs = positions ? positions.slice(1).map((p, i) => Math.abs(p - positions[i])).filter((d) => d > 0.01) : [];
    const spacing = diffs.length ? median(diffs) : thickness || 1;
    if (diffs.length > 2) {
      const bad = diffs.filter((d) => Math.abs(d - spacing) > spacing * 0.25).length;
      if (bad > 0) onWarning?.(`"${seriesDesc}" serisinde ${bad} kesit aralığı düzensiz (eksik/çift kesit olabilir).`);
    }

    const wl = first.floatString("x00281050");
    const ww = first.floatString("x00281051");
    const spacingStr = first.string("x00280030");
    const pixelSpacing = spacingStr ? parseFloat(spacingStr.split("\\")[0]) || 1 : 1;
    const pixelSpacingX = spacingStr && spacingStr.includes("\\") ? parseFloat(spacingStr.split("\\")[1]) || pixelSpacing : pixelSpacing;

    // MONOCHROME1 → MONOCHROME2
    let invK: number | null = null;
    if (!isColor && list[0].photometric === "MONOCHROME1") {
      let mn = Infinity;
      let mx = -Infinity;
      for (const s of slices) for (let i = 0; i < s.length; i++) { if (s[i] < mn) mn = s[i]; if (s[i] > mx) mx = s[i]; }
      const k = mx + mn;
      invK = k;
      slices = slices.map((s) => {
        const o = s instanceof Float32Array ? new Float32Array(s.length) : new Int16Array(s.length);
        for (let i = 0; i < s.length; i++) o[i] = k - s[i];
        return o;
      });
    }

    let defaultWL = wl !== undefined ? (invK !== null ? invK - wl : wl) : 0;
    let defaultWW = ww ?? 0;
    if (!ww) {
      if (isColor) {
        defaultWL = 128;
        defaultWW = 256;
      } else {
        const mid = slices[Math.floor(slices.length / 2)];
        let min = Infinity;
        let max = -Infinity;
        for (let i = 0; i < mid.length; i += 7) { if (mid[i] < min) min = mid[i]; if (mid[i] > max) max = mid[i]; }
        defaultWL = (min + max) / 2;
        defaultWW = Math.max(1, max - min);
      }
    }

    const iop = first.string("x00200037")?.split("\\").map(Number);
    result.push({
      id: `dicom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      seriesUid: uid,
      modality,
      description: seriesDesc,
      bodyPart: first.string("x00180015") ?? "TÜM VÜCUT",
      patientName: first.string("x00100010")?.replace(/\^/g, " ") || "ANONİM HASTA",
      patientId: first.string("x00100020") || `TR-${Math.floor(Math.random() * 900000 + 100000)}`,
      patientAge: first.string("x00101010") || "-",
      patientSex: first.string("x00100040") || "-",
      studyDate: first.string("x00080020") || new Date().toISOString().slice(0, 10),
      institution: first.string("x00080080") || "RADYOLOJİ KLİNİĞİ",
      studyUid: first.string("x0020000d") || `study-${Date.now()}`,
      width: w0,
      height: h0,
      pixelSpacing,
      sliceThickness: thickness,
      sliceSpacing: spacing,
      slicePositions: positions,
      ipp: list.every((s) => s.ipp) ? list.map((s) => s.ipp!) : undefined,
      sopUids: list.every((s) => s.sopUid) ? list.map((s) => s.sopUid!) : undefined,
      sopClassUid: first.string("x00080016")?.trim(),
      pixelSpacingX,
      suv: modality === "PT" ? suvFromDataset(first, list.map((s) => s.seriesTimeS ?? null).sort((a, b) => (a ?? 1e12) - (b ?? 1e12))) : undefined,
      orientation: iop && iop.length >= 6 && !iop.some(Number.isNaN) ? iop.slice(0, 6) : undefined,
      frameOfRef: first.string("x00200052"),
      defaultWL,
      defaultWW,
      unit: isColor ? "RGB" : modality === "CT" ? "HU" : modality === "PT" ? (first.string("x00541001")?.trim() || "SI") : "SI",
      photometric: list[0].photometric,
      isColor,
      rgbaSlices,
      overlays: allOverlays.length > 0 ? allOverlays : undefined,
      slices,
      lesions: [],
      tags: collectTags(first),
      isSample: false,
      files: Array.from(new Set(list.map((s) => s.file))),
    });
  }

  for (const f of imageFiles) {
    assertNotAborted(signal);
    try {
      const s = await withImportTimeout(readStandardImageFile(f), signal, timeoutMs);
      if (s) result.push(s);
      else onWarning?.(`${f.name}: görüntü çözülemedi.`);
    } catch (e) {
      assertNotAborted(signal);
      onWarning?.(`${f.name}: ${e instanceof Error ? e.message : "görüntü açılamadı"}`);
    }
  }
  assertNotAborted(signal);
  onProgress?.(expanded.length, expanded.length);
  stats.unreadable = unreadable;
  stats.images = imageFiles.length;
  for (const [k, v] of unsupported) stats.unsupported[codecName(k)] = (stats.unsupported[codecName(k)] ?? 0) + v;
  for (const [k, v] of failed) stats.failed[k] = v;
  stats.seriesOpened = result.length;
  stats.ms = Date.now() - startedAt;
  onStats?.(stats);
  return result;
}
