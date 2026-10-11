"use client";

/**
 * GitHub Pages (statik demo): sunucu ve veritabanı yoktur. Bu modül /api/* isteklerini
 * ağa göndermeden TARAYICI İÇİNDE karşılar:
 *   - /api/analyze            → src/lib/analyze.ts (sunucudakiyle aynı saf fonksiyon)
 *   - /api/reports*           → rapor kaydı/onayı/addendum, tarayıcının localStorage'ında
 *   - /api/state              → ölçümler ve anahtar kesitler, localStorage
 *   - /api/reports/draft-impression → kural tabanlı izlenim taslağı
 * Diğer uçlar (çalışma listesi, PACS, yönetim, depolama) 503 döner.
 * Veriler yalnızca bu tarayıcıda kalır, hiçbir yere gönderilmez.
 * Yalnızca scripts/prepare-pages.sh tarafından Pages derlemesine eklenir.
 */
import type { AnalyzeBody } from "@/lib/analyze";
import type { Finding, FindingApprovalStatus, SavedReport } from "@/lib/types";

const OPERATOR = { fullName: "Demo Radyolog", title: "Uzm. Dr.", regNo: "" };
const K_REPORTS = "atik-demo-reports";
const K_ADDENDA = "atik-demo-addenda";
const K_STATE = "atik-demo-state:";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
const fail = (error: string, status = 400) => json({ error }, status);

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

interface SaveBody {
  reportId?: number;
  action?: "save" | "approve";
  study: { studyUid: string; patientName: string; patientId: string; patientAge: string; patientSex: string; studyDate: string; institution: string; modality: string; bodyPart: string; seriesDescription: string; sliceCount: number };
  report: {
    mode: string; clinicalInfo: string; technique: string; findingsText: string; impression: string; recommendation: string;
    findingsJson: Finding[]; findingsApproval: Record<string, FindingApprovalStatus>;
    triageLevel: string; triageScore: number; aiModel: string; engine: string; modelCard: string; keyImageDataUrl: string; institution?: string;
  };
}

async function handleReportSave(body: SaveBody): Promise<Response> {
  if (!body?.study?.studyUid || !body.report) return fail("Eksik veri");
  const r = body.report;
  const findings = Array.isArray(r.findingsJson) ? r.findingsJson : [];
  const approvals = r.findingsApproval ?? {};
  const approve = body.action === "approve";
  const all = load<SavedReport[]>(K_REPORTS, []);
  const current = body.reportId ? all.find((x) => x.id === body.reportId) : undefined;
  if (body.reportId && !current) return fail("Rapor bulunamadı", 404);
  if (current?.status === "onaylandi") return fail("Onaylı rapor değiştirilemez. Düzeltme için addendum ekleyin.", 409);

  let approvedAt: string | null = null;
  if (approve) {
    const pending = findings.filter((f) => (approvals[f.id] ?? "bekliyor") === "bekliyor").length;
    if (pending > 0) return fail(`${pending} bulgu henüz gözden geçirilmedi`);
    approvedAt = new Date().toISOString();
  }
  const version = (current?.version ?? 0) + 1;
  let contentHash = "";
  let signatureMeta = "";
  if (approve && approvedAt) {
    contentHash = await sha256(JSON.stringify({ studyUid: body.study.studyUid, technique: r.technique, findingsText: r.findingsText, impression: r.impression, recommendation: r.recommendation, approvals, version, approvedAt }));
    signatureMeta = JSON.stringify({ algo: "SHA-256", method: "Statik demo — tarayıcıda yerel onay", signer: OPERATOR, signedAt: approvedAt, note: "Bu onay kimlik doğrulamaz ve nitelikli elektronik imza değildir." });
  }
  const now = new Date().toISOString();
  const id = current?.id ?? (all.reduce((m, x) => Math.max(m, x.id), 0) + 1);
  const row: SavedReport = {
    id, studyId: id, status: approve ? "onaylandi" : "taslak", version, mode: r.mode,
    clinicalInfo: r.clinicalInfo ?? "", technique: r.technique, findingsText: r.findingsText, impression: r.impression, recommendation: r.recommendation,
    findingsJson: findings, findingsApproval: approvals, triageLevel: r.triageLevel, triageScore: r.triageScore, aiModel: r.aiModel, engine: r.engine, modelCard: r.modelCard,
    approvedBy: approve ? OPERATOR.fullName : "", doctorTitle: approve ? OPERATOR.title : "", doctorRegNo: approve ? OPERATOR.regNo : "",
    institution: r.institution ?? body.study.institution ?? "", approvedAt, contentHash, signatureMeta,
    keyImageDataUrl: r.keyImageDataUrl ?? "", createdAt: current?.createdAt ?? now, updatedAt: now,
    patientName: body.study.patientName, patientId: body.study.patientId, patientAge: body.study.patientAge, patientSex: body.study.patientSex,
    studyDate: body.study.studyDate, studyUid: body.study.studyUid, modality: body.study.modality, bodyPart: body.study.bodyPart, seriesDescription: body.study.seriesDescription,
  } as SavedReport;
  const next = current ? all.map((x) => (x.id === id ? row : x)) : [row, ...all];
  // Kota dolarsa anahtar kesit görüntüleri atılıp yeniden denenir.
  if (!save(K_REPORTS, next)) {
    const slim = next.map((x) => ({ ...x, keyImageDataUrl: x.id === id ? x.keyImageDataUrl : "" }));
    if (!save(K_REPORTS, slim)) {
      const slimmer = slim.map((x) => ({ ...x, keyImageDataUrl: "" }));
      if (!save(K_REPORTS, slimmer)) return fail("Tarayıcı depolama alanı dolu; eski raporları silin.", 507);
    }
  }
  return json({ ok: true, reportId: id, studyId: id, status: row.status, version, contentHash, approvedAt, approvedBy: row.approvedBy, doctorTitle: row.doctorTitle, doctorRegNo: row.doctorRegNo });
}

async function route(method: string, url: URL, init?: RequestInit): Promise<Response | null> {
  const p = url.pathname.replace(/\/+$/, "");
  const body = async <T,>(): Promise<T | null> => {
    try { return JSON.parse(String(init?.body ?? "")) as T; } catch { return null; }
  };

  if (p === "/api/analyze" && method === "POST") {
    const b = await body<AnalyzeBody>();
    if (!b) return fail("Geçersiz istek");
    const { buildAnalysis } = await import("@/lib/analyze");
    const out = buildAnalysis(b);
    return out.ok ? json(out.result) : fail(out.error);
  }

  if (p === "/api/reports" && method === "GET") {
    let rows = load<SavedReport[]>(K_REPORTS, []).map((x) => ({ ...x, keyImageDataUrl: "" }));
    const pid = url.searchParams.get("patientId");
    const uid = url.searchParams.get("studyUid");
    if (pid) rows = rows.filter((x) => x.patientId === pid);
    if (uid) rows = rows.filter((x) => x.studyUid === uid);
    return json(rows.slice(0, 100));
  }
  if (p === "/api/reports" && method === "POST") {
    const b = await body<SaveBody>();
    return b ? handleReportSave(b) : fail("Geçersiz istek");
  }
  if (p === "/api/reports/draft-impression" && method === "POST") {
    const b = await body<{ findings?: { label: string; slice: number; category: string; status: string }[] }>();
    const verified = (b?.findings ?? []).filter((f) => (f.status === "onaylandi" || f.status === "duzenlendi") && f.category !== "Sistem" && f.category !== "ROI");
    if (verified.length === 0) return fail("Önce en az bir bulguyu 'Onayla/Düzenlendi' olarak işaretleyin");
    return json({ text: `${verified.map((f, i) => `${i + 1}) ${f.label} (Kesit ${f.slice})`).join("; ")}. Klinik korelasyon önerilir.`, source: "kural" });
  }
  const fh = /^\/api\/reports\/(\d+)\/fhir$/.exec(p);
  if (fh && method === "GET") {
    const rep = load<SavedReport[]>(K_REPORTS, []).find((x) => x.id === Number(fh[1]));
    if (!rep) return fail("Rapor bulunamadı", 404);
    const { buildFhirReport } = await import("@/lib/fhir");
    return new Response(JSON.stringify(buildFhirReport(rep), null, 2), { headers: { "Content-Type": "application/fhir+json; charset=utf-8" } });
  }
  const m = /^\/api\/reports\/(\d+)(\/addenda)?$/.exec(p);
  if (m) {
    const id = Number(m[1]);
    const all = load<SavedReport[]>(K_REPORTS, []);
    const rep = all.find((x) => x.id === id);
    const addenda = load<Record<string, { id: number; text: string; createdByName: string; createdAt: string }[]>>(K_ADDENDA, {});
    if (!m[2] && method === "GET") {
      if (!rep) return fail("Rapor bulunamadı", 404);
      const versions = Array.from({ length: rep.version }, (_, i) => ({ id: i + 1, versionNo: rep.version - i, action: i === 0 && rep.status === "onaylandi" ? "onay" : "kayıt", createdByName: OPERATOR.fullName, createdAt: rep.updatedAt }));
      return json({ report: rep, versions, addenda: (addenda[id] ?? []).slice().reverse() });
    }
    if (m[2] && method === "POST") {
      const b = await body<{ text?: string }>();
      const text = (b?.text ?? "").trim();
      if (text.length < 3 || text.length > 4000) return fail("Addendum metni 3–4000 karakter olmalı");
      if (!rep) return fail("Rapor bulunamadı", 404);
      if (rep.status !== "onaylandi") return fail("Addendum yalnızca onaylı rapora eklenir; taslağı doğrudan düzenleyin");
      const list = addenda[id] ?? [];
      list.push({ id: list.length + 1, text, createdByName: `${OPERATOR.title} ${OPERATOR.fullName}`, createdAt: new Date().toISOString() });
      addenda[id] = list;
      save(K_ADDENDA, addenda);
      return json({ ok: true, id: list.length });
    }
  }

  if (p === "/api/state") {
    const key = K_STATE + (url.searchParams.get("studyUid") ?? "") + "|" + (url.searchParams.get("seriesKey") ?? "");
    if (method === "GET") return json(load(key, { annotations: [], keyImages: [] }));
    if (method === "PUT") {
      const b = await body<{ studyUid?: string; seriesKey?: string; annotations?: unknown[]; keyImages?: unknown[] }>();
      if (!b?.studyUid || !b.seriesKey) return fail("Eksik veri");
      save(K_STATE + b.studyUid + "|" + b.seriesKey, { annotations: b.annotations ?? [], keyImages: b.keyImages ?? [] });
      return json({ ok: true });
    }
  }

  if ((p === "/api/studies" || p === "/api/notifications" || p === "/api/templates") && method === "GET") return json([]);
  return null;
}

if (typeof window !== "undefined" && !(window as unknown as { __apiShim?: boolean }).__apiShim) {
  (window as unknown as { __apiShim?: boolean }).__apiShim = true;
  const orig = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (/^\/api\//.test(raw)) {
      const method = (init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET")).toUpperCase();
      try {
        const res = await route(method, new URL(raw, window.location.origin), init);
        if (res) return res;
      } catch (e) {
        return fail(e instanceof Error ? e.message : "Yerel işlem hatası", 500);
      }
      return fail("Statik demo: bu özellik sunucu gerektirir", 503);
    }
    return orig(input, init);
  };
}

export default function StaticApiShim() {
  return null;
}
