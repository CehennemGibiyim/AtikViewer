import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { reports, studies } from "@/db/schema";
import { audit } from "@/lib/server/audit";
import { authorize } from "@/lib/server/auth";
import { mapReport } from "@/lib/server/studyRepo";

export const dynamic = "force-dynamic";

/** HL7 FHIR R4 DiagnosticReport dışa aktarımı. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const a = await authorize();
  if ("error" in a) return a.error;
  const id = Number((await params).id);
  const rr = (await db.select({ r: reports, s: studies }).from(reports).innerJoin(studies, eq(reports.studyId, studies.id)).where(eq(reports.id, id)).limit(1))[0];
  if (!rr) return NextResponse.json({ error: "Rapor bulunamadı" }, { status: 404 });
  const r = mapReport(rr.r, rr.s);
  const text = [
    `TEKNİK\n${r.technique}`, `BULGULAR\n${r.findingsText}`, `SONUÇ/İZLENİM\n${r.impression}`, `ÖNERİ\n${r.recommendation}`,
  ].join("\n\n");
  const fhir = {
    resourceType: "DiagnosticReport",
    id: String(r.id),
    meta: { versionId: String(r.version) },
    status: r.status === "onaylandi" ? "final" : "preliminary",
    category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/v2-0074", code: "RAD", display: "Radiology" }] }],
    code: { text: `${r.modality} — ${r.seriesDescription}` },
    subject: { identifier: { value: r.patientId }, display: r.patientName },
    effectiveDateTime: r.createdAt,
    issued: r.approvedAt ?? r.updatedAt,
    performer: r.status === "onaylandi" ? [{ display: `${r.doctorTitle} ${r.approvedBy}`.trim(), identifier: { value: r.doctorRegNo } }] : [],
    imagingStudy: [{ identifier: { system: "urn:dicom:uid", value: `urn:oid:${r.studyUid}` } }],
    conclusion: r.impression,
    presentedForm: [{ contentType: "text/plain; charset=utf-8", title: "Radyoloji raporu", data: Buffer.from(text, "utf8").toString("base64") }],
    extension: [
      { url: "urn:atikviewer:engine", valueString: r.engine },
      { url: "urn:atikviewer:content-hash", valueString: r.contentHash },
    ],
  };
  await audit(a.user, "report.export_fhir", "report", id);
  return new NextResponse(JSON.stringify(fhir, null, 2), { headers: { "Content-Type": "application/fhir+json; charset=utf-8", "Content-Disposition": `attachment; filename="rapor-${id}.fhir.json"` } });
}
