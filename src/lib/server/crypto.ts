import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Alan düzeyi AES-256-GCM şifreleme.
 * Anahtar önceliği: DATA_ENCRYPTION_KEY (base64, 32 bayt) → yoksa .data/enc.key dosyası (otomatik üretilir, 0600).
 * Üretimde anahtarı veritabanından ayrı bir KMS/ortam değişkeninde tutun.
 */
export const ENC_PREFIX = "enc:v1:";
export const DATA_DIR = path.join(/* turbopackIgnore: true */ process.cwd(), ".data");

let cached: Buffer | null = null;
let source: "env" | "file" = "file";

function getKey(): Buffer {
  if (cached) return cached;
  const env = process.env.DATA_ENCRYPTION_KEY;
  if (env) {
    const b = Buffer.from(env, "base64");
    if (b.length !== 32) throw new Error("DATA_ENCRYPTION_KEY base64 olarak 32 bayt olmalıdır");
    source = "env";
    cached = b;
    return b;
  }
  const file = path.join(DATA_DIR, "enc.key");
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(file)) {
    cached = Buffer.from(fs.readFileSync(file, "utf8").trim(), "base64");
  } else {
    cached = randomBytes(32);
    fs.writeFileSync(file, cached.toString("base64"), { mode: 0o600 });
  }
  source = "file";
  return cached;
}

export function keySource(): "env" | "file" {
  getKey();
  return source;
}

export function isEncrypted(s: string): boolean {
  return s.startsWith(ENC_PREFIX);
}

export function encryptText(plain: string): string {
  if (!plain || isEncrypted(plain)) return plain;
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", getKey(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ENC_PREFIX + Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}

export function decryptText(s: string): string {
  if (!s || !isEncrypted(s)) return s;
  try {
    const b = Buffer.from(s.slice(ENC_PREFIX.length), "base64");
    const d = createDecipheriv("aes-256-gcm", getKey(), b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8");
  } catch {
    return "[çözülemedi]";
  }
}

export function encryptBuffer(buf: Buffer): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", getKey(), iv);
  const ct = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]);
}

export function decryptBuffer(buf: Buffer): Buffer {
  const d = createDecipheriv("aes-256-gcm", getKey(), buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]);
}
