import http from "node:http";
import https from "node:https";
import { decryptText, isEncrypted } from "./crypto";
import { DEFAULT_PACS, isHttpUrl, trimRoot, type PacsConfig } from "@/lib/pacsPresets";

/**
 * DICOMweb (QIDO-RS / WADO-RS) istemcisi — sunucu tarafı.
 *
 * Neden node:http/https ve global fetch değil:
 *  - kurum içi PACS'ler sıkça self-signed sertifika kullanır; bunun için istek başına
 *    `rejectUnauthorized` ayarı gerekir (fetch/undici bu seçeneği doğrudan sunmaz).
 *  - gecikme/ağ hatalarını kullanıcıya Türkçe ve ayırt edilebilir mesaja çevirmek istiyoruz.
 *
 * Kimlik ve adres bilgileri yönetim ekranından gelir (app_settings), ortam değişkeni
 * yalnızca geriye dönük uyumluluk için (`PACS_AUTH_HEADER`) gözetilir.
 */

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

// ───────────── Yapılandırma ─────────────

const unseal = (s: string) => (s && isEncrypted(s) ? decryptText(s) : s);

/** Kayıtlı yapılandırmadaki şifreli alanları çözer (pacsConfig yükleyicisi çağırır). */
export function unsealPacsConfig(c: PacsConfig): PacsConfig {
  const out = { ...c, auth: { ...c.auth } };
  out.auth.password = unseal(out.auth.password);
  out.auth.token = unseal(out.auth.token);
  out.auth.headerValue = unseal(out.auth.headerValue);
  out.qidoRoot = trimRoot(out.qidoRoot || "");
  out.wadoRoot = trimRoot(out.wadoRoot || "");
  return out;
}

/**
 * Yapılandırmanın geçerli sürümü: QIDO kökü zorunlu.
 * (Yükleme/DB erişimi ayrı dosyada: pacsConfig.ts — istemci testleri DB gerektirmez.)
 */
export function coercePacsConfig(raw: unknown): PacsConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const c = { ...DEFAULT_PACS, ...(raw as Partial<PacsConfig>) };
  c.auth = { ...DEFAULT_PACS.auth, ...((raw as PacsConfig).auth ?? {}) };
  const out = unsealPacsConfig(c as PacsConfig);
  if (!out.qidoRoot || !isHttpUrl(out.qidoRoot)) return null;
  if (out.wadoRoot && !isHttpUrl(out.wadoRoot)) out.wadoRoot = "";
  return out;
}

/** Yöneticiye gösterilecek sürüm: sır değerleri boşaltılır, varlıkları bayrakla bildirilir. */
export function publicPacsConfig(c: PacsConfig): PacsConfig & { hasPassword: boolean; hasToken: boolean; hasHeader: boolean } {
  return {
    ...c,
    auth: { ...c.auth, password: "", token: "", headerValue: "" },
    hasPassword: !!c.auth.password,
    hasToken: !!c.auth.token,
    hasHeader: !!c.auth.headerValue,
  };
}

function buildHeaders(cfg: PacsConfig, accept: string): Record<string, string> {
  const h: Record<string, string> = { Accept: accept, "Cache-Control": "no-cache" };
  const a = cfg.auth;
  if (a.type === "basic" && (a.username || a.password)) {
    h.Authorization = `Basic ${Buffer.from(`${a.username}:${a.password}`, "utf8").toString("base64")}`;
  } else if (a.type === "bearer" && a.token) {
    h.Authorization = `Bearer ${a.token}`;
  } else if (a.type === "header" && a.headerName && a.headerValue) {
    h[a.headerName] = a.headerValue;
  } else if (a.type === "none" && process.env.PACS_AUTH_HEADER) {
    // Geriye dönük uyumluluk: ortam değişkeni hâlâ desteklenir.
    h.Authorization = process.env.PACS_AUTH_HEADER;
  }
  return h;
}

// ───────────── HTTP katmanı ─────────────

interface RawResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

/** Ağ/sertifika hatalarını Türkçe ve ayırt edilebilir mesaja çevirir. */
function netError(e: unknown): Error {
  const err = e as NodeJS.ErrnoException & { code?: string };
  const code = err.code ?? "";
  if (code === "ECONNREFUSED") return new Error("PACS'e ulaşılamadı — bağlantı reddedildi (adres veya port yanlış olabilir).");
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return new Error("PACS adresi çözümlenemedi — alan adını kontrol edin.");
  if (code === "ETIMEDOUT" || err.message === "timeout") return new Error("PACS zaman aşımına uğradı — sunucu yanıt vermiyor.");
  if (["SELF_SIGNED_CERT_IN_CHAIN", "DEPTH_ZERO_SELF_SIGNED_CERT", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "ERR_TLS_CERT_ALTNAME_INVALID", "CERT_HAS_EXPIRED"].includes(code)) {
    return new Error(`Sertifika hatası (${code}) — kurum içi sunucu self-signed sertifika kullanıyorsa ayarlardan "self-signed sertifikaya izin ver" seçeneğini açın.`);
  }
  return new Error(`PACS bağlantı hatası: ${err.message}${code ? ` (${code})` : ""}`);
}

function requestBuffer(urlStr: string, cfg: PacsConfig, accept: string, timeoutMs: number, method = "GET"): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    let u: URL;
    try {
      u = new URL(urlStr);
    } catch {
      reject(new Error(`Geçersiz adres: ${urlStr}`));
      return;
    }
    const mod = u.protocol === "https:" ? https : http;
    const req = mod.request(
      u,
      {
        method,
        headers: buildHeaders(cfg, accept),
        // Kurum içi PACS'lerde yaygın self-signed sertifika (yalnızca sunucu tarafında).
        rejectUnauthorized: !cfg.allowSelfSigned,
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
        res.on("error", (e) => reject(netError(e)));
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", (e) => reject(netError(e)));
    req.end();
  });
}

/** HTTP durumunu ayırt edilebilir Türkçe mesaja çevirir. */
export function friendlyStatus(status: number): string {
  if (status === 400) return "PACS geçersiz istek döndürdü (400) — sorgu parametrelerini kontrol edin.";
  if (status === 401) return "Kimlik doğrulama gerekli veya hatalı (401) — kullanıcı adı/parola ya da token'ı kontrol edin.";
  if (status === 403) return "Erişim reddedildi (403) — hesabın bu kayda yetkisi yok.";
  if (status === 404) return "Adres veya yol bulunamadı (404) — taban URL'yi kontrol edin (ör. /dicom-web, /dcm4chee-arc/aets/AET/rs).";
  if (status === 405) return "İstek yöntemi desteklenmiyor (405).";
  if (status === 406) return "Sunucu istenen içerik türünü kabul etmedi (406) — includefield/Accept ayarını deneyin.";
  if (status === 413) return "Sorgu çok geniş (413) — arama terimini daraltın.";
  if (status === 429) return "PACS istek sınırına ulaştı (429) — biraz bekleyip tekrar deneyin.";
  if (status >= 500) return `PACS sunucu hatası (${status}).`;
  return `PACS yanıtı: ${status}`;
}

async function getJson(url: string, cfg: PacsConfig, timeoutMs: number): Promise<DJson[]> {
  const res = await requestBuffer(url, cfg, "application/dicom+json", timeoutMs);
  if (res.status === 204) return [];
  if (!res.status || res.status >= 400) throw new Error(friendlyStatus(res.status));
  const text = res.body.toString("utf8").trim();
  if (!text) return [];
  if (!text.startsWith("[") && !text.startsWith("{")) {
    throw new Error("PACS beklenmeyen yanıt verdi (JSON değil) — adresin DICOMweb uç noktası olduğundan emin olun.");
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    return Array.isArray(parsed) ? (parsed as DJson[]) : [];
  } catch {
    throw new Error("PACS yanıtı ayrıştırılamadı (geçersiz JSON).");
  }
}

// ───────────── QIDO-RS ─────────────

export async function qidoStudies(cfg: PacsConfig, q: string): Promise<PacsStudy[]> {
  const params = new URLSearchParams({ limit: String(Math.max(1, Math.min(1000, cfg.limit || 50))) });
  if (q) params.set(/^[0-9A-Za-z_-]{4,}$/.test(q) && /\d/.test(q) ? "PatientID" : "PatientName", `*${q}*`);
  if (cfg.includefield) for (const f of ["00080061", "00081030", "00201208"]) params.append("includefield", f);
  const arr = await getJson(`${cfg.qidoRoot}/studies?${params}`, cfg, 20000);
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

export async function qidoInstances(cfg: PacsConfig, studyUid: string): Promise<PacsInstance[]> {
  const params = new URLSearchParams({ limit: "5000" });
  if (cfg.includefield) {
    params.append("includefield", "0020000E");
    params.append("includefield", "00080018");
  }
  const arr = await getJson(`${cfg.qidoRoot}/studies/${studyUid}/instances?${params}`, cfg, 30000);
  return arr.map((o) => ({ seriesUid: val(o, "0020000E"), sopUid: val(o, "00080018") })).filter((i) => i.seriesUid && i.sopUid);
}

// ───────────── WADO-RS ─────────────

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

export async function wadoInstance(cfg: PacsConfig, studyUid: string, seriesUid: string, sopUid: string): Promise<Uint8Array> {
  const root = cfg.wadoRoot || cfg.qidoRoot;
  const res = await requestBuffer(
    `${root}/studies/${studyUid}/series/${seriesUid}/instances/${sopUid}`,
    cfg,
    'multipart/related; type="application/dicom"; transfer-syntax=*',
    60000,
  );
  if (res.status >= 400 || !res.status) throw new Error(friendlyStatus(res.status));
  const ct = res.headers["content-type"] ?? "";
  if (/multipart\/related/i.test(ct)) {
    const part = parseMultipartRelated(new Uint8Array(res.body), ct);
    if (!part) throw new Error("PACS multipart yanıtı ayrıştırılamadı.");
    return part;
  }
  if (/json/i.test(ct)) throw new Error("PACS DICOM yerine JSON döndürdü — WADO kök adresini kontrol edin.");
  return new Uint8Array(res.body);
}

// ───────────── Bağlantı testi ─────────────

export interface PacsTestStep {
  name: string;
  ok: boolean;
  http: number | null;
  ms: number;
  message: string;
}

export interface PacsTestResult {
  ok: boolean;
  steps: PacsTestStep[];
}

/**
 * Yöneticinin "Bağlantıyı test et" düğmesi için: yetenek sorgusu + sınırlı bir arama.
 * 401/403/404/406 ayrıştırılır ki adres mi yetki mi hatası olduğu anlaşılsın.
 */
export async function testConnection(cfg: PacsConfig): Promise<PacsTestResult> {
  const steps: PacsTestStep[] = [];
  const base = cfg.qidoRoot;
  if (!base) {
    return { ok: false, steps: [{ name: "Adres", ok: false, http: null, ms: 0, message: "DICOMweb adresi boş — önce kaydedin." }] };
  }

  // 1) Yetenek sorgusu (OPTIONS) — PS3.18 §10.4; birçok sunucu 405 döndürür, bu normaldir.
  {
    const t = Date.now();
    try {
      const r = await requestBuffer(base, cfg, "*/*", 10000, "OPTIONS");
      const ms = Date.now() - t;
      steps.push({
        name: "Uç noktası erişimi (OPTIONS)",
        ok: r.status > 0 && r.status < 500,
        http: r.status,
        ms,
        message: r.status >= 200 && r.status < 300 ? `Sunucu yeteneklerini bildirdi (${r.status}).` : `${r.status} — çoğu sunucu OPTIONS desteklemez; sorun değil.`,
      });
    } catch (e) {
      steps.push({ name: "Uç noktası erişimi (OPTIONS)", ok: false, http: null, ms: Date.now() - t, message: e instanceof Error ? e.message : String(e) });
      return { ok: false, steps };
    }
  }

  // 2) Sınırlı arama — kimlik/yol hatalarını burada yakalar.
  {
    const t = Date.now();
    try {
      const params = new URLSearchParams({ limit: "1" });
      if (cfg.includefield) params.append("includefield", "all");
      const r = await requestBuffer(`${base}/studies?${params}`, cfg, "application/dicom+json", 15000);
      const ms = Date.now() - t;
      const empty = r.status === 204;
      const ok = r.status === 200 || empty;
      steps.push({
        name: "Hasta araması (QIDO-RS /studies?limit=1)",
        ok,
        http: r.status,
        ms,
        message: ok
          ? empty
            ? "204 — bağlantı başarılı, arşivde kayıt yok (boş sonuç normaldir)."
            : `${r.status} — arşivden yanıt alındı.`
          : friendlyStatus(r.status),
      });
      if (ok) {
        let n = -1;
        try {
          const parsed = JSON.parse(r.body.toString("utf8")) as unknown[];
          if (Array.isArray(parsed)) n = parsed.length;
        } catch {
          n = -1;
        }
        steps.push({
          name: "Yanıt biçimi",
          ok: n >= 0,
          http: r.status,
          ms: 0,
          message: n > 0 ? "application/dicom+json listesi alındı — hasta araması kullanılabilir." : "Yanıt JSON listesi değil — adres DICOMweb uç noktası olmayabilir.",
        });
      }
    } catch (e) {
      steps.push({ name: "Hasta araması (QIDO-RS)", ok: false, http: null, ms: Date.now() - t, message: e instanceof Error ? e.message : String(e) });
    }
  }

  // 3) WADO kökü farklıysa onu da dener (dcm4chee /wado ayrımı vb.).
  if (cfg.wadoRoot && cfg.wadoRoot !== base) {
    const t = Date.now();
    try {
      const r = await requestBuffer(`${cfg.wadoRoot}/`, cfg, "*/*", 10000);
      steps.push({
        name: "Görüntü kökü (WADO-RS)",
        ok: r.status > 0 && r.status < 500,
        http: r.status,
        ms: Date.now() - t,
        message: r.status < 400 ? `${r.status} — görüntü kökü yanıt veriyor.` : friendlyStatus(r.status),
      });
    } catch (e) {
      steps.push({ name: "Görüntü kökü (WADO-RS)", ok: false, http: null, ms: Date.now() - t, message: e instanceof Error ? e.message : String(e) });
    }
  }

  const hardFail = steps.some((s) => !s.ok && s.name.startsWith("Hasta araması"));
  return { ok: !hardFail && steps.length > 0, steps };
}
