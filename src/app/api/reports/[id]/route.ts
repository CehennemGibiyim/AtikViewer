import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { reportAddenda, reportVersions, reports, studies } from "@/db/schema";
import { audit } from "@/lib/server/audit";
import { authorize } from "@/lib/server/auth";
import { mapReport } from "@/lib/server/studyRepo";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const a = await authorize();
  if ("error" in a) return a.error;
  const id = Number((await params).id);
  const rr = (await db.select({ r: reports, s: studies }).from(reports).innerJoin(studies, eq(reports.studyId, studies.id)).where(eq(reports.id, id)).limit(1))[0];
  if (!rr) return NextResponse.json({ error: "Rapor bulunamadı" }, { status: 404 });
  const versions = await db
    .select({ id: reportVersions.id, versionNo: reportVersions.versionNo, action: reportVersions.action, createdByName: reportVersions.createdByName, createdAt: reportVersions.createdAt })
    .from(reportVersions).where(eq(reportVersions.reportId, id)).orderBy(desc(reportVersions.versionNo));
  const addenda = await db
    .select({ id: reportAddenda.id, text: reportAddenda.text, createdByName: reportAddenda.createdByName, createdAt: reportAddenda.createdAt })
    .from(reportAddenda).where(eq(reportAddenda.reportId, id)).orderBy(desc(reportAddenda.id));
  await audit(a.user, "report.view", "report", id);
  return NextResponse.json({ report: mapReport(rr.r, rr.s), versions, addenda });
}
