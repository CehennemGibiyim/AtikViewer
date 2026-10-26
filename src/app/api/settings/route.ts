import { NextRequest, NextResponse } from "next/server";
import { audit } from "@/lib/server/audit";
import { authorize } from "@/lib/server/auth";
import { keySource } from "@/lib/server/crypto";
import { getSetting, isHttpUrl, setSetting } from "@/lib/server/settings";

export const dynamic = "force-dynamic";

export async function GET() {
  const a = await authorize(["yonetici"]);
  if ("error" in a) return a.error;
  return NextResponse.json({
    retentionDraftDays: Number(await getSetting("retentionDraftDays", "0")),
    criticalWebhookUrl: await getSetting("criticalWebhookUrl"),
    pacsBaseUrl: await getSetting("pacsBaseUrl"),
    compliance: await getSetting("compliance", "{}"),
    env: { llm: !!process.env.LLM_API_URL && !!process.env.LLM_API_KEY, his: !!process.env.HIS_API_KEY, pacsAuth: !!process.env.PACS_AUTH_HEADER, keySource: keySource() },
  });
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
  await audit(a.user, "settings.update", "settings", "", { fields: changed });
  return NextResponse.json({ ok: true });
}
