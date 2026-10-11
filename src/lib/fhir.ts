import type { SavedReport } from "@/lib/types";

/** UTF-8 metni base64'e çevirir (tarayıcı ve Node'da çalışır). */
function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** HL7 FHIR R4 DiagnosticReport kaynağı. Sunucu ucu ve statik demo aynı fonksiyonu kullanır. */
export function buildFhirReport(r: SavedReport) {
  const text = [`TEKNİK\n${r.technique}`, `BULGULAR\n${r.findingsText}`, `SONUÇ/İZLENİM\n${r.impression}`, `ÖNERİ\n${r.recommendation}`].join("\n\n");
  return {
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
    presentedForm: [{ contentType: "text/plain; charset=utf-8", title: "Radyoloji raporu", data: toBase64(text) }],
    extension: [
      { url: "urn:atikviewer:engine", valueString: r.engine },
      { url: "urn:atikviewer:content-hash", valueString: r.contentHash },
    ],
  };
}
