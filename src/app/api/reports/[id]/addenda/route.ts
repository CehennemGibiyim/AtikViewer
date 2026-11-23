import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { reportAddenda, reports } from "@/db/schema";
import { audit } from "@/lib/server/audit";
import { authorize } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const a = await authorize(["radyolog", "yonetici"]);
  if ("error" in a) return a.error;
  const id = Number((await params).id);
  const b = (await req.json().catch(() => ({}))) as { text?: string };
  const text = (b.text ?? "").trim();
  if (text.length < 3 || text.length > 4000) return NextResponse.json({ error: "Addendum metni 3–4000 karakter olmalı" }, { status: 400 });
  const r = (await db.select({ status: reports.status }).from(reports).where(eq(reports.id, id)).limit(1))[0];
  if (!r) return NextResponse.json({ error: "Rapor bulunamadı" }, { status: 404 });
  if (r.status !== "onaylandi") return NextResponse.json({ error: "Addendum yalnızca onaylı rapora eklenir; taslağı doğrudan düzenleyin" }, { status: 400 });
  const ins = await db.insert(reportAddenda).values({ reportId: id, text, createdBy: a.user.id, createdByName: `${a.user.title ? a.user.title + " " : ""}${a.user.fullName}` }).returning({ id: reportAddenda.id });
  await db.update(reports).set({ updatedAt: new Date() }).where(eq(reports.id, id));
  await audit(a.user, "report.addendum", "report", id, { addendumId: ins[0].id, chars: text.length });
  return NextResponse.json({ ok: true, id: ins[0].id });
}
