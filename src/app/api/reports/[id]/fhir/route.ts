import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { reports, studies } from "@/db/schema";
import { audit } from "@/lib/server/audit";
import { authorize } from "@/lib/server/auth";
import { mapReport } from "@/lib/server/studyRepo";
import { buildFhirReport } from "@/lib/fhir";

export const dynamic = "force-dynamic";

/** HL7 FHIR R4 DiagnosticReport dışa aktarımı. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const a = await authorize();
  if ("error" in a) return a.error;
  const id = Number((await params).id);
  const rr = (await db.select({ r: reports, s: studies }).from(reports).innerJoin(studies, eq(reports.studyId, studies.id)).where(eq(reports.id, id)).limit(1))[0];
  if (!rr) return NextResponse.json({ error: "Rapor bulunamadı" }, { status: 404 });
  const r = mapReport(rr.r, rr.s);
  const fhir = buildFhirReport(r);
  await audit(a.user, "report.export_fhir", "report", id);
  return new NextResponse(JSON.stringify(fhir, null, 2), { headers: { "Content-Type": "application/fhir+json; charset=utf-8", "Content-Disposition": `attachment; filename="rapor-${id}.fhir.json"` } });
}
