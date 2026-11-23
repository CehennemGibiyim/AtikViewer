import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { notifications, studies } from "@/db/schema";
import { authorize } from "@/lib/server/auth";
import { audit } from "@/lib/server/audit";
import { getSetting } from "@/lib/server/settings";
import { buildAnalysis, type AnalyzeBody } from "@/lib/analyze";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = await authorize();
  if ("error" in auth) return auth.error;
  const { user } = auth;

  let body: AnalyzeBody;
  try {
    body = (await req.json()) as AnalyzeBody;
  } catch {
    return NextResponse.json({ error: "Geçersiz istek" }, { status: 400 });
  }
  const out = buildAnalysis(body);
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: 400 });
  const { result } = out;
  const { meta, engine } = body;
  const { findings, triage } = result;
  const abn = findings.filter((f) => f.severity !== "normal");
  const worst = abn[0]?.severity ?? "normal";
  const top = abn[0];

  // Triyaj bilgisini çalışma listesine yansıt + kritik bildirim
  try {
    if (body.studyUid) {
      const st = await db.select({ id: studies.id, workStatus: studies.workStatus }).from(studies).where(eq(studies.studyUid, body.studyUid)).limit(1);
      if (st[0]) {
        await db.update(studies).set({
          triageLevel: triage.level, triageScore: triage.score, aiEngine: engine,
          workStatus: st[0].workStatus === "bekliyor" ? "okunuyor" : st[0].workStatus, updatedAt: new Date(),
        }).where(eq(studies.id, st[0].id));
      }
    }
    if (engine === "cv-heuristic" && top && (worst === "kritik" || worst === "yuksek")) {
      const message = `${meta.modality} · ${meta.seriesDescription}: ${top.label} (Kesit ${top.keySliceNumber}) — aday bulgu, radyolog teyidi gerekir`;
      await db.insert(notifications).values({ severity: worst, studyUid: body.studyUid ?? "", message });
      const hook = await getSetting("criticalWebhookUrl");
      let hookStatus = "yok";
      if (hook) {
        try {
          const r = await fetch(hook, {
            method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(8000),
            body: JSON.stringify({ event: "critical_finding", severity: worst, studyUid: body.studyUid ?? "", message, at: new Date().toISOString() }),
          });
          hookStatus = String(r.status);
        } catch {
          hookStatus = "hata";
        }
      }
      await audit(user, "notify.critical", "study", body.studyUid ?? "", { severity: worst, webhook: hookStatus });
    }
    await audit(user, "ai.analyze", "study", body.studyUid ?? "", { engine, findings: findings.length, worst, slices: meta.sliceCount });
  } catch (e) {
    console.error("analyze yan etkileri başarısız:", e);
  }

  return NextResponse.json(result);
}
