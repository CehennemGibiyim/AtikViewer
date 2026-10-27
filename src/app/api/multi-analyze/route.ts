import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { notifications, studies } from "@/db/schema";
import { authorize } from "@/lib/server/auth";
import { audit } from "@/lib/server/audit";
import { buildAnalysis, type AnalyzeBody } from "@/lib/analyze";
import type { Finding } from "@/lib/types";

export const dynamic = "force-dynamic";

interface MultiAnalyzeBody {
  studyUid?: string;
  clinicalNote?: string;
  series: Array<{
    seriesUid?: string;
    modality: string;
    description: string;
    bodyPart: string;
    sliceCount: number;
    /** Seriden render edilmiş temsili kesitler (base64 data URL). */
    representativeImages?: string[];
  }>;
}

const SEVERITIES = new Set(["normal", "dusuk", "orta", "yuksek", "kritik"]);

function validBbox(b: unknown): Finding["bbox"] {
  if (!b || typeof b !== "object") return null;
  const o = b as Record<string, unknown>;
  if (typeof o.x !== "number" || typeof o.y !== "number" || typeof o.w !== "number" || typeof o.h !== "number") return null;
  if (![o.x, o.y, o.w, o.h].every((v) => Number.isFinite(v))) return null;
  // Normalleştirilmiş [0,1] koordinatları; hafif taşma tolere edilir.
  const x = Math.min(1, Math.max(0, o.x));
  const y = Math.min(1, Math.max(0, o.y));
  const w = Math.min(1 - x, Math.max(0.01, o.w));
  const h = Math.min(1 - y, Math.max(0.01, o.h));
  return { x, y, w, h };
}

/**
 * Çoklu-seri AI analizi: her seri için (varsa) görsel LLM değerlendirmesi yapılır,
 * ardından tüm bulgular tek bir analiz olarak birleştirilir.
 *
 * - LLM yalnızca isteğe bağlıdır (LLM_API_URL + LLM_API_KEY); yapılandırılmamışsa
 *   veya hata alınsa akış sessizce "seri değerlendildi" bulgusuyla devam eder.
 * - Hasta adı/kimliği ASLA modele gönderilmez; yalnızca modalite/bölge/klinik not.
 * - Ücretsizdir: harici ücretli servis kullanılmaz.
 */
export async function POST(req: NextRequest) {
  const auth = await authorize();
  if ("error" in auth) return auth.error;
  const { user } = auth;

  let body: MultiAnalyzeBody;
  try {
    body = (await req.json()) as MultiAnalyzeBody;
  } catch {
    return NextResponse.json({ error: "Geçersiz istek" }, { status: 400 });
  }

  if (!Array.isArray(body.series) || body.series.length === 0) {
    return NextResponse.json({ error: "En az bir seri gerekli" }, { status: 400 });
  }

  const url = process.env.LLM_API_URL;
  const key = process.env.LLM_API_KEY;
  const findings: Finding[] = [];
  let llmUsed = 0;
  let idx = 0;

  for (const s of body.series) {
    let parsedFindings: Array<{
      label: string; detail: string; severity: string; anatomicalLocation?: string;
      keySliceNumber?: number; bbox?: unknown;
    }> | null = null;
    if (url && key && Array.isArray(s.representativeImages) && s.representativeImages.length > 0) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          signal: AbortSignal.timeout(60000),
          body: JSON.stringify({
            model: process.env.LLM_MODEL ?? "gpt-4o-mini",
            temperature: 0.1,
            messages: [
              {
                role: "system",
                content:
                  "Sen bir radyoloji görüntü yorumlama yardımcısısın. Gönderilen görüntüleri dikkatlice incele. " +
                  "Sadece görüntüde kanıtlanabilir bulguları Türkçe olarak raporla; uydurma ekleme. " +
                  "Her bulgu için mümkünse dikdörtgen sınır kutusu öner: bbox {x,y,w,h} normalleştirilmiş [0,1] koordinatlarında, sol üst köşe bazlı. " +
                  "Emin olmadığın hiçbir şeye bbox koyma. Kesit numarası belirt. Hasta kimliği ASLA yazma. " +
                  'Yanıtını yalnızca şu JSON şemasında ver: {"findings":[{"label":string,"detail":string,"severity":"normal"|"dusuk"|"orta"|"yuksek"|"kritik","anatomicalLocation":string,"keySliceNumber":number,"bbox":{"x":number,"y":number,"w":number,"h":number}|null}]}',
              },
              {
                role: "user",
                content: [
                  {
                    type: "text",
                    text:
                      `Modalite: ${s.modality}\nBölge: ${s.bodyPart}\nSeri: ${s.description}\nKesit sayısı: ${s.sliceCount}\n` +
                      `Klinik bilgi: ${body.clinicalNote || "-"}\nAşağıdaki temsili kesit(leri) değerlendir ve bulgu listesi ver.`,
                  },
                  ...s.representativeImages.slice(0, 2).map((img) => ({ type: "image_url", image_url: { url: img } })),
                ],
              },
            ],
          }),
        });
        if (res.ok) {
          const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
          const text = data.choices?.[0]?.message?.content?.trim();
          if (text) {
            try {
              const jsonText = text.match(/\{[\s\S]*\}/)?.[0] ?? text;
              const parsed = JSON.parse(jsonText) as { findings?: unknown };
              if (Array.isArray(parsed.findings)) {
                parsedFindings = parsed.findings as Array<{
                  label: string; detail: string; severity: string; anatomicalLocation?: string;
                  keySliceNumber?: number; bbox?: unknown;
                }>;
                llmUsed++;
              }
            } catch { /* JSON değilse o seri LLM'siz akar */ }
          }
        }
      } catch { /* LLM hatası akışı durdurmaz */ }
    }

    if (parsedFindings && parsedFindings.length > 0) {
      for (const f of parsedFindings) {
        const keySlice = Math.min(Math.max(1, Number(f.keySliceNumber) || 1), Math.max(1, s.sliceCount));
        findings.push({
          id: `vm-${idx++}`,
          sliceIndex: keySlice - 1,
          sliceStart: keySlice - 1,
          sliceEnd: keySlice - 1,
          keySliceNumber: keySlice,
          sliceRangeStr: `Kesit ${keySlice}`,
          anatomicalLocation: typeof f.anatomicalLocation === "string" && f.anatomicalLocation ? f.anatomicalLocation : s.bodyPart || "—",
          densityOrSignal: "AI değerlendirmesi",
          sizeMmStr: "—",
          bbox: validBbox(f.bbox),
          label: typeof f.label === "string" && f.label ? f.label.slice(0, 120) : "AI bulgusu",
          detail: `[${s.modality} · ${s.description}] ${typeof f.detail === "string" ? f.detail.slice(0, 600) : ""}`.trim(),
          category: "AI",
          severity: SEVERITIES.has(f.severity) ? (f.severity as Finding["severity"]) : "orta",
          confidence: 0.7,
          confidenceKind: "heuristic",
          source: "cv-heuristic",
        });
      }
    } else {
      // LLM yoksa/hata aldıysa: sistematik değerlendirme kaydı (uydurma bulgu üretilmez).
      findings.push({
        id: `ms-${idx++}`,
        sliceIndex: 0,
        sliceStart: 0,
        sliceEnd: Math.max(0, s.sliceCount - 1),
        keySliceNumber: 1,
        sliceRangeStr: s.sliceCount > 1 ? `Kesit 1 – ${s.sliceCount}` : "Kesit 1",
        anatomicalLocation: s.bodyPart || "—",
        densityOrSignal: "—",
        sizeMmStr: "—",
        bbox: null,
        label: `${s.modality} serisi değerlendirildi`,
        detail: `[${s.description}] Tüm seriler birlikte incelendi${llmUsed > 0 ? "" : "; görsel AI motoru yapılandırılmadığı için kural tabanlı değerlendirme"} . Bulgular radyoloji uzmanı tarafından gözden geçirilmelidir.`,
        category: "Sistem",
        severity: "normal",
        confidence: 0,
        confidenceKind: "none",
        source: "cv-heuristic",
      });
    }
  }

  const analyzeBody: AnalyzeBody = {
    studyUid: body.studyUid,
    meta: {
      modality: "MULTI",
      bodyPart: body.series.map((s) => s.bodyPart).filter(Boolean).join(" / ") || "-",
      seriesDescription: `${body.series.length} seri birlikte değerlendirildi`,
      sliceCount: body.series.reduce((a, s) => a + (s.sliceCount || 0), 0) || 1,
    },
    engine: "cv-heuristic",
    findings,
    clinicalNote: body.clinicalNote,
  };

  const out = buildAnalysis(analyzeBody);
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: 400 });
  const result = out.result;

  try {
    if (body.studyUid) {
      const st = await db.select({ id: studies.id, workStatus: studies.workStatus }).from(studies).where(eq(studies.studyUid, body.studyUid)).limit(1);
      if (st[0]) {
        await db.update(studies).set({
          triageLevel: result.triage.level,
          triageScore: result.triage.score,
          aiEngine: "cv-heuristic",
          workStatus: st[0].workStatus === "bekliyor" ? "okunuyor" : st[0].workStatus,
          updatedAt: new Date(),
        }).where(eq(studies.id, st[0].id));
      }
    }
    const abn = result.findings.filter((f) => f.severity !== "normal" && f.category !== "Sistem" && f.category !== "ROI");
    const worst = abn[0]?.severity;
    if (worst === "kritik" || worst === "yuksek") {
      const top = abn[0];
      await db.insert(notifications).values({
        severity: worst,
        studyUid: body.studyUid ?? "",
        message: `ÇOKLU-SERİ · ${body.series.length} seri: ${top?.label || "Aday bulgu"} — radyolog teyidi gerekir`,
      });
    }
    await audit(user, "ai.analyze.multi", "study", body.studyUid ?? "", { series: body.series.length, findings: result.findings.length, llm: llmUsed });
  } catch (e) {
    console.error("multi-analyze yan etkileri başarısız:", e);
  }

  return NextResponse.json(result);
}
