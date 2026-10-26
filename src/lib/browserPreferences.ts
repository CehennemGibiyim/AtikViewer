import type { WindowPreset } from "./types";

// Bazı gömülü önizlemelerde localStorage erişimi engellenebilir. Aynı sekmede çalışan
// bellek yedeği sayesinde bu kısıt hiçbir menüyü/işlevi çökertmez.
const memory = new Map<string, string>();

export function readPreference(key: string): unknown {
  if (typeof window === "undefined") return undefined;
  let raw: string | null | undefined;
  try { raw = window.localStorage.getItem(key); } catch { raw = memory.get(key); }
  if (raw == null) raw = memory.get(key);
  if (!raw) return undefined;
  try { return JSON.parse(raw); } catch { return undefined; }
}

/** true = diske kalıcı kaydedildi; false = yalnızca bu sekmenin belleğinde. */
export function writePreference(key: string, value: unknown): boolean {
  if (typeof window === "undefined") return false;
  const raw = JSON.stringify(value);
  memory.set(key, raw);
  try { window.localStorage.setItem(key, raw); return true; } catch { return false; }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isWindowPreset(value: unknown): value is WindowPreset {
  return isRecord(value) && typeof value.name === "string" && value.name.trim().length > 0 &&
    typeof value.wl === "number" && Number.isFinite(value.wl) &&
    typeof value.ww === "number" && Number.isFinite(value.ww) && value.ww > 0;
}

export function loadWindowPresets(): WindowPreset[] {
  const stored = readPreference("atik_presets");
  return Array.isArray(stored) ? stored.filter(isWindowPreset).slice(0, 100) : [];
}
