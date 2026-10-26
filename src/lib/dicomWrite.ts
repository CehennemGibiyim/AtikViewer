import { zipSync } from "fflate";
import type { SeriesData } from "./types";

/**
 * Anonimleştirilmiş DICOM üretimi (Explicit VR Little Endian).
 * Bellekteki görüntüden SIFIRDAN yazılır: orijinal etiketler, özel (private) etiketler ve UID'ler taşınmaz.
 * Korunanlar: modalite, piksel verisi, piksel aralığı, kesit kalınlığı/konumu, pencere değerleri, cinsiyet yok.
 */
export const enc = new TextEncoder();
const LONG_VR = new Set(["OB", "OW", "OF", "SQ", "UT", "UN"]);

export function pad(b: Uint8Array, padByte: number): Uint8Array {
  if (b.length % 2 === 0) return b;
  const o = new Uint8Array(b.length + 1);
  o.set(b);
  o[b.length] = padByte;
  return o;
}
export function el(group: number, elem: number, vr: string, value: Uint8Array): Uint8Array {
  const long = LONG_VR.has(vr);
  const out = new Uint8Array((long ? 12 : 8) + value.length);
  const dv = new DataView(out.buffer);
  dv.setUint16(0, group, true);
  dv.setUint16(2, elem, true);
  out[4] = vr.charCodeAt(0);
  out[5] = vr.charCodeAt(1);
  if (long) dv.setUint32(8, value.length, true);
  else dv.setUint16(6, value.length, true);
  out.set(value, long ? 12 : 8);
  return out;
}
export const str = (g: number, e: number, vr: string, s: string) => el(g, e, vr, pad(enc.encode(s), 0x20));
export const uidEl = (g: number, e: number, s: string) => el(g, e, "UI", pad(enc.encode(s), 0));
export function us(g: number, e: number, n: number) {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n, true);
  return el(g, e, "US", b);
}
export function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
const ds = (n: number) => String(+n.toFixed(4)).slice(0, 16);

export function newUid(): string {
  const r = new Uint8Array(30);
  crypto.getRandomValues(r);
  let s = "";
  for (let i = 0; i < r.length; i++) s += i === 0 ? 1 + (r[i] % 9) : r[i] % 10;
  return `2.25.${s}`;
}

const SOP_CLASS: Record<string, string> = {
  CT: "1.2.840.10008.5.1.4.1.1.2",
  MR: "1.2.840.10008.5.1.4.1.1.4",
  CR: "1.2.840.10008.5.1.4.1.1.1",
  DX: "1.2.840.10008.5.1.4.1.1.1.1",
};

export function buildAnonymizedDicom(series: SeriesData, anonId = `ANON-${Math.floor(Math.random() * 900000 + 100000)}`): { name: string; bytes: Uint8Array }[] {
  const N = series.slices.length;
  let min = Infinity, max = -Infinity, integral = true;
  for (const s of series.slices) {
    for (let i = 0; i < s.length; i++) {
      const v = s[i];
      if (v < min) min = v;
      if (v > max) max = v;
      if (integral && v !== Math.round(v)) integral = false;
    }
  }
  const signed = integral && min >= -32768 && max <= 32767;
  const unsignedNative = !signed && integral && min >= 0 && max <= 65535;
  const quant = !signed && !unsignedNative;
  // Eğim/kesişim DS alanına 4 ondalıkla yazılır; nicemlemeyi bu temsil edilebilir değerlerle yapıyoruz (tutarsızlık yok).
  const intercept = quant ? Math.floor(min * 1e4) / 1e4 : 0;
  const slope = quant ? Math.max(1e-4, Math.ceil(((max - intercept) / 65535) * 1e4) / 1e4) : 1;

  const studyUid = newUid();
  const seriesUid = newUid();
  const implUid = newUid();
  const sopClass = SOP_CLASS[series.modality] ?? "1.2.840.10008.5.1.4.1.1.7";
  const rows = series.height;
  const cols = series.width;
  const spacing = series.sliceSpacing || series.sliceThickness || 1;
  const files: { name: string; bytes: Uint8Array }[] = [];

  for (let i = 0; i < N; i++) {
    const src = series.slices[i];
    const buf = new ArrayBuffer(rows * cols * 2);
    if (signed) {
      const o = new Int16Array(buf);
      for (let k = 0; k < src.length; k++) o[k] = src[k];
    } else {
      const o = new Uint16Array(buf);
      for (let k = 0; k < src.length; k++) o[k] = quant ? Math.round((src[k] - intercept) / slope) : src[k];
    }
    const sopUid = newUid();
    const body = concat([
      uidEl(0x0008, 0x0016, sopClass),
      uidEl(0x0008, 0x0018, sopUid),
      str(0x0008, 0x0020, "DA", ""),
      str(0x0008, 0x0060, "CS", series.modality.slice(0, 16)),
      str(0x0008, 0x103e, "LO", "ANONIMLESTIRILMIS SERI"),
      str(0x0010, 0x0010, "PN", "ANONYMOUS"),
      str(0x0010, 0x0020, "LO", anonId),
      ...(series.sliceThickness ? [str(0x0018, 0x0050, "DS", ds(series.sliceThickness))] : []),
      uidEl(0x0020, 0x000d, studyUid),
      uidEl(0x0020, 0x000e, seriesUid),
      str(0x0020, 0x0011, "IS", "1"),
      str(0x0020, 0x0013, "IS", String(i + 1)),
      str(0x0020, 0x1041, "DS", ds(series.slicePositions ? series.slicePositions[i] : i * spacing)),
      us(0x0028, 0x0002, 1),
      str(0x0028, 0x0004, "CS", "MONOCHROME2"),
      us(0x0028, 0x0010, rows),
      us(0x0028, 0x0011, cols),
      str(0x0028, 0x0030, "DS", `${ds(series.pixelSpacing)}\\${ds(series.pixelSpacing)}`),
      us(0x0028, 0x0100, 16),
      us(0x0028, 0x0101, 16),
      us(0x0028, 0x0102, 15),
      us(0x0028, 0x0103, signed ? 1 : 0),
      str(0x0028, 0x1050, "DS", ds(series.defaultWL)),
      str(0x0028, 0x1051, "DS", ds(series.defaultWW)),
      str(0x0028, 0x1052, "DS", ds(intercept)),
      str(0x0028, 0x1053, "DS", ds(slope)),
      el(0x7fe0, 0x0010, "OW", new Uint8Array(buf)),
    ]);
    const meta = concat([
      el(0x0002, 0x0001, "OB", new Uint8Array([0, 1])),
      uidEl(0x0002, 0x0002, sopClass),
      uidEl(0x0002, 0x0003, sopUid),
      uidEl(0x0002, 0x0010, "1.2.840.10008.1.2.1"),
      uidEl(0x0002, 0x0012, implUid),
      str(0x0002, 0x0013, "SH", "ATIKVIEWER"),
    ]);
    const glen = new Uint8Array(4);
    new DataView(glen.buffer).setUint32(0, meta.length, true);
    const bytes = concat([new Uint8Array(128), enc.encode("DICM"), el(0x0002, 0x0000, "UL", glen), meta, body]);
    files.push({ name: `ANON_${String(i + 1).padStart(4, "0")}.dcm`, bytes });
  }
  return files;
}

export function zipAnonymized(series: SeriesData): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const f of buildAnonymizedDicom(series)) entries[f.name] = f.bytes;
  return zipSync(entries, { level: 0 });
}
