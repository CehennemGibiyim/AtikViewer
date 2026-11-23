import { defineConfig } from "drizzle-kit";

// Bağlantıyı DATABASE_URL'den okur; tanımlı değilse yerel varsayılana düşer.
// Kullanım: npx drizzle-kit push --config=drizzle.config.ts
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  },
});
