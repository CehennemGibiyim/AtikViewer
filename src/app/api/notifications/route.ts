import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { notifications } from "@/db/schema";
import { audit } from "@/lib/server/audit";
import { authorize } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const a = await authorize();
  if ("error" in a) return a.error;
  const rows = await db.select().from(notifications).orderBy(desc(notifications.id)).limit(50);
  return NextResponse.json(rows.map((r) => ({ id: r.id, createdAt: r.createdAt, severity: r.severity, studyUid: r.studyUid, message: r.message, ackByName: r.ackByName, ackAt: r.ackAt })));
}

/** Bildirimi "alındı" olarak işaretle (kim, ne zaman denetim izine yazılır). */
export async function PATCH(req: NextRequest) {
  const a = await authorize(["radyolog", "yonetici"]);
  if ("error" in a) return a.error;
  const b = (await req.json().catch(() => ({}))) as { id?: number };
  if (!b.id) return NextResponse.json({ error: "id gerekli" }, { status: 400 });
  const cur = (await db.select().from(notifications).where(eq(notifications.id, b.id)).limit(1))[0];
  if (!cur) return NextResponse.json({ error: "Bulunamadı" }, { status: 404 });
  if (!cur.ackAt) {
    await db.update(notifications).set({ ackBy: a.user.id, ackByName: a.user.fullName, ackAt: new Date() }).where(eq(notifications.id, b.id));
    await audit(a.user, "notify.ack", "notification", b.id, { severity: cur.severity });
  }
  return NextResponse.json({ ok: true });
}
