import { NextRequest, NextResponse } from "next/server";
import { audit } from "@/lib/server/audit";
import { authorize } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

/**
 * Yerel derin AI worker (ai-worker/server.py, 127.0.0.1:8787) köprüsü.
 *
 * POST /api/deep-scan  — gövde: gzip(int16 LE HU hacmi); başlıklar: X-Dims, X-Spacing
 * GET  /api/deep-scan  — worker sağlık durumu
 *
 * Hasta verisi yalnızca bu makinedeki worker'a gider; harici/ücretli servis yoktur.
 */
const WORKER = process.env.AI_WORKER_URL ?? "http://127.0.0.1:8787";
const err = (m: string, s = 400) => NextResponse.json({ error: m }, { status: s });

export async function GET() {
  try {
    const r = await fetch(`${WORKER}/health`, { signal: AbortSignal.timeout(3000) });
    const data = (await r.json()) as Record<string, unknown>;
    return NextResponse.json({ ok: true, worker: "up", ...data });
  } catch {
    return NextResponse.json({ ok: false, worker: "down", hint: "ai-worker başlatılmalı (ai-worker/server.py)" });
  }
}

export async function POST(req: NextRequest) {
  const a = await authorize();
  if ("error" in a) return a.error;

  const protocol = new URL(req.url).searchParams.get("protocol") ?? "ct-chest";
  if (protocol !== "ct-chest" && protocol !== "ct-head") return err("Geçersiz protocol (ct-chest|ct-head)");
  // Beyin modeli CPU'da dakikalar sürebilir; protokole göre zaman aşımı.
  const upstreamTimeout = protocol === "ct-head" ? 1_500_000 : 300_000;

  const dims = req.headers.get("x-dims") ?? "";
  const spacing = req.headers.get("x-spacing") ?? "";
  if (!/^\d{1,7},\d{1,7},\d{1,7}$/.test(dims)) return err("X-Dims başlığı geçersiz (Z,Y,X bekleniyor)");
  if (!/^\d+(\.\d+)?,\d+(\.\d+)?,\d+(\.\d+)?$/.test(spacing)) return err("X-Spacing başlığı geçersiz (sz,sy,sx bekleniyor)");

  const body = Buffer.from(await req.arrayBuffer());
  if (body.length < 8) return err("Boş veya çok küçük veri");
  if (body.length > 700 * 1024 * 1024) return err("Veri çok büyük (700 MB sınırı)", 413);

  let upstream: Response;
  try {
    upstream = await fetch(`${WORKER}/infer?dims=${dims}&spacing=${spacing}&protocol=${protocol}`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: new Uint8Array(body),
      signal: AbortSignal.timeout(upstreamTimeout), // CPU çıkarımı uzun sürebilir
    });
  } catch {
    return err("Yerel AI worker'a ulaşılamadı (127.0.0.1:8787). Yerel çıkarım için ai-worker başlatılmalı.", 502);
  }

  const data = (await upstream.json().catch(() => null)) as { error?: string; boxes?: unknown[] } | null;
  if (!upstream.ok || !data) return err((data as { error?: string } | null)?.error ?? `Yerel AI worker hatası (${upstream.status})`, 502);

  try {
    await audit(a.user, "ai.deep_scan", "study", (req.headers.get("x-study-uid") ?? "").slice(0, 64), {
      boxes: Array.isArray(data.boxes) ? data.boxes.length : 0,
      dims,
      protocol,
    });
  } catch { /* denetim kaydı zorunlu değil */ }

  return NextResponse.json(data);
}