import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { storedFiles, studies } from "@/db/schema";
import { authorize } from "@/lib/server/auth";
import { audit } from "@/lib/server/audit";
import { DATA_DIR } from "@/lib/server/crypto";

export const dynamic = "force-dynamic";
const STATUSES = ["bekliyor", "okunuyor", "taslak", "onayli"];
type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const a = await authorize();
  if ("error" in a) return a.error;
  const id = Number((await params).id);
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const set: Partial<typeof studies.$inferInsert> = { updatedAt: new Date() };
  const changed: string[] = [];
  const canAssign = a.user.role !== "teknisyen";

  if (typeof b.workStatus === "string") {
    if (!STATUSES.includes(b.workStatus)) return NextResponse.json({ error: "Geçersiz durum" }, { status: 400 });
    if (b.workStatus === "onayli" && !canAssign) return NextResponse.json({ error: "Yetkiniz yok" }, { status: 403 });
    set.workStatus = b.workStatus; changed.push("workStatus");
  }
  if ("assignTo" in b) {
    if (!canAssign) return NextResponse.json({ error: "Atama için yetkiniz yok" }, { status: 403 });
    set.assignedTo = b.assignTo === "me" ? a.user.id : typeof b.assignTo === "number" ? b.assignTo : null;
    changed.push("assignedTo");
  }
  if (changed.length === 0) return NextResponse.json({ error: "Değişiklik yok" }, { status: 400 });
  await db.update(studies).set(set).where(eq(studies.id, id));
  await audit(a.user, "study.update", "study", id, { fields: changed, ...(set.assignedTo !== undefined ? { assignedTo: set.assignedTo } : {}), ...(set.workStatus ? { workStatus: set.workStatus } : {}) });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const a = await authorize(["yonetici"]);
  if ("error" in a) return a.error;
  const id = Number((await params).id);
  const files = await db.select({ p: storedFiles.path }).from(storedFiles).where(eq(storedFiles.studyId, id));
  for (const f of files) fs.rmSync(path.join(DATA_DIR, f.p), { force: true });
  await db.delete(studies).where(eq(studies.id, id));
  await audit(a.user, "study.delete", "study", id, { files: files.length });
  return NextResponse.json({ ok: true });
}
