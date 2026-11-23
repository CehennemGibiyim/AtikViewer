import { createHash } from "node:crypto";
import { asc, desc, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs } from "@/db/schema";

/**
 * Hash zincirli denetim kaydı: her satır, bir önceki satırın hash'ini içerir.
 * Satırlar veritabanı tetikleyicisiyle değiştirilemez/silinemez; zincir `verifyChain` ile doğrulanır.
 * Not: veritabanı yöneticisi tetikleyiciyi kaldırabilir — zincir bu durumda değişikliği ortaya çıkarır.
 */
let triggerReady = false;

async function ensureTrigger() {
  if (triggerReady) return;
  await db.execute(
    sql.raw(`CREATE OR REPLACE FUNCTION audit_logs_immutable() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'audit_logs yalnızca eklemeye açıktır'; END; $$ LANGUAGE plpgsql`)
  );
  await db.execute(sql.raw(`DROP TRIGGER IF EXISTS audit_logs_guard ON audit_logs`));
  await db.execute(
    sql.raw(`CREATE TRIGGER audit_logs_guard BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable()`)
  );
  triggerReady = true;
}

function computeHash(prev: string, ts: Date, userId: number | null, username: string, action: string, entityType: string, entityId: string, details: string) {
  return createHash("sha256")
    .update([prev, ts.toISOString(), userId ?? "", username, action, entityType, entityId, details].join("|"))
    .digest("hex");
}

export interface Actor {
  id: number | null;
  username: string;
}

export async function audit(
  actor: Actor | null,
  action: string,
  entityType = "",
  entityId: string | number = "",
  details: Record<string, unknown> = {}
): Promise<void> {
  await ensureTrigger();
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(7001)`);
    const last = await tx.select({ hash: auditLogs.hash }).from(auditLogs).orderBy(desc(auditLogs.id)).limit(1);
    const prevHash = last[0]?.hash ?? "GENESIS";
    const ts = new Date();
    const detailsStr = JSON.stringify(details);
    const username = actor?.username ?? "sistem";
    const hash = computeHash(prevHash, ts, actor?.id ?? null, username, action, entityType, String(entityId), detailsStr);
    await tx.insert(auditLogs).values({
      ts,
      userId: actor?.id ?? null,
      username,
      action,
      entityType,
      entityId: String(entityId),
      details: detailsStr,
      prevHash,
      hash,
    });
  });
}

export async function verifyChain(): Promise<{ ok: boolean; count: number; brokenAtId?: number; reason?: string }> {
  const rows = await db.select().from(auditLogs).orderBy(asc(auditLogs.id));
  let prev = "GENESIS";
  for (const r of rows) {
    if (r.prevHash !== prev) return { ok: false, count: rows.length, brokenAtId: r.id, reason: "Önceki hash uyuşmuyor (satır silinmiş/araya eklenmiş olabilir)" };
    const h = computeHash(prev, r.ts, r.userId, r.username, r.action, r.entityType, r.entityId, r.details);
    if (h !== r.hash) return { ok: false, count: rows.length, brokenAtId: r.id, reason: "Satır içeriği hash ile uyuşmuyor (değiştirilmiş)" };
    prev = r.hash;
  }
  return { ok: true, count: rows.length };
}
