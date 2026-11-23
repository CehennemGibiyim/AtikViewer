import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import type { Role, UserInfo } from "@/lib/types";

/**
 * KİMLİK DOĞRULAMA KAPALI.
 *
 * Bu sürümde kullanıcı adı/parola ile oturum açma kaldırılmıştır: uygulamayı açan herkes
 * doğrudan arayüze girer ve tüm yetkilere sahiptir. Raporların imza satırında bir ad
 * bulunabilmesi için tek bir "operatör profili" (ad, unvan, sicil) saklanır; bu profil
 * kimlik DOĞRULAMAZ, yalnızca rapora yazılacak adı belirler.
 *
 * Güvenlik etkisi: Uygulamanın adresine erişebilen herkes hasta verilerini görebilir ve
 * rapor onaylayabilir. Ağ düzeyinde erişim kısıtlaması (VPN, güvenlik duvarı, ters vekilde
 * kimlik doğrulama) olmadan hasta verisiyle kullanılmamalıdır.
 */
export const OPERATOR_ID = 1;

const FALLBACK: UserInfo = {
  id: OPERATOR_ID,
  username: "operator",
  fullName: "Radyolog",
  title: "Uzm. Dr.",
  regNo: "",
  role: "yonetici",
};

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

let ensured = false;

/** Operatör profili satırını (id=1) garanti eder; çalışma atama gibi yabancı anahtarlar buna bağlıdır. */
async function ensureOperator(): Promise<void> {
  if (ensured) return;
  await db
    .insert(users)
    .values({
      id: OPERATOR_ID,
      username: FALLBACK.username,
      passwordHash: "-", // kullanılmıyor: parola ile giriş yok
      fullName: FALLBACK.fullName,
      title: FALLBACK.title,
      regNo: FALLBACK.regNo,
      role: "yonetici",
    })
    .onConflictDoNothing();
  ensured = true;
}

export async function getCurrentUser(): Promise<UserInfo> {
  try {
    await ensureOperator();
    const r = (
      await db
        .select({ id: users.id, username: users.username, fullName: users.fullName, title: users.title, regNo: users.regNo, role: users.role })
        .from(users)
        .where(eq(users.id, OPERATOR_ID))
        .limit(1)
    )[0];
    return r ? { ...r, role: r.role as Role } : FALLBACK;
  } catch {
    // Veritabanı erişilemiyorsa bile arayüz açılabilmeli (giriş engeli yok).
    return FALLBACK;
  }
}

export async function updateOperator(p: { fullName?: string; title?: string; regNo?: string }): Promise<UserInfo> {
  await ensureOperator();
  const set: Record<string, string> = {};
  if (typeof p.fullName === "string") set.fullName = p.fullName.trim().slice(0, 120) || FALLBACK.fullName;
  if (typeof p.title === "string") set.title = p.title.trim().slice(0, 60);
  if (typeof p.regNo === "string") set.regNo = p.regNo.trim().slice(0, 40);
  if (Object.keys(set).length > 0) await db.update(users).set(set).where(eq(users.id, OPERATOR_ID));
  return getCurrentUser();
}

/**
 * Geriye dönük uyumluluk için korunur: artık her zaman başarılıdır ve operatör profilini döndürür.
 * `roles` parametresi yok sayılır (rol ayrımı kalktı).
 */
export async function authorize(_roles?: Role[]): Promise<{ user: UserInfo } | { error: NextResponse }> {
  void _roles;
  return { user: await getCurrentUser() };
}
