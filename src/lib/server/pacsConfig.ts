import { coercePacsConfig, unsealPacsConfig } from "./pacs";
import { getSetting } from "./settings";
import { DEFAULT_PACS, trimRoot, type PacsConfig } from "@/lib/pacsPresets";

/**
 * PACS yapılandırmasının veritabanından okunması (app_settings → `pacs` anahtarı).
 * Ayrı dosyada: DICOMweb istemcisi (pacs.ts) veritabanı bilmez, böylece testler
 * DB olmadan çalışır.
 *
 * Geriye dönük uyumluluk: `pacs` kaydı yoksa eski `pacsBaseUrl` ayarı kullanılır.
 */
export async function loadPacsConfig(): Promise<PacsConfig | null> {
  const raw = (await getSetting("pacs", "")).trim();
  if (raw) {
    try {
      const parsed = coercePacsConfig(JSON.parse(raw));
      if (parsed) return parsed;
    } catch {
      /* bozuk kayıt: aşağıda eski ayara düşülür */
    }
  }
  const legacy = trimRoot(await getSetting("pacsBaseUrl", ""));
  if (legacy && /^https?:\/\//i.test(legacy)) {
    return { ...DEFAULT_PACS, name: "PACS", kind: "custom", qidoRoot: legacy, notes: "Adres 'pacsBaseUrl' (eski) ayarından okunuyor." };
  }
  return null;
}

/** Şifreli alanları çözer; yönetim paneli bunu `publicPacsConfig` ile sunar. */
export const sealedPacsConfig = unsealPacsConfig;
