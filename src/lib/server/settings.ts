import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";

export async function getSetting(key: string, fallback = ""): Promise<string> {
  const r = await db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
  return r[0]?.value ?? fallback;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db.insert(appSettings).values({ key, value }).onConflictDoUpdate({ target: appSettings.key, set: { value } });
}

export function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}
