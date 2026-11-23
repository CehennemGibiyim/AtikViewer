import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { storedFiles, studies } from "@/db/schema";
import { authorize } from "@/lib/server/auth";
import { audit } from "@/lib/server/audit";
import { DATA_DIR, encryptBuffer } from "@/lib/server/crypto";

export const dynamic = "force-dynamic";
const MAX = 300 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const a = await authorize();
  if ("error" in a) return a.error;
  const sp = req.nextUrl.searchParams;
  const studyId = Number(sp.get("studyId"));
  const name = (sp.get("name") ?? "file").slice(0, 200);
  const buf = Buffer.from(await req.arrayBuffer());
  if (!studyId || buf.length === 0 || buf.length > MAX) return NextResponse.json({ error: "Geçersiz dosya" }, { status: 400 });
  const st = await db.select({ id: studies.id }).from(studies).where(eq(studies.id, studyId)).limit(1);
  if (!st[0]) return NextResponse.json({ error: "Çalışma bulunamadı" }, { status: 404 });

  const sha = createHash("sha256").update(buf).digest("hex");
  const dup = await db.select({ id: storedFiles.id }).from(storedFiles).where(and(eq(storedFiles.studyId, studyId), eq(storedFiles.sha256, sha))).limit(1);
  if (!dup[0]) {
    const rel = path.join("dicom", String(studyId), `${randomUUID()}.bin`);
    fs.mkdirSync(path.dirname(path.join(DATA_DIR, rel)), { recursive: true });
    fs.writeFileSync(path.join(DATA_DIR, rel), encryptBuffer(buf), { mode: 0o600 });
    await db.insert(storedFiles).values({ studyId, name, size: buf.length, path: rel, sha256: sha });
    await db.update(studies).set({ hasFiles: true, updatedAt: new Date() }).where(eq(studies.id, studyId));
  }
  if (sp.get("last") === "1") await audit(a.user, "storage.upload", "study", studyId, { files: Number(sp.get("n") ?? 1) });
  return NextResponse.json({ ok: true, duplicate: !!dup[0] });
}
