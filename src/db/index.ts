import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  // Sık karşılaşılan taze kurulum hatası: `.env` yokken derleme/çalışma burada patlar.
  throw new Error(
    "DATABASE_URL tanımlı değil — `.env` dosyası oluşturulmalı.\n" +
      "  Windows (PowerShell): Copy-Item .env.example .env\n" +
      "  Linux/macOS:          cp .env.example .env\n" +
      "  Ardından veritabanı şemasını uygulayın: npx drizzle-kit push --config=drizzle.config.ts\n" +
      "  Ayrıntı: docs/WINDOWS_KURULUM.md veya README.md (Manuel kurulum)"
  );
}

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
};

export const pool =
  globalForDb.__arenaNextJsPostgresqlPool ??
  new Pool({
    connectionString: databaseUrl,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__arenaNextJsPostgresqlPool = pool;
}

export const db = drizzle(pool);
