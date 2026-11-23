import { NextRequest, NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs } from "@/db/schema";
import { authorize } from "@/lib/server/auth";
import { audit, verifyChain } from "@/lib/server/audit";

export const dynamic = "force-dynamic";

/** İstemci tarafı dışa aktarma olaylarını denetim izine yazar (yalnızca izinli eylemler). */
export async function POST(req: NextRequest) {
  const a = await authorize();
  if ("error" in a) return a.error;
  const b = (await req.json().catch(() => ({}))) as { action?: string; studyUid?: string };
  if (!b.action || !["export.png", "export.dicom_anon"].includes(b.action)) return NextResponse.json({ error: "Geçersiz eylem" }, { status: 400 });
  await audit(a.user, b.action, "study", (b.studyUid ?? "").slice(0, 80));
  return NextResponse.json({ ok: true });
}

export async function GET(req: NextRequest) {
  const a = await authorize(["yonetici"]);
  if ("error" in a) return a.error;
  const sp = req.nextUrl.searchParams;
  if (sp.get("verify") === "1") return NextResponse.json(await verifyChain());
  const limit = Math.min(1000, Math.max(1, Number(sp.get("limit") ?? 200)));
  const q = (sp.get("q") ?? "").toLowerCase();
  const rows = await db.select().from(auditLogs).orderBy(desc(auditLogs.id)).limit(limit);
  const out = q ? rows.filter((r) => `${r.action} ${r.username} ${r.entityType} ${r.entityId} ${r.details}`.toLowerCase().includes(q)) : rows;
  return NextResponse.json(out.map((r) => ({ id: r.id, ts: r.ts, username: r.username, action: r.action, entityType: r.entityType, entityId: r.entityId, details: r.details, hash: r.hash.slice(0, 12) })));
}
