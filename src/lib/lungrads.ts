/**
 * Nodül takibi için Lung-RADS (ACR v2022 özet eşikleri) ve büyüme hesapları.
 * Bu bir ÖZETTİR ve klinik karar aracı değildir; kesin sınıflandırma için güncel ACR tablosuna bakın.
 */
export type NoduleKind = "solid" | "partsolid" | "ggn";
export type NoduleStatus = "baseline" | "new" | "growing" | "stable";

export interface NodulePoint { date: string; diameterMm: number; solidMm?: number; note?: string; slice?: number }
export interface NoduleTrack { id: string; label: string; location: string; kind: NoduleKind; points: NodulePoint[] }

export const KIND_LABEL: Record<NoduleKind, string> = { solid: "Solid", partsolid: "Kısmen solid", ggn: "Buzlu cam" };

/** Lung-RADS kategorisi. diameter: ortalama çap (mm); solid: kısmen solid nodülün solid bileşeni (mm). */
export function lungRadsCategory(kind: NoduleKind, status: NoduleStatus, diameterMm: number, solidMm = 0): "2" | "3" | "4A" | "4B" {
  if (kind === "solid") {
    if (status === "growing") return diameterMm < 8 ? "4A" : "4B";
    if (status === "new") return diameterMm < 4 ? "2" : diameterMm < 6 ? "3" : diameterMm < 8 ? "4A" : "4B";
    return diameterMm < 6 ? "2" : diameterMm < 8 ? "3" : diameterMm < 15 ? "4A" : "4B"; // baseline / stable
  }
  if (kind === "ggn") {
    if (status === "growing") return "3";
    return diameterMm < 30 ? "2" : "3";
  }
  // kısmen solid
  if (status === "growing") return solidMm < 4 ? "4A" : "4B";
  if (status === "new") return diameterMm < 6 ? "3" : solidMm < 4 ? "4A" : "4B";
  if (diameterMm < 6) return "2";
  return solidMm < 6 ? "3" : solidMm < 8 ? "4A" : "4B";
}

export const ADVICE: Record<string, string> = {
  "2": "12 ay sonra rutin düşük doz BT.",
  "3": "6 ay sonra düşük doz BT.",
  "4A": "3 ay sonra düşük doz BT; ≥8 mm solid bileşende PET-BT değerlendirilebilir.",
  "4B": "Diagnostik BT, PET-BT ve/veya doku örneklemesi/ilgili branş yönlendirmesi.",
};

const DAY = 86400000;
export const daysBetween = (a: string, b: string) => (new Date(b).getTime() - new Date(a).getTime()) / DAY;

export interface TrackSummary {
  status: NoduleStatus;
  latest: NodulePoint;
  first: NodulePoint;
  growthMm: number;
  growth12mMm: number | null;   // son 12 ay içindeki en eski ölçüme göre değişim
  vdtDays: number | null;       // hacim ikilenme süresi (küre varsayımı); büyüme yoksa null
  category: "2" | "3" | "4A" | "4B";
}

/** Zaman sıralı ölçümlerden özet. Durum: tek ölçüm=ilk; son 12 ay içinde >1,5 mm artış=büyüyor; aksi=stabil. */
export function summarize(t: NoduleTrack, newlyAppeared = false): TrackSummary | null {
  const pts = [...t.points].sort((a, b) => a.date.localeCompare(b.date));
  if (pts.length === 0) return null;
  const first = pts[0], latest = pts[pts.length - 1];
  const within = pts.filter((p) => p !== latest && daysBetween(p.date, latest.date) <= 366);
  const ref = within.length ? within[0] : null;
  const growth12 = ref ? latest.diameterMm - ref.diameterMm : null;
  let status: NoduleStatus = pts.length === 1 ? (newlyAppeared ? "new" : "baseline") : growth12 !== null && growth12 > 1.5 ? "growing" : "stable";
  const prev = pts.length > 1 ? pts[pts.length - 2] : null;
  let vdt: number | null = null;
  if (prev) {
    const dt = daysBetween(prev.date, latest.date);
    const r = latest.diameterMm / Math.max(1e-6, prev.diameterMm);
    if (dt > 0 && r > 1.0001) vdt = (dt * Math.LN2) / (3 * Math.log(r));
  }
  if (status === "stable" && vdt !== null && vdt < 400) status = "growing"; // hızlı büyüme eğilimi
  return { status, latest, first, growthMm: latest.diameterMm - first.diameterMm, growth12mMm: growth12, vdtDays: vdt, category: lungRadsCategory(t.kind, status, latest.diameterMm, latest.solidMm ?? 0) };
}

export const csvOf = (tracks: NoduleTrack[]) =>
  ["nodul;konum;tur;tarih;cap_mm;solid_mm;not", ...tracks.flatMap((t) => [...t.points].sort((a, b) => a.date.localeCompare(b.date)).map((p) => [t.label, t.location, KIND_LABEL[t.kind], p.date, p.diameterMm, p.solidMm ?? "", (p.note ?? "").replace(/[;\n]/g, " ")].join(";")))].join("\n");
