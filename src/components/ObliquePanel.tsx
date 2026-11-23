"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { SeriesData } from "@/lib/types";
import { obliquePlane, type SlabMode } from "@/lib/volume";

interface Props { series: SeriesData; center: { x: number; y: number; z: number }; wl: number; ww: number; invert: boolean }

/** Eğimli (oblik) MPR: merkez, MPR çapraz imlecidir; üç eksen etrafında döndürülür. */
export default function ObliquePanel({ series, center, wl, ww, invert }: Props) {
  const [rot, setRot] = useState({ x: 25, y: 0, z: 0 });
  const [slab, setSlab] = useState(0);
  const [mode, setMode] = useState<SlabMode>("avg");
  const rotD = useDeferredValue(rot), slabD = useDeferredValue(slab), cD = useDeferredValue(center);
  const img = useMemo(() => obliquePlane(series, { cx: cD.x, cy: cD.y, cz: cD.z, rotX: rotD.x, rotY: rotD.y, rotZ: rotD.z, size: 320, slabMm: slabD, mode: slabD > 0 ? mode : "single" }), [series, cD, rotD, slabD, mode]);
  const cv = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = cv.current; if (!c) return;
    c.width = img.w; c.height = img.h;
    const ctx = c.getContext("2d")!;
    const id = ctx.createImageData(img.w, img.h);
    const u32 = new Uint32Array(id.data.buffer);
    const lo = wl - ww / 2, k = 255 / Math.max(1, ww);
    for (let i = 0; i < img.data.length; i++) {
      const v = img.data[i];
      if (v < -3e38) { u32[i] = 0xff000000; continue; }
      let g = (v - lo) * k; g = g < 0 ? 0 : g > 255 ? 255 : g; if (invert) g = 255 - g;
      const gi = g | 0; u32[i] = 0xff000000 | (gi << 16) | (gi << 8) | gi;
    }
    ctx.putImageData(id, 0, 0);
  }, [img, wl, ww, invert]);

  const slider = (label: string, key: "x" | "y" | "z", min: number, max: number) => (
    <label className="flex items-center gap-2">{label}
      <input aria-label={label} type="range" min={min} max={max} value={rot[key]} onChange={(e) => setRot((r) => ({ ...r, [key]: Number(e.target.value) }))} className="w-32" />
      <span className="w-10 font-mono text-cyan-300">{rot[key]}°</span>
    </label>
  );
  return (
    <div className="flex h-full min-h-0 flex-col text-[11px] text-slate-300">
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-[#1a2230] bg-[#0b0f16] px-2 py-1">
        {slider("Eğim X", "x", -90, 90)}{slider("Eğim Y", "y", -90, 90)}{slider("Dönüş Z", "z", -180, 180)}
        <label className="flex items-center gap-2">Kalın kesit
          <input aria-label="Oblik kalın kesit" type="range" min={0} max={40} value={slab} onChange={(e) => setSlab(Number(e.target.value))} className="w-24" />
          <span className="w-12 font-mono text-cyan-300">{slab} mm</span>
        </label>
        {(["avg", "mip", "minip"] as const).map((k) => <button key={k} disabled={slab === 0} onClick={() => setMode(k)} className={`rounded px-2 py-0.5 font-bold disabled:opacity-40 ${mode === k && slab > 0 ? "bg-cyan-400/20 text-cyan-200" : "bg-[#141b24]"}`}>{k === "avg" ? "Ort." : k === "mip" ? "MIP" : "MinIP"}</button>)}
        <button onClick={() => setRot({ x: 0, y: 0, z: 0 })} className="rounded bg-[#141b24] px-2 py-0.5 font-bold hover:bg-[#1f2937]">Sıfırla</button>
      </div>
      <div className="relative min-h-0 flex-1 bg-black">
        <canvas ref={cv} data-testid="oblique-canvas" className="mx-auto h-full max-h-full w-auto max-w-full object-contain" style={{ aspectRatio: "1 / 1" }} />
        <div className="pointer-events-none absolute bottom-1 left-2 text-[10px] text-slate-500">Merkez: MPR imleci (x {center.x}, y {center.y}, kesit {center.z + 1}) · piksel {img.stepMm.toFixed(2)} mm</div>
      </div>
    </div>
  );
}
