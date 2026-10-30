import { NextRequest, NextResponse } from "next/server";
import { audit } from "@/lib/server/audit";
import { authorize } from "@/lib/server/auth";
import { encryptText, keySource } from "@/lib/server/crypto";
import { publicPacsConfig } from "@/lib/server/pacs";
import { loadPacsConfig } from "@/lib/server/pacsConfig";
import { getSetting, isHttpUrl, setSetting } from "@/lib/server/settings";
import { DEFAULT_PACS, type PacsAuthType, type PacsConfig } from "@/lib/pacsPresets";

export const dynamic = "force-dynamic";

export async function GET() {
  const a = await authorize(["yonetici"]);
  if ("error" in a) return a.error;
  const cfg = await loadPacsConfig();
  return NextResponse.json({
    retentionDraftDays: Number(await getSetting("retentionDraftDays", "0")),
    criticalWebhookUrl: await getSetting("criticalWebhookUrl"),
    pacsBaseUrl: await getSetting("pacsBaseUrl"),
    pacs: cfg ? publicPacsConfig(cfg) : DEFAULT_PACS,
    compliance: await getSetting("compliance", "{}"),
    env: { llm: !!process.env.LLM_API_URL && !!process.env.LLM_API_KEY, his: !!process.env.HIS_API_KEY, pacsAuth: !!process.env.PACS_AUTH_HEADER, keySource: keySource() },
  });
}

const AUTH_TYPES: PacsAuthType[] = ["none", "basic", "bearer", "header"];
const str = (v: unknown, max = 512) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** PACS yapılandırmasını doğrular, sır alanlarını AES-256-GCM ile şifreleyip saklar. */
async function savePacs(b: Record<string, unknown>): Promise<string | null> {
  const raw = typeof b.pacs === "object" && b.pacs ? (b.pacs as Record<string, unknown>) : null;
  if (!raw) return null;
  const cur = (await loadPacsConfig()) ?? DEFAULT_PACS;
  const inAuth = (typeof raw.auth === "object" && raw.auth ? raw.auth : {}) as Record<string, unknown>;

  const qidoRoot = str(raw.qidoRoot, 512);
  const wadoRoot = str(raw.wadoRoot, 512);
  if (qidoRoot && !isHttpUrl(qidoRoot)) return "PACS: QIDO kökü http(s) adresi olmalı";
  if (wadoRoot && !isHttpUrl(wadoRoot)) return "PACS: WADO kökü http(s) adresi olmalı";
  const type = str(inAuth.type, 16) || "none";
  if (!AUTH_TYPES.includes(type as PacsAuthType)) return "PACS: geçersiz kimlik tipi";
  const kinds = ["orthanc", "dcm4chee", "google", "azure", "custom"];
  const kind = str(raw.kind, 16) || "custom";

  // Boş gönderilen sır alanı mevcut değeri korur; yalnızca açıkça temizlenmek istenirse
  // clearSecrets gönderilir (yönetim panelinde "Temizle").
  const keep = raw.clearSecrets !== true;
  const secret = (incoming: unknown, existing: string) => {
    const v = str(incoming, 1024);
    if (v) return encryptText(v);
    return keep ? existing : "";
  };

  const limitRaw = Number(raw.limit ?? cur.limit);
  const cfg: PacsConfig = {
    ...cur,
    name: str(raw.name, 80) || "PACS",
    kind: (kinds.includes(kind) ? kind : "custom") as PacsConfig["kind"],
    qidoRoot,
    wadoRoot,
    allowSelfSigned: raw.allowSelfSigned === true,
    limit: Number.isFinite(limitRaw) ? Math.max(1, Math.min(1000, Math.floor(limitRaw))) : 50,
    includefield: raw.includefield !== false,
    notes: str(raw.notes, 2000),
    auth: {
      type: type as PacsAuthType,
      username: str(inAuth.username, 128),
      password: secret(inAuth.password, cur.auth.password),
      token: secret(inAuth.token, cur.auth.token),
      headerName: str(inAuth.headerName, 64),
      headerValue: secret(inAuth.headerValue, cur.auth.headerValue),
    },
  };
  await setSetting("pacs", JSON.stringify(cfg));
  return null;
}

export async function PUT(req: NextRequest) {
  const a = await authorize(["yonetici"]);
  if ("error" in a) return a.error;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const changed: string[] = [];
  for (const k of ["criticalWebhookUrl", "pacsBaseUrl"] as const) {
    if (typeof b[k] === "string") {
      const v = (b[k] as string).trim();
      if (v && !isHttpUrl(v)) return NextResponse.json({ error: `${k}: geçerli bir http(s) adresi olmalı` }, { status: 400 });
      await setSetting(k, v);
      changed.push(k);
    }
  }
  if (typeof b.retentionDraftDays === "number") {
    const d = Math.max(0, Math.min(3650, Math.floor(b.retentionDraftDays)));
    await setSetting("retentionDraftDays", String(d));
    changed.push("retentionDraftDays");
  }
  if (typeof b.compliance === "string") {
    try { JSON.parse(b.compliance); } catch { return NextResponse.json({ error: "Geçersiz JSON" }, { status: 400 }); }
    await setSetting("compliance", b.compliance);
    changed.push("compliance");
  }
  if (b.pacs !== undefined) {
    const err = await savePacs(b);
    if (err) return NextResponse.json({ error: err }, { status: 400 });
    changed.push("pacs");
  }
  await audit(a.user, "settings.update", "settings", "", { fields: changed });
  return NextResponse.json({ ok: true });
}
