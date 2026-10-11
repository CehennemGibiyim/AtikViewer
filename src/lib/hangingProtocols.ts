import type { HangingProtocolRule, Layout, SeriesData } from "./types";
import { isRecord, readPreference, writePreference } from "./browserPreferences";

export const SYSTEM_HANGING_PROTOCOLS: HangingProtocolRule[] = [
  {
    id: "sys-ct-head",
    name: "BT Beyin (Beyin + Kemik Penceresi)",
    description: "Aksiyel BT Beyin serisini sol panelde Beyin penceresinde, sağ panelde Kemik penceresinde senkron gösterir.",
    isSystem: true,
    match: {
      modalities: ["CT"],
      bodyParts: ["HEAD", "BRAIN", "BEYİN", "BEYIN", "CRANIUM", "KAFA"],
      seriesDescriptionRegex: "HEAD|BRAIN|BEYIN|BEYİN|CRAN|AXIAL|AKSIYEL",
    },
    layout: "1x2",
    cells: [
      {
        cellIndex: 0,
        seriesMatcher: { modality: "CT", sequenceIndex: 0 },
        windowPreset: "Beyin",
        customWL: { wl: 40, ww: 80 },
        syncSlice: true,
      },
      {
        cellIndex: 1,
        seriesMatcher: { modality: "CT", sequenceIndex: 0 },
        windowPreset: "Kemik",
        customWL: { wl: 500, ww: 2000 },
        syncSlice: true,
      },
    ],
  },
  {
    id: "sys-ct-chest",
    name: "BT Toraks (Akciğer + Mediasten Penceresi)",
    description: "Toraks BT incelemesinde Akciğer ve Mediasten/Yumuşak Doku pencerelerini 1×2 yan yana senkronize eder.",
    isSystem: true,
    match: {
      modalities: ["CT"],
      bodyParts: ["CHEST", "THORAX", "TORAKS", "LUNG", "AKCİĞER", "AKCIGER"],
      seriesDescriptionRegex: "CHEST|THORAX|TORAKS|LUNG|AKCIGER",
    },
    layout: "1x2",
    cells: [
      {
        cellIndex: 0,
        seriesMatcher: { modality: "CT", sequenceIndex: 0 },
        windowPreset: "Akciğer",
        customWL: { wl: -600, ww: 1500 },
        syncSlice: true,
      },
      {
        cellIndex: 1,
        seriesMatcher: { modality: "CT", sequenceIndex: 0 },
        windowPreset: "Mediasten",
        customWL: { wl: 40, ww: 400 },
        syncSlice: true,
      },
    ],
  },
  {
    id: "sys-ct-abdomen",
    name: "BT Abdomen / Pelvis (Doku + Karaciğer + Kemik)",
    description: "Abdomen BT için 2×2 düzende Yumuşak doku, Karaciğer ve Kemik pencerelerini senkronize açar.",
    isSystem: true,
    match: {
      modalities: ["CT"],
      bodyParts: ["ABDOMEN", "PELVIS", "BATIN", "KARIN"],
      seriesDescriptionRegex: "ABD|BATIN|PELVIS|LIVER|KARACIGER",
    },
    layout: "2x2",
    cells: [
      {
        cellIndex: 0,
        seriesMatcher: { modality: "CT", sequenceIndex: 0 },
        windowPreset: "Yumuşak doku",
        customWL: { wl: 50, ww: 350 },
        syncSlice: true,
      },
      {
        cellIndex: 1,
        seriesMatcher: { modality: "CT", sequenceIndex: 0 },
        windowPreset: "Karaciğer",
        customWL: { wl: 60, ww: 160 },
        syncSlice: true,
      },
      {
        cellIndex: 2,
        seriesMatcher: { modality: "CT", sequenceIndex: 0 },
        windowPreset: "Kemik",
        customWL: { wl: 300, ww: 1500 },
        syncSlice: true,
      },
      {
        cellIndex: 3,
        seriesMatcher: { modality: "CT", sequenceIndex: 0 },
        windowPreset: "Akciğer",
        customWL: { wl: -600, ww: 1500 },
        syncSlice: true,
      },
    ],
  },
  {
    id: "sys-mr-multi",
    name: "MR Çoklu Sekans (T1, T2, FLAIR, DWI 2×2)",
    description: "Manyetik Rezonans serilerinde farklı sekansları 2×2 ızgarada otomatik eşleştirip konum senkronu ile sunar.",
    isSystem: true,
    match: {
      modalities: ["MR"],
      minSeriesCount: 2,
    },
    layout: "2x2",
    cells: [
      {
        cellIndex: 0,
        seriesMatcher: { sequenceIndex: 0 },
        syncSlice: true,
      },
      {
        cellIndex: 1,
        seriesMatcher: { sequenceIndex: 1 },
        syncSlice: true,
      },
      {
        cellIndex: 2,
        seriesMatcher: { sequenceIndex: 2 },
        syncSlice: true,
      },
      {
        cellIndex: 3,
        seriesMatcher: { sequenceIndex: 3 },
        syncSlice: true,
      },
    ],
  },
  {
    id: "sys-cxr-pair",
    name: "Direkt Grafi (PA + Lateral 1×2)",
    description: "Akciğer direkt grafilerinde PA ve Yan grafileri 1×2 düzende yan yana açar.",
    isSystem: true,
    match: {
      modalities: ["CR", "DX", "RG"],
      bodyParts: ["CHEST", "THORAX", "TORAKS"],
    },
    layout: "1x2",
    cells: [
      { cellIndex: 0, seriesMatcher: { sequenceIndex: 0 } },
      { cellIndex: 1, seriesMatcher: { sequenceIndex: 1 } },
    ],
  },
  {
    id: "sys-pet-ct",
    name: "PET-CT / Nükleer Tıp (1×2 / 2×2 Füzyon)",
    description: "BT anatomik serisi ile Nükleer Tıp / PET metabolik serisini yan yana karşılaştırır.",
    isSystem: true,
    match: {
      modalities: ["PT", "NM", "ST"],
    },
    layout: "1x2",
    cells: [
      { cellIndex: 0, seriesMatcher: { sequenceIndex: 0 }, syncSlice: true },
      { cellIndex: 1, seriesMatcher: { sequenceIndex: 1 }, syncSlice: true },
    ],
  },
];

const LOCAL_STORAGE_KEY = "atik_user_hanging_protocols";
const LAYOUT_CELLS: Record<Layout, number> = { "1x1": 1, "1x2": 2, "2x1": 2, "2x2": 4, "1x3": 3, "3x1": 3, "2x3": 6, "3x2": 6 };

function validPattern(pattern: unknown): boolean {
  if (pattern === undefined || pattern === "") return true;
  if (typeof pattern !== "string" || pattern.length > 200) return false;
  try { new RegExp(pattern, "i"); return true; } catch { return false; }
}

/** Eski/bozuk localStorage ve doğrulanmamış JSON hiçbir zaman render hatasına dönüşmesin. */
export function isHangingProtocol(value: unknown): value is HangingProtocolRule {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id || typeof value.name !== "string" || !value.name.trim()) return false;
  if (typeof value.description !== "string" || typeof value.layout !== "string" || !(value.layout in LAYOUT_CELLS)) return false;
  if (!isRecord(value.match) || !Array.isArray(value.cells) || value.cells.length === 0 || value.cells.length > 6) return false;
  const match = value.match;
  for (const k of ["modalities", "bodyParts"] as const) {
    if (match[k] !== undefined && (!Array.isArray(match[k]) || !(match[k] as unknown[]).every((s) => typeof s === "string"))) return false;
  }
  if (!validPattern(match.seriesDescriptionRegex) || !validPattern(match.protocolNameRegex)) return false;
  if (match.minSeriesCount !== undefined && (typeof match.minSeriesCount !== "number" || !Number.isInteger(match.minSeriesCount) || match.minSeriesCount < 1)) return false;
  const indices = new Set<number>();
  for (const cell of value.cells) {
    if (!isRecord(cell) || typeof cell.cellIndex !== "number" || !Number.isInteger(cell.cellIndex) || cell.cellIndex < 0 || cell.cellIndex >= LAYOUT_CELLS[value.layout as Layout] || indices.has(cell.cellIndex)) return false;
    indices.add(cell.cellIndex);
    if (cell.windowPreset !== undefined && typeof cell.windowPreset !== "string") return false;
    if (cell.customWL !== undefined && (!isRecord(cell.customWL) || typeof cell.customWL.wl !== "number" || !Number.isFinite(cell.customWL.wl) || typeof cell.customWL.ww !== "number" || !Number.isFinite(cell.customWL.ww) || cell.customWL.ww <= 0)) return false;
    if (cell.seriesMatcher !== undefined) {
      if (!isRecord(cell.seriesMatcher)) return false;
      const m = cell.seriesMatcher;
      if (!validPattern(m.descriptionRegex) || !validPattern(m.protocolNameRegex)) return false;
      if (m.modality !== undefined && typeof m.modality !== "string") return false;
      if (m.sequenceIndex !== undefined && (typeof m.sequenceIndex !== "number" || !Number.isInteger(m.sequenceIndex) || m.sequenceIndex < 0)) return false;
    }
  }
  return indices.has(0);
}

export function loadUserProtocols(): HangingProtocolRule[] {
  const value = readPreference(LOCAL_STORAGE_KEY);
  return Array.isArray(value) ? value.filter(isHangingProtocol).slice(0, 100).map((r) => ({ ...r, isSystem: false })) : [];
}

/** Kalıcı depolama engellense de bu sekmede kullanılabilir. */
export function saveUserProtocols(protocols: HangingProtocolRule[]): boolean {
  return writePreference(LOCAL_STORAGE_KEY, protocols.filter(isHangingProtocol));
}

export function getAllProtocols(): HangingProtocolRule[] {
  // Kullanıcı kurallarının gerçekten devreye girebilmesi için özel kurallar önce gelir.
  return [...loadUserProtocols(), ...SYSTEM_HANGING_PROTOCOLS];
}

const imageSeries = (s: SeriesData) => !s.specialType || s.specialType === "image";
const protocolName = (s: SeriesData) => s.tags.find((t) => t.name === "Protocol Name")?.value ?? "";

function matches(pattern: string | undefined, text: string): boolean {
  if (!pattern) return true;
  try { return new RegExp(pattern, "i").test(text); } catch { return false; }
}

export function findMatchingHangingProtocol(series: SeriesData, allSeries: SeriesData[]): HangingProtocolRule | null {
  if (!imageSeries(series)) return null;
  const modality = series.modality.toUpperCase().trim();
  const description = series.description;
  const body = `${series.bodyPart} ${description}`.toUpperCase();
  const sameStudy = new Set(allSeries.filter((s) => s.studyUid === series.studyUid && imageSeries(s)).map((s) => s.id));
  sameStudy.add(series.id);
  for (const rule of getAllProtocols()) {
    const m = rule.match;
    if (m.modalities?.length && !m.modalities.some((x) => x.toUpperCase() === modality)) continue;
    if (m.bodyParts?.length && !m.bodyParts.some((bp) => body.includes(bp.toUpperCase()))) continue;
    if (!matches(m.seriesDescriptionRegex, description) || !matches(m.protocolNameRegex, protocolName(series))) continue;
    if (m.minSeriesCount && sameStudy.size < m.minSeriesCount) continue;
    return rule;
  }
  return null;
}

/** Hücre eşleştirmesi başka hastanın serisine yanlışlıkla geçmesin; sıra #1 geçerli seridir. */
export function resolveHangingCellSeries(
  cell: HangingProtocolRule["cells"][number], current: SeriesData, available: SeriesData[]
): SeriesData | null {
  const pool = Array.from(new Map([current, ...available].filter((s) => s.studyUid === current.studyUid && imageSeries(s)).map((s) => [s.id, s])).values());
  const m = cell.seriesMatcher;
  const candidates = pool.filter((s) => (!m?.modality || s.modality.toUpperCase() === m.modality.toUpperCase()) && matches(m?.descriptionRegex, s.description) && matches(m?.protocolNameRegex, protocolName(s)));
  return candidates[m?.sequenceIndex ?? 0] ?? null;
}

export function exportProtocolsJson(protocols: HangingProtocolRule[]): string {
  return JSON.stringify(protocols, null, 2);
}

export function importProtocolsJson(jsonStr: string): HangingProtocolRule[] {
  const parsed: unknown = JSON.parse(jsonStr);
  if (!Array.isArray(parsed)) throw new Error("Protokol listesi bir dizi (array) olmalıdır.");
  const normalized = parsed.map((p: unknown, i: number) => isRecord(p) ? { ...p, id: typeof p.id === "string" && p.id ? p.id : `custom-${Date.now()}-${i}`, isSystem: false } : p);
  if (!normalized.every(isHangingProtocol)) throw new Error("Protokol geçersiz: ad, eşleşme koşulu, düzen ve geçerli panel hücreleri zorunludur. Regex ve pencere değerlerini kontrol edin.");
  return normalized;
}
