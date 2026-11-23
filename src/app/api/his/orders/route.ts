import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { audit } from "@/lib/server/audit";
import { upsertStudy } from "@/lib/server/studyRepo";

export const dynamic = "force-dynamic";

/**
 * HBYS/RIS istem alımı (REST). Başlık: x-api-key = HIS_API_KEY ortam değişkeni.
 * Gövde: { patientName, patientId, patientAge?, patientSex?, accessionNumber, modality, bodyPart, description, studyUid? }
 * Not: HL7 v2 (MLLP/TCP) alıcısı bu sürümde yoktur; bir arabirim motoru (ör. Mirth) ile bu uca köprülenebilir.
 */
export async function POST(req: NextRequest) {
  const key = process.env.HIS_API_KEY;
  if (!key) return NextResponse.json({ error: "HIS entegrasyonu yapılandırılmamış (HIS_API_KEY)" }, { status: 503 });
  const given = Buffer.from(req.headers.get("x-api-key") ?? "");
  const exp = Buffer.from(key);
  if (given.length !== exp.length || !timingSafeEqual(given, exp)) return NextResponse.json({ error: "Yetkisiz" }, { status: 401 });

  const b = (await req.json().catch(() => null)) as Record<string, string> | null;
  if (!b?.patientId || !b.modality || !b.accessionNumber) return NextResponse.json({ error: "patientId, modality ve accessionNumber gerekli" }, { status: 400 });
  const studyUid = b.studyUid || `his.${b.accessionNumber}`;
  const r = await upsertStudy(
    { studyUid, patientName: b.patientName, patientId: b.patientId, patientAge: b.patientAge, patientSex: b.patientSex, accession: b.accessionNumber, modality: b.modality, bodyPart: b.bodyPart ?? "", seriesDescription: b.description ?? "HBYS istemi", sliceCount: 0 },
    "his"
  );
  await audit(null, "his.order", "study", r.id, { accession: b.accessionNumber, modality: b.modality, created: r.created });
  return NextResponse.json({ ok: true, ...r });
}
