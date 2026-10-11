import {
  readEncapsulatedImageFrame,
  readEncapsulatedPixelDataFromFragments,
  type DicomDataSet,
  type DicomElement,
} from "dicom-parser";
import * as jpegJs from "jpeg-js";
import { Decoder as LosslessDecoder } from "jpeg-lossless-decoder-js";
import JpegImage from "./vendor/jpeg12";

/** Çözülmüş kare: örnekler (RGB ise) iç içe (interleaved) dizilir. */
export type RawFrame = Uint8Array | Int16Array | Uint16Array;

export interface FrameInfo {
  rows: number;
  cols: number;
  bitsAllocated: number;
  bitsStored: number;
  pixelRep: number;
  samples: number;
  frames: number;
}

const TS_RLE = "1.2.840.10008.1.2.5";
const JPEG_BASELINE = new Set(["1.2.840.10008.1.2.4.50", "1.2.840.10008.1.2.4.51"]);
const JPEG_LOSSLESS = new Set(["1.2.840.10008.1.2.4.57", "1.2.840.10008.1.2.4.70"]);
const J2K = new Set(["1.2.840.10008.1.2.4.90", "1.2.840.10008.1.2.4.91", "1.2.840.10008.1.2.4.201", "1.2.840.10008.1.2.4.202", "1.2.840.10008.1.2.4.203"]);
const JLS = new Set(["1.2.840.10008.1.2.4.80", "1.2.840.10008.1.2.4.81"]);

export function isCodecSupported(ts: string): boolean {
  return ts === TS_RLE || JPEG_BASELINE.has(ts) || JPEG_LOSSLESS.has(ts) || J2K.has(ts) || JLS.has(ts);
}

export function codecName(ts: string): string {
  if (ts === TS_RLE) return "RLE Lossless";
  if (ts === "1.2.840.10008.1.2.4.50") return "JPEG Baseline";
  if (ts === "1.2.840.10008.1.2.4.51") return "JPEG Extended";
  if (JPEG_LOSSLESS.has(ts)) return "JPEG Lossless";
  if (ts.startsWith("1.2.840.10008.1.2.4.20")) return "HTJ2K (High-Throughput JPEG 2000)";
  if (J2K.has(ts)) return "JPEG 2000";
  if (JLS.has(ts)) return "JPEG-LS";
  if (ts === "1.2.840.10008.1.2.1.99") return "Deflated Explicit VR";
  if (ts.startsWith("1.2.840.10008.1.2.4.10")) return "MPEG video";
  return `Transfer Syntax ${ts}`;
}

// ───────────── WASM yükleyici (tarayıcıda public/codecs, testte Node) ─────────────
type WasmName = "openjpeg" | "charls";
export type WasmLoader = (name: WasmName) => Promise<unknown>;

interface J2KDecoderT {
  getEncodedBuffer(n: number): Uint8Array;
  decode(): void;
  getFrameInfo(): { width: number; height: number; bitsPerSample: number; componentCount: number; isSigned: boolean };
  getDecodedBuffer(): Uint8Array;
  delete(): void;
}
interface OpenJpegModule {
  J2KDecoder: new () => J2KDecoderT;
}
interface JlsDecoderT {
  getEncodedBuffer(n: number): Uint8Array;
  decode(): void;
  getFrameInfo(): { width: number; height: number; bitsPerSample: number; componentCount: number };
  getInterleaveMode(): number;
  getDecodedBuffer(): Uint8Array;
  delete(): void;
}
interface CharlsModule {
  JpegLSDecoder: new () => JlsDecoderT;
}

const WASM_ASSETS: Record<WasmName, { js: string; wasm: string; global: string }> = {
  openjpeg: { js: "/codecs/openjpegwasm_decode.js", wasm: "/codecs/openjpegwasm_decode.wasm", global: "OpenJPEGWASM" },
  charls: { js: "/codecs/charlswasm_decode.js", wasm: "/codecs/charlswasm_decode.wasm", global: "CharLSWASM" },
};

function injectScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`${src} yüklenemedi`));
    document.head.appendChild(s);
  });
}

const browserWasmLoader: WasmLoader = async (name) => {
  const a = WASM_ASSETS[name];
  const w = window as unknown as Record<string, unknown>;
  if (typeof w[a.global] !== "function") await injectScript(a.js);
  const factory = w[a.global] as (o: { locateFile: (f: string) => string }) => Promise<unknown>;
  return factory({ locateFile: (f) => (f.endsWith(".wasm") ? a.wasm : f) });
};

let wasmLoader: WasmLoader = browserWasmLoader;
const wasmCache = new Map<WasmName, Promise<unknown>>();

/** Test/Node ortamı için yükleyiciyi değiştirir. */
export function setWasmLoader(l: WasmLoader) {
  wasmLoader = l;
  wasmCache.clear();
}

function getWasm(name: WasmName): Promise<unknown> {
  let p = wasmCache.get(name);
  if (!p) {
    p = wasmLoader(name);
    wasmCache.set(name, p);
  }
  return p;
}

// ───────────── Yardımcılar ─────────────
function bytesToRaw(buf: Uint8Array, bitsPerSample: number, pixelRep: number): RawFrame {
  if (bitsPerSample <= 8) return buf;
  const ab = buf.byteOffset === 0 && buf.byteLength === buf.buffer.byteLength ? buf.buffer : buf.slice().buffer;
  const n = Math.floor(buf.byteLength / 2);
  return pixelRep === 1 ? new Int16Array(ab as ArrayBuffer, 0, n) : new Uint16Array(ab as ArrayBuffer, 0, n);
}

/** mode 0 = düzlemsel (RRR GGG BBB), 1 = satır, 2 = örnek (zaten iç içe). */
function toInterleaved(raw: RawFrame, mode: number, rows: number, cols: number): RawFrame {
  if (mode === 2) return raw;
  const out = new (raw.constructor as new (n: number) => RawFrame)(raw.length);
  const px = rows * cols;
  if (mode === 0) {
    for (let i = 0; i < px; i++) {
      out[i * 3] = raw[i];
      out[i * 3 + 1] = raw[px + i];
      out[i * 3 + 2] = raw[2 * px + i];
    }
  } else {
    for (let y = 0; y < rows; y++) {
      const row = y * cols * 3;
      for (let x = 0; x < cols; x++) {
        out[row + x * 3] = raw[row + x];
        out[row + x * 3 + 1] = raw[row + cols + x];
        out[row + x * 3 + 2] = raw[row + 2 * cols + x];
      }
    }
  }
  return out;
}

// ───────────── RLE ─────────────
export function decodeRLE(enc: Uint8Array, info: FrameInfo): RawFrame {
  const bytesPer = info.bitsAllocated >> 3;
  if (bytesPer < 1 || bytesPer > 2) throw new Error(`RLE: ${info.bitsAllocated} bit desteklenmiyor`);
  const dv = new DataView(enc.buffer, enc.byteOffset, enc.byteLength);
  const nSeg = dv.getUint32(0, true);
  const px = info.rows * info.cols;
  const expected = info.samples * bytesPer;
  if (nSeg !== expected) throw new Error(`RLE: ${nSeg} segment bulundu, ${expected} bekleniyordu`);
  const out = new Uint8Array(px * info.samples * bytesPer);

  for (let seg = 0; seg < nSeg; seg++) {
    let i = dv.getUint32(4 + seg * 4, true);
    const end = seg + 1 < nSeg ? dv.getUint32(4 + (seg + 1) * 4, true) : enc.length;
    const sample = Math.floor(seg / bytesPer);
    const byteIdx = seg % bytesPer; // 0 = en anlamlı bayt
    const shift = bytesPer - 1 - byteIdx;
    let p = 0;
    while (p < px && i < end) {
      const n = (enc[i++] << 24) >> 24;
      if (n >= 0) {
        for (let k = 0; k <= n && p < px && i < enc.length; k++) {
          out[(p * info.samples + sample) * bytesPer + shift] = enc[i++];
          p++;
        }
      } else if (n >= -127) {
        const v = enc[i++];
        for (let k = 0; k < 1 - n && p < px; k++) {
          out[(p * info.samples + sample) * bytesPer + shift] = v;
          p++;
        }
      }
    }
  }
  if (bytesPer === 1) return out;
  return info.pixelRep === 1 ? new Int16Array(out.buffer) : new Uint16Array(out.buffer);
}

// ───────────── JPEG (8-bit), JPEG Lossless ─────────────
function decodeJpegBaseline(bytes: Uint8Array, info: FrameInfo): RawFrame {
  if (info.samples === 1 && (info.bitsStored > 8 || info.bitsAllocated > 8)) {
    // 12-bit JPEG Extended (1.2.840.10008.1.2.4.51): BT/CR CD'lerinde yaygın kayıplı biçim.
    const jpeg = new JpegImage();
    jpeg.parse(bytes);
    jpeg.colorTransform = false;
    const data = jpeg.getData16(info.cols, info.rows);
    if (data.length < info.rows * info.cols) throw new Error("12-bit JPEG: eksik piksel verisi");
    if (info.pixelRep !== 1) return data;
    const signed = new Int16Array(data.length);
    const shift = 32 - Math.min(16, Math.max(1, info.bitsStored));
    for (let i = 0; i < data.length; i++) signed[i] = (data[i] << shift) >> shift;
    return signed;
  }
  if (info.bitsStored > 8) {
    throw new Error(`${info.bitsStored} bit renkli JPEG Extended desteklenmiyor`);
  }
  const img = jpegJs.decode(bytes, { useTArray: true });
  const n = img.width * img.height;
  if (info.samples === 1) {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = img.data[i * 4];
    return out;
  }
  const out = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) {
    out[i * 3] = img.data[i * 4];
    out[i * 3 + 1] = img.data[i * 4 + 1];
    out[i * 3 + 2] = img.data[i * 4 + 2];
  }
  return out;
}

function decodeJpegLossless(bytes: Uint8Array, info: FrameInfo): RawFrame {
  const dec = new LosslessDecoder();
  const out = dec.decode(bytes.buffer, bytes.byteOffset, bytes.byteLength, info.bitsAllocated >> 3);
  const n = info.rows * info.cols * info.samples;
  if (info.bitsAllocated <= 8) return new Uint8Array(out, 0, n);
  return info.pixelRep === 1 ? new Int16Array(out, 0, n) : new Uint16Array(out, 0, n);
}

// ───────────── JPEG 2000 / JPEG-LS (WASM) ─────────────
async function decodeJ2K(bytes: Uint8Array, info: FrameInfo): Promise<RawFrame> {
  const mod = (await getWasm("openjpeg")) as OpenJpegModule;
  const dec = new mod.J2KDecoder();
  try {
    dec.getEncodedBuffer(bytes.length).set(bytes);
    dec.decode();
    const fi = dec.getFrameInfo();
    const raw = bytesToRaw(dec.getDecodedBuffer().slice(), fi.bitsPerSample, info.pixelRep);
    return raw;
  } finally {
    dec.delete();
  }
}

async function decodeJLS(bytes: Uint8Array, info: FrameInfo): Promise<RawFrame> {
  const mod = (await getWasm("charls")) as CharlsModule;
  const dec = new mod.JpegLSDecoder();
  try {
    dec.getEncodedBuffer(bytes.length).set(bytes);
    dec.decode();
    const fi = dec.getFrameInfo();
    let raw = bytesToRaw(dec.getDecodedBuffer().slice(), fi.bitsPerSample, info.pixelRep);
    if (fi.componentCount === 3) raw = toInterleaved(raw, dec.getInterleaveMode(), info.rows, info.cols);
    return raw;
  } finally {
    dec.delete();
  }
}

// ───────────── Kapsüllenmiş veriden kare çıkarma + çözme ─────────────
function frameBytes(ds: DicomDataSet, el: DicomElement, i: number, frames: number): Uint8Array {
  const frags = el.fragments ?? [];
  if (frames === 1) return readEncapsulatedPixelDataFromFragments(ds, el, 0, frags.length);
  if (el.basicOffsetTable && el.basicOffsetTable.length === frames) {
    return readEncapsulatedImageFrame(ds, el, i, el.basicOffsetTable);
  }
  if (frags.length === frames) return readEncapsulatedPixelDataFromFragments(ds, el, i, 1);
  throw new Error("Çok kareli sıkıştırılmış veri: kare sınırları belirlenemedi");
}

export async function decodeEncapsulatedFrames(
  ds: DicomDataSet,
  el: DicomElement,
  ts: string,
  info: FrameInfo
): Promise<RawFrame[]> {
  if (!isCodecSupported(ts)) throw new Error(`${codecName(ts)} desteklenmiyor`);
  const out: RawFrame[] = [];
  const need = info.rows * info.cols * info.samples;
  for (let f = 0; f < info.frames; f++) {
    const bytes = frameBytes(ds, el, f, info.frames);
    let raw: RawFrame;
    if (ts === TS_RLE) raw = decodeRLE(bytes, info);
    else if (JPEG_BASELINE.has(ts)) raw = decodeJpegBaseline(bytes, info);
    else if (JPEG_LOSSLESS.has(ts)) raw = decodeJpegLossless(bytes, info);
    else if (J2K.has(ts)) raw = await decodeJ2K(bytes, info);
    else raw = await decodeJLS(bytes, info);
    if (raw.length < need) throw new Error(`${codecName(ts)}: beklenenden az piksel (${raw.length}/${need})`);
    out.push(raw);
  }
  return out;
}
