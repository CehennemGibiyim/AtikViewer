import { NextRequest, NextResponse } from "next/server";
import { audit } from "@/lib/server/audit";
import { authorize } from "@/lib/server/auth";
import { isUid, pacsBase, qidoInstances, qidoStudies, wadoInstance } from "@/lib/server/pacs";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ action: string }> }) {
  const a = await authorize();
  if ("error" in a) return a.error;
  const { action } = await params;
  const sp = req.nextUrl.searchParams;
  const base = await pacsBase();
  if (!base) return NextResponse.json({ error: "PACS yapılandırılmamış (Yönetim → Entegrasyon → DICOMweb adresi)" }, { status: 503 });
  try {
    if (action === "studies") {
      const q = (sp.get("q") ?? "").slice(0, 64);
      const list = await qidoStudies(base, q);
      await audit(a.user, "pacs.query", "pacs", "", { q, results: list.length });
      return NextResponse.json(list);
    }
    const studyUid = sp.get("studyUid") ?? "";
    if (!isUid(studyUid)) return NextResponse.json({ error: "Geçersiz StudyInstanceUID" }, { status: 400 });
    if (action === "instances") {
      const list = await qidoInstances(base, studyUid);
      await audit(a.user, "pacs.retrieve", "pacs", studyUid, { instances: list.length });
      return NextResponse.json(list);
    }
    if (action === "instance") {
      const seriesUid = sp.get("seriesUid") ?? "";
      const sopUid = sp.get("sopUid") ?? "";
      if (!isUid(seriesUid) || !isUid(sopUid)) return NextResponse.json({ error: "Geçersiz UID" }, { status: 400 });
      const bytes = await wadoInstance(base, studyUid, seriesUid, sopUid);
      return new NextResponse(new Uint8Array(bytes), { headers: { "Content-Type": "application/dicom", "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ error: "Bulunamadı" }, { status: 404 });
  } catch (e) {
    return NextResponse.json({ error: `PACS hatası: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 });
  }
}
