import { NextRequest, NextResponse } from "next/server";
import { and, count, eq, lt } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, reports, storedFiles, studies, users } from "@/db/schema";
import { audit } from "@/lib/server/audit";
import { authorize } from "@/lib/server/auth";
import { encryptText, isEncrypted, keySource } from "@/lib/server/crypto";
import { getSetting } from "@/lib/server/settings";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ action: string }> };

async function plaintextCounts() {
  const st = await db.select({ n: studies.patientName, p: studies.patientId }).from(studies);
  const rp = await db.select({ k: reports.keyImageDataUrl, c: reports.clinicalInfo }).from(reports);
  return {
    studies: st.filter((s) => !isEncrypted(s.n) || !isEncrypted(s.p)).length,
    reports: rp.filter((r) => (r.k && !isEncrypted(r.k)) || (r.c && !isEncrypted(r.c))).length,
  };
}

export async function GET(_req: NextRequest, { params }: Ctx) {
  const a = await authorize(["yonetici"]);
  if ("error" in a) return a.error;
  if ((await params).action !== "status") return NextResponse.json({ error: "Bulunamadı" }, { status: 404 });
  const c = async (t: typeof users | typeof studies | typeof reports | typeof storedFiles | typeof auditLogs) => (await db.select({ n: count() }).from(t))[0].n;
  return NextResponse.json({
    keySource: keySource(),
    plaintext: await plaintextCounts(),
    totals: { users: await c(users), studies: await c(studies), reports: await c(reports), files: await c(storedFiles), audit: await c(auditLogs) },
    retentionDraftDays: Number(await getSetting("retentionDraftDays", "0")),
  });
}

export async function POST(_req: NextRequest, { params }: Ctx) {
  const a = await authorize(["yonetici"]);
  if ("error" in a) return a.error;
  const { action } = await params;

  if (action === "encrypt-legacy") {
    let ns = 0, nr = 0;
    for (const s of await db.select({ id: studies.id, n: studies.patientName, p: studies.patientId }).from(studies)) {
      if (!isEncrypted(s.n) || !isEncrypted(s.p)) {
        await db.update(studies).set({ patientName: encryptText(s.n), patientId: encryptText(s.p) }).where(eq(studies.id, s.id));
        ns++;
      }
    }
    for (const r of await db.select({ id: reports.id, k: reports.keyImageDataUrl, c: reports.clinicalInfo }).from(reports)) {
      if ((r.k && !isEncrypted(r.k)) || (r.c && !isEncrypted(r.c))) {
        await db.update(reports).set({ keyImageDataUrl: encryptText(r.k), clinicalInfo: encryptText(r.c) }).where(eq(reports.id, r.id));
        nr++;
      }
    }
    await audit(a.user, "security.encrypt_legacy", "system", "", { studies: ns, reports: nr });
    return NextResponse.json({ ok: true, studies: ns, reports: nr });
  }

  if (action === "purge-drafts") {
    const days = Number(await getSetting("retentionDraftDays", "0"));
    if (days <= 0) return NextResponse.json({ error: "Saklama süresi tanımlı değil (0 = kapalı)" }, { status: 400 });
    const cutoff = new Date(Date.now() - days * 86400_000);
    const del = await db.delete(reports).where(and(eq(reports.status, "taslak"), lt(reports.updatedAt, cutoff))).returning({ id: reports.id });
    await audit(a.user, "retention.purge_drafts", "report", "", { days, deleted: del.length });
    return NextResponse.json({ ok: true, deleted: del.length });
  }
  return NextResponse.json({ error: "Bulunamadı" }, { status: 404 });
}
