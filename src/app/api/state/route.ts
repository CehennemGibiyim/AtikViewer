import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { studyState } from "@/db/schema";
import { authorize } from "@/lib/server/auth";
import { decryptText, encryptText } from "@/lib/server/crypto";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const a = await authorize();
  if ("error" in a) return a.error;
  const sp = req.nextUrl.searchParams;
  const studyUid = sp.get("studyUid") ?? "";
  const seriesKey = sp.get("seriesKey") ?? "";
  const r = (await db.select().from(studyState).where(and(eq(studyState.studyUid, studyUid), eq(studyState.seriesKey, seriesKey))).limit(1))[0];
  const parse = (s: string) => { try { return s ? JSON.parse(s) : []; } catch { return []; } };
  return NextResponse.json({ annotations: parse(r?.annotations ?? ""), keyImages: parse(decryptText(r?.keyImages ?? "")) });
}

export async function PUT(req: NextRequest) {
  const a = await authorize();
  if ("error" in a) return a.error;
  const b = (await req.json().catch(() => null)) as { studyUid?: string; seriesKey?: string; annotations?: unknown[]; keyImages?: unknown[] } | null;
  if (!b?.studyUid || !b.seriesKey || !Array.isArray(b.annotations) || !Array.isArray(b.keyImages)) return NextResponse.json({ error: "Eksik veri" }, { status: 400 });
  const ann = JSON.stringify(b.annotations);
  const ki = JSON.stringify(b.keyImages);
  if (ann.length > 1_000_000 || ki.length > 4_000_000) return NextResponse.json({ error: "Veri çok büyük" }, { status: 413 });
  const values = { studyUid: b.studyUid, seriesKey: b.seriesKey, annotations: ann, keyImages: encryptText(ki), updatedBy: a.user.id, updatedAt: new Date() };
  await db.insert(studyState).values(values).onConflictDoUpdate({ target: [studyState.studyUid, studyState.seriesKey], set: values });
  return NextResponse.json({ ok: true });
}
