"use client";

import { useEffect, useState } from "react";
import Viewport from "./Viewport";
import ViewerErrorBoundary from "./ViewerErrorBoundary";
import { mapSliceByPosition } from "@/lib/geometry";
import { parallelSeries } from "@/lib/planes";
import type { SeriesData, ToolName } from "@/lib/types";

interface Props {
  allSeries: SeriesData[];
  seriesId: string | null;
  onSeriesChange: (id: string | null) => void;
  primary: SeriesData | null;
  primarySlice: number;
  syncSlice: boolean;
  windowOverride?: { wl: number; ww: number };
  tool: ToolName;
  invert: boolean;
  rotation: 0 | 90 | 180 | 270;
  flipH: boolean;
  flipV: boolean;
  onPrimarySlice: (i: number) => void;
  label: string;
  panelId?: string;
}

export default function RefPanel(p: Props) {
  const images = p.allSeries.filter((s) => (!s.specialType || s.specialType === "image") && s.slices.length > 0);
  const series = images.find((s) => s.id === p.seriesId) ?? null;
  const [local, setLocal] = useState(0);
  const [wl, setWl] = useState(0);
  const [ww, setWw] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (!series) return;
    setWl(p.windowOverride?.wl ?? series.defaultWL);
    setWw(p.windowOverride?.ww ?? series.defaultWW);
    setLocal(Math.floor(series.slices.length / 2));
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [series, p.windowOverride?.wl, p.windowOverride?.ww]);

  const synced = p.syncSlice && !!p.primary && !!series && parallelSeries(p.primary, series);
  const mapped = series && synced ? mapSliceByPosition(p.primary!, p.primarySlice, series) : local;
  const slice = series ? Math.max(0, Math.min(mapped, series.slices.length - 1)) : 0;
  const tool: ToolName = ["wl", "pan", "zoom"].includes(p.tool) ? p.tool : "wl";

  return (
    <div className="relative h-full w-full border border-[#1a2230]" data-testid="reference-panel">
      <ViewerErrorBoundary resetKey={series?.id ?? "empty"} label={p.label}>
        <Viewport
          series={series} slice={slice} wl={wl} ww={ww} invert={p.invert} zoom={zoom} pan={pan} tool={tool}
          rotation={p.rotation} flipH={p.flipH} flipV={p.flipV} pxMm={series?.pixelSpacing ?? 1} readOnly panelId={p.panelId}
          label={series ? `${p.label}${synced ? " · senkron" : ""} · Kesit ${slice + 1}/${series.slices.length}` : p.label}
          onSlice={(s) => {
            if (s === slice) return;
            if (synced) p.onPrimarySlice(p.primarySlice + (s > slice ? 1 : -1));
            else setLocal(s);
          }}
          onWL={(a, b) => { setWl(a); setWw(b); }} onZoom={setZoom} onPan={setPan}
        />
      </ViewerErrorBoundary>
      <select
        aria-label={`${p.label} serisi`}
        value={p.seriesId ?? ""}
        onChange={(e) => p.onSeriesChange(e.target.value || null)}
        className="absolute right-2 top-2 max-w-[60%] rounded border border-[#1e2735] bg-[#0e141d]/90 px-1.5 py-1 text-[10px] text-slate-200 focus:outline-none"
      >
        <option value="">— seri seçin —</option>
        {images.map((s) => <option key={s.id} value={s.id}>{s.modality} · {s.description} ({s.slices.length})</option>)}
      </select>
      {series && <div className="pointer-events-none absolute bottom-1 left-2 font-mono text-[10px] text-cyan-200/80">WL {Math.round(wl)} · WW {Math.round(ww)}</div>}
    </div>
  );
}
