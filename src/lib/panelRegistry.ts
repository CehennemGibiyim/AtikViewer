import { useSyncExternalStore } from "react";
import type { SeriesData } from "./types";
import { intersectLine, planeOf, sameFrame } from "./planes";

/** Ekrandaki görüntü panellerinin (ana + referans) hangi seri/kesiti gösterdiği; çapraz referans çizgileri için. */
export interface PanelInfo { id: string; series: SeriesData | null; slice: number; label: string }

const panels = new Map<string, PanelInfo>();
let version = 0;
let refLinesOn = true;
const listeners = new Set<() => void>();
const bump = () => { version++; listeners.forEach((l) => l()); };

export function registerPanel(info: PanelInfo) {
  const old = panels.get(info.id);
  if (old && old.series === info.series && old.slice === info.slice && old.label === info.label) return;
  panels.set(info.id, info);
  bump();
}
export function unregisterPanel(id: string) { if (panels.delete(id)) bump(); }
export function setRefLines(on: boolean) { if (refLinesOn !== on) { refLinesOn = on; bump(); } }
export const getRefLines = () => refLinesOn;
export function usePanelRegistry() {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => version, () => 0);
}

export interface RefLine { a: { x: number; y: number }; b: { x: number; y: number }; label: string; color: string }
const COLORS = ["#22d3ee", "#fbbf24", "#f472b6", "#a3e635", "#fb923c"];

/** `self` panelinin kesitine, DİĞER panellerin kesit düzlemlerinin kesişim doğruları. */
export function refLinesFor(selfId: string, series: SeriesData | null, slice: number): RefLine[] {
  if (!refLinesOn || !series) return [];
  const t = planeOf(series, slice);
  if (!t) return [];
  const out: RefLine[] = [];
  let ci = 0;
  for (const p of panels.values()) {
    if (p.id === selfId || !p.series || p.series.id === series.id && p.slice === slice) continue;
    const color = COLORS[ci++ % COLORS.length];
    if (!sameFrame(series, p.series)) continue;
    const o = planeOf(p.series, Math.min(p.slice, p.series.slices.length - 1));
    if (!o) continue;
    const l = intersectLine(t, o);
    if (l) out.push({ ...l, label: p.label, color });
  }
  return out;
}
