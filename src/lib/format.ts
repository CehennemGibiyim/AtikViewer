import type { Finding } from "./types";

/** Güven/skor metni. Sezgisel skor olasılık değildir; demo bulgular açıkça etiketlenir. */
export function fmtConf(f: Pick<Finding, "confidence" | "confidenceKind">): string {
  const pct = Math.round(f.confidence * 100);
  if (f.confidenceKind === "none") return "";
  if (f.confidenceKind === "simulated") return `%${pct} (demo)`;
  return `skor ${pct}/100 (kalibre değil)`;
}

export function fmtConfShort(f: Pick<Finding, "confidence" | "confidenceKind">): string {
  const pct = Math.round(f.confidence * 100);
  if (f.confidenceKind === "none") return "";
  return f.confidenceKind === "simulated" ? `%${pct} demo` : `skor ${pct}`;
}
