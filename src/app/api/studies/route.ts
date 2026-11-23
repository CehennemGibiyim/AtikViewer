import { NextRequest, NextResponse } from "next/server";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { studies, users } from "@/db/schema";
import { authorize } from "@/lib/server/auth";
import { audit } from "@/lib/server/audit";
import { mapStudyRow, upsertStudy, type StudyMeta } from "@/lib/server/studyRepo";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const a = await authorize();
  if ("error" in a) return a.error;
  const sp = req.nextUrl.searchParams;
  const status = sp.get("status") ?? "";
  const q = (sp.get("q") ?? "").toLowerCase();

  const rows = await db
    .select({ s: studies, assignedName: users.fullName })
    .from(studies)
    .leftJoin(users, eq(users.id, studies.assignedTo))
    .orderBy(desc(studies.triageScore), desc(studies.updatedAt))
    .limit(500);
  const latest = await db.execute(sql`select distinct on (study_id) study_id, status from reports order by study_id, id desc`);
  const rs = new Map((latest.rows as { study_id: number; status: string }[]).map((r) => [r.study_id, r.status]));

  let out = rows.map((r) => mapStudyRow(r.s, r.assignedName, rs.get(r.s.id) ?? null));
  if (status) out = out.filter((s) => s.workStatus === status);
  if (q) out = out.filter((s) => `${s.patientName} ${s.patientId} ${s.seriesDescription} ${s.modality} ${s.bodyPart}`.toLowerCase().includes(q));
  return NextResponse.json(out);
}

export async function POST(req: NextRequest) {
  const a = await authorize();
  if ("error" in a) return a.error;
  const b = (await req.json().catch(() => null)) as (StudyMeta & { source?: string }) | null;
  if (!b?.studyUid || !b.modality) return NextResponse.json({ error: "Eksik veri" }, { status: 400 });
  const r = await upsertStudy(b, b.source === "pacs" ? "pacs" : "yerel");
  if (r.created) await audit(a.user, "study.register", "study", r.id, { modality: b.modality, slices: b.sliceCount ?? 1 });
  return NextResponse.json(r);
}
