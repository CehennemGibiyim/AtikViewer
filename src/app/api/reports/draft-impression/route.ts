import { NextRequest, NextResponse } from "next/server";
import { audit } from "@/lib/server/audit";
import { authorize } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

interface DraftBody {
  modality: string;
  bodyPart: string;
  findings: { label: string; detail: string; slice: number; category: string; severity: string; status: string }[];
}

/**
 * İzlenim taslağı. LLM_API_URL + LLM_API_KEY (OpenAI uyumlu) tanımlıysa LLM kullanılır; değilse kural tabanlı üretilir.
 * Yalnızca hekimin doğruladığı/düzenlediği bulgular gönderilir; hasta adı/kimliği ASLA gönderilmez.
 */
export async function POST(req: NextRequest) {
  const a = await authorize(["radyolog", "yonetici"]);
  if ("error" in a) return a.error;
  const b = (await req.json().catch(() => null)) as DraftBody | null;
  const verified = (b?.findings ?? []).filter((f) => (f.status === "onaylandi" || f.status === "duzenlendi") && f.category !== "Sistem" && f.category !== "ROI");
  if (!b || verified.length === 0) return NextResponse.json({ error: "Önce en az bir bulguyu 'Onayla/Düzenlendi' olarak işaretleyin" }, { status: 400 });

  const rule = `${verified.map((f, i) => `${i + 1}) ${f.label} (Kesit ${f.slice})`).join("; ")}. Klinik korelasyon önerilir.`;
  const url = process.env.LLM_API_URL;
  const key = process.env.LLM_API_KEY;
  let text = rule;
  let source: "llm" | "kural" = "kural";

  if (url && key) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(30000),
        body: JSON.stringify({
          model: process.env.LLM_MODEL ?? "gpt-4o-mini",
          temperature: 0.2,
          messages: [
            { role: "system", content: "Sen bir radyoloji raporlama yardımcısısın. Yalnızca verilen, hekimce doğrulanmış bulgulara dayanarak Türkçe, kısa (en fazla 90 kelime) bir 'SONUÇ/İZLENİM' taslağı yaz. Bulgularda olmayan hiçbir bilgi, tanı veya ölçü ekleme. Emin olunmayan konuda 'klinik korelasyon önerilir' de." },
            { role: "user", content: `Modalite: ${b.modality}\nBölge: ${b.bodyPart}\nDoğrulanmış bulgular:\n${verified.map((f) => `- [Kesit ${f.slice}] ${f.label}: ${f.detail}`).join("\n")}` },
          ],
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
        const t = data.choices?.[0]?.message?.content?.trim();
        if (t) { text = t; source = "llm"; }
      }
    } catch {
      /* kural tabanlı yedeğe düş */
    }
  }
  await audit(a.user, "report.draft_impression", "report", "", { source, findings: verified.length });
  return NextResponse.json({ text, source });
}
