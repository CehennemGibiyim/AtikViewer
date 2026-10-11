import { NextRequest, NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { storedFiles, studies } from "@/db/schema";
import { authorize } from "@/lib/server/auth";
import { audit } from "@/lib/server/audit";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const a = await authorize();
  if ("error" in a) return a.error;
  const id = Number((await params).id);
  const st = await db.select({ id: studies.id, uid: studies.studyUid }).from(studies).where(eq(studies.id, id)).limit(1);
  if (!st[0]) return NextResponse.json({ error: "Çalışma bulunamadı" }, { status: 404 });
  const files = await db.select({ id: storedFiles.id, name: storedFiles.name, size: storedFiles.size }).from(storedFiles).where(eq(storedFiles.studyId, id)).orderBy(asc(storedFiles.id));
  await audit(a.user, "study.open", "study", id, { files: files.length });
  return NextResponse.json({ studyUid: st[0].uid, files });
}
