import { NextRequest, NextResponse } from "next/server";
import { audit } from "@/lib/server/audit";
import { getCurrentUser, updateOperator } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

/** Rapor imzasında görünecek operatör profili. Kimlik doğrulaması yoktur. */
export async function GET() {
  return NextResponse.json({ user: await getCurrentUser() });
}

export async function PATCH(req: NextRequest) {
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const patch: { fullName?: string; title?: string; regNo?: string } = {};
  for (const k of ["fullName", "title", "regNo"] as const) if (typeof b[k] === "string") patch[k] = b[k] as string;
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "Değişiklik yok" }, { status: 400 });
  const user = await updateOperator(patch);
  await audit(user, "profile.update", "user", user.id, { fields: Object.keys(patch) });
  return NextResponse.json({ ok: true, user });
}
