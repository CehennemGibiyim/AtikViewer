import { getSetting } from "./settings";

/** DICOMweb (QIDO-RS / WADO-RS) istemcisi. Taban URL yönetim ekranından, kimlik başlığı PACS_AUTH_HEADER ortam değişkeninden gelir. */
export interface PacsStudy {
  studyUid: string;
  patientName: string;
  patientId: string;
  studyDate: string;
  modalities: string;
  description: string;
  instances: number;
}
export interface PacsInstance {
  seriesUid: string;
  sopUid: string;
}

type DJson = Record<string, { Value?: unknown[] } | undefined>;

export const isUid = (s: string) => /^[0-9]+(\.[0-9]+)*$/.test(s) && s.length <= 64;

function val(o: DJson, tag: string): string {
  const v = o[tag]?.Value?.[0];
  if (v && typeof v === "object" && "Alphabetic" in v) return String((v as { Alphabetic: string }).Alphabetic);
  return v === undefined || v === null ? "" : String(v);
}

export async function pacsBase(): Promise<string | null> {
  const base = (await getSetting("pacsBaseUrl")).replace(/\/+$/, "");
  return base || null;
}

function headers(accept: string): HeadersInit {
  const h: Record<string, string> = { Accept: accept };
  if (process.env.PACS_AUTH_HEADER) h.Authorization = process.env.PACS_AUTH_HEADER;
  return h;
}

export async function qidoStudies(base: string, q: string): Promise<PacsStudy[]> {
  const params = new URLSearchParams({ limit: "50" });
  if (q) params.set(/^[0-9A-Za-z_-]{4,}$/.test(q) && /\d/.test(q) ? "PatientID" : "PatientName", `*${q}*`);
  for (const f of ["00080061", "00081030", "00201208"]) params.append("includefield", f);
  const res = await fetch(`${base}/studies?${params}`, { headers: headers("application/dicom+json"), signal: AbortSignal.timeout(15000) });
  if (res.status === 204) return [];
  if (!res.ok) throw new Error(`PACS yanıtı: ${res.status}`);
  const arr = (await res.json()) as DJson[];
  return arr.map((o) => ({
    studyUid: val(o, "0020000D"),
    patientName: val(o, "00100010").replace(/\^/g, " "),
    patientId: val(o, "00100020"),
    studyDate: val(o, "00080020"),
    modalities: (o["00080061"]?.Value ?? []).join("/"),
    description: val(o, "00081030"),
    instances: Number(val(o, "00201208")) || 0,
  }));
}

export async function qidoInstances(base: string, studyUid: string): Promise<PacsInstance[]> {
  const res = await fetch(`${base}/studies/${studyUid}/instances?limit=5000&includefield=0020000E&includefield=00080018`, {
    headers: headers("application/dicom+json"),
    signal: AbortSignal.timeout(20000),
  });
  if (res.status === 204) return [];
  if (!res.ok) throw new Error(`PACS yanıtı: ${res.status}`);
  const arr = (await res.json()) as DJson[];
  return arr.map((o) => ({ seriesUid: val(o, "0020000E"), sopUid: val(o, "00080018") })).filter((i) => i.seriesUid && i.sopUid);
}

/** multipart/related gövdesinden ilk parçayı (DICOM nesnesi) çıkarır. */
export function parseMultipartRelated(buf: Uint8Array, contentType: string): Uint8Array | null {
  const m = /boundary="?([^";]+)"?/i.exec(contentType);
  if (!m) return null;
  const b = Buffer.from(buf);
  const boundary = Buffer.from(`--${m[1]}`);
  const start = b.indexOf(boundary);
  if (start < 0) return null;
  const headerEnd = b.indexOf("\r\n\r\n", start);
  if (headerEnd < 0) return null;
  const bodyStart = headerEnd + 4;
  const end = b.indexOf(Buffer.concat([Buffer.from("\r\n"), boundary]), bodyStart);
  return new Uint8Array(b.subarray(bodyStart, end < 0 ? b.length : end));
}

export async function wadoInstance(base: string, studyUid: string, seriesUid: string, sopUid: string): Promise<Uint8Array> {
  const res = await fetch(`${base}/studies/${studyUid}/series/${seriesUid}/instances/${sopUid}`, {
    headers: headers('multipart/related; type="application/dicom"; transfer-syntax=*'),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`PACS yanıtı: ${res.status}`);
  const ct = res.headers.get("content-type") ?? "";
  const body = new Uint8Array(await res.arrayBuffer());
  if (/multipart\/related/i.test(ct)) {
    const part = parseMultipartRelated(body, ct);
    if (!part) throw new Error("PACS multipart yanıtı ayrıştırılamadı");
    return part;
  }
  return body;
}
