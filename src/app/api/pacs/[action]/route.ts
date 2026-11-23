import { NextRequest, NextResponse } from "next/server";
import { audit } from "@/lib/server/audit";
import { authorize } from "@/lib/server/auth";
import { isUid, qidoInstances, qidoStudies, testConnection, wadoInstance } from "@/lib/server/pacs";
import { loadPacsConfig } from "@/lib/server/pacsConfig";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ action: string }> }) {
  const a = await authorize();
  if ("error" in a) return a.error;
  const { action } = await params;
  const sp = req.nextUrl.searchParams;
  const cfg = await loadPacsConfig();
  if (!cfg) return NextResponse.json({ error: "PACS yapılandırılmamış (Yönetim → Entegrasyon → PACS)" }, { status: 503 });

  try {
    if (action === "studies") {
      const q = (sp.get("q") ?? "").slice(0, 64);
      const list = await qidoStudies(cfg, q);
      await audit(a.user, "pacs.query", "pacs", "", { q, results: list.length, pacs: cfg.name || cfg.kind });
      return NextResponse.json(list);
    }
    if (action === "test") {
      const result = await testConnection(cfg);
      await audit(a.user, "pacs.test", "pacs", "", { ok: result.ok, steps: result.steps.map((s) => `${s.name}:${s.http ?? "ağ"}`) });
      return NextResponse.json(result);
    }
    const studyUid = sp.get("studyUid") ?? "";
    if (!isUid(studyUid)) return NextResponse.json({ error: "Geçersiz StudyInstanceUID" }, { status: 400 });
    if (action === "instances") {
      const list = await qidoInstances(cfg, studyUid);
      await audit(a.user, "pacs.retrieve", "pacs", studyUid, { instances: list.length });
      return NextResponse.json(list);
    }
    if (action === "instance") {
      const seriesUid = sp.get("seriesUid") ?? "";
      const sopUid = sp.get("sopUid") ?? "";
      if (!isUid(seriesUid) || !isUid(sopUid)) return NextResponse.json({ error: "Geçersiz UID" }, { status: 400 });
      const bytes = await wadoInstance(cfg, studyUid, seriesUid, sopUid);
      return new NextResponse(new Uint8Array(bytes), { headers: { "Content-Type": "application/dicom", "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ error: "Bulunamadı" }, { status: 404 });
  } catch (e) {
    // Ağ/sertifika/durum hataları zaten Türkçe ve ayırt edilebilir mesajla geliyor.
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
