"use client";

import { useState } from "react";
import type { SeriesData } from "@/lib/types";
import { CMAPS, type CmapName } from "@/lib/fusion";
import { sameFrame } from "@/lib/planes";

export interface FusionConfig { seriesId: string; alpha: number; cmap: CmapName; loPct: number; hiPct: number }

interface Props {
  all: SeriesData[];
  primary: SeriesData | null;
  cfg: FusionConfig | null;
  onChange: (c: FusionConfig | null) => void;
}

/** Füzyon (ör. PET → BT): ikinci seriyi hasta koordinatlarına göre ana serinin üzerine bindirir. */
export default function FusionControl({ all, primary, cfg, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const candidates = all.filter((s) => primary && s.id !== primary.id && (!s.specialType || s.specialType === "image") && !s.isColor && s.slices.length > 0 && !!s.ipp && !!s.orientation && sameFrame(primary, s));
  const active = !!cfg;
  const set = (patch: Partial<FusionConfig>) => cfg && onChange({ ...cfg, ...patch });
  const choose = (id: string) => {
    const s = all.find((x) => x.id === id);
    if (!s) { onChange(null); return; }
    onChange({ seriesId: id, alpha: 0.5, cmap: s.modality === "PT" || s.modality === "NM" ? "hot" : "rainbow", loPct: s.modality === "PT" ? 15 : 20, hiPct: s.modality === "PT" ? 80 : 100 });
  };
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        disabled={!primary}
        onClick={() => setOpen((o) => !o)}
        title={candidates.length ? "Füzyon: ikinci seriyi (ör. PET) hasta koordinatlarına göre bindir" : "Füzyon için aynı Frame of Reference'a ve konum bilgisine (IPP/IOP) sahip ikinci bir seri gerekir"}
        className={`cursor-pointer rounded-md border px-2 py-1 text-[11px] font-semibold ${active ? "border-amber-400/60 bg-amber-400/15 text-amber-200" : "border-[#2d3b4e] bg-[#111823] text-slate-300 hover:bg-[#1a2330]"}`}
      >
        Füzyon{active ? " ●" : ""}
      </button>
      {open && (
        <div className="absolute left-0 top-full z-40 mt-1 w-72 rounded-lg border border-[#2d3b4e] bg-[#0b0f16] p-3 text-[11px] text-slate-200 shadow-2xl">
          <div className="mb-2 font-bold text-amber-300">Füzyon (bindirme)</div>
          {candidates.length === 0 ? (
            <p className="leading-relaxed text-slate-400">Bu seriyle aynı Frame of Reference&apos;ı paylaşan ve konum etiketleri (ImagePositionPatient / ImageOrientationPatient) olan başka bir seri açık değil. PET-BT için iki seriyi birlikte yükleyin.</p>
          ) : (
            <div className="space-y-2">
              <select aria-label="Füzyon serisi" value={cfg?.seriesId ?? ""} onChange={(e) => choose(e.target.value)} className="w-full rounded border border-[#1e2735] bg-[#0e141d] px-2 py-1">
                <option value="">Kapalı</option>
                {candidates.map((s) => <option key={s.id} value={s.id}>{s.modality} · {s.description} ({s.slices.length})</option>)}
              </select>
              {cfg && (
                <>
                  <label className="flex items-center justify-between gap-2">Opaklık
                    <input type="range" min={10} max={100} value={Math.round(cfg.alpha * 100)} onChange={(e) => set({ alpha: Number(e.target.value) / 100 })} className="w-36" />
                  </label>
                  <label className="flex items-center justify-between gap-2">Alt eşik %{cfg.loPct}
                    <input type="range" min={0} max={90} value={cfg.loPct} onChange={(e) => set({ loPct: Math.min(Number(e.target.value), cfg.hiPct - 5) })} className="w-36" />
                  </label>
                  <label className="flex items-center justify-between gap-2">Üst sınır %{cfg.hiPct}
                    <input type="range" min={10} max={100} value={cfg.hiPct} onChange={(e) => set({ hiPct: Math.max(Number(e.target.value), cfg.loPct + 5) })} className="w-36" />
                  </label>
                  <label className="flex items-center justify-between gap-2">Renk
                    <select value={cfg.cmap} onChange={(e) => set({ cmap: e.target.value as CmapName })} className="w-36 rounded border border-[#1e2735] bg-[#0e141d] px-1 py-0.5">
                      {(Object.keys(CMAPS) as CmapName[]).map((k) => <option key={k} value={k}>{CMAPS[k]}</option>)}
                    </select>
                  </label>
                  <p className="text-[10px] leading-relaxed text-slate-500">Eşikler, bindirilen serinin maksimumunun (%99,99) yüzdesidir. Kayıt (registrasyon) yapılmaz; yalnızca DICOM koordinatlarına dayanır. Hareket/solunum kaymaları görünebilir.</p>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
