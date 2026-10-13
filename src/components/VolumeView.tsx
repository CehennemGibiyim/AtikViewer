"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { SeriesData } from "@/lib/types";
import ObliquePanel from "./ObliquePanel";
import VolumeRender from "./VolumeRender";

type Mode = "single" | "avg" | "mip" | "minip";

/** Slab toplulaştırmalı düzlem üretimi (radyolojik yönelim: baş yukarıda, ön solda). */
function axialPlane(s: SeriesData, z: number, k: number, mode: Mode): Float32Array {
  const n = s.width * s.height;
  const out = new Float32Array(n);
  const z0 = Math.max(0, z - k), z1 = Math.min(s.slices.length - 1, z + k);
  if (mode === "single" || z0 === z1) { const sl = s.slices[z]; for (let i = 0; i < n; i++) out[i] = sl[i]; return out; }
  for (let i = 0; i < n; i++) {
    let acc = mode === "mip" ? -Infinity : mode === "minip" ? Infinity : 0;
    for (let zz = z0; zz <= z1; zz++) {
      const v = s.slices[zz][i];
      acc = mode === "mip" ? Math.max(acc, v) : mode === "minip" ? Math.min(acc, v) : acc + v;
    }
    out[i] = mode === "avg" ? acc / (z1 - z0 + 1) : acc;
  }
  return out;
}

function coronalPlane(s: SeriesData, y: number, k: number, mode: Mode): Float32Array {
  const N = s.slices.length, W = s.width;
  const out = new Float32Array(W * N);
  const y0 = Math.max(0, y - k), y1 = Math.min(s.height - 1, y + k);
  const cnt = y1 - y0 + 1;
  for (let r = 0; r < N; r++) {
    const sl = s.slices[N - 1 - r];
    const o = r * W;
    if (mode === "single" || cnt === 1) { const b = y * W; for (let x = 0; x < W; x++) out[o + x] = sl[b + x]; continue; }
    // ayırımsız (allocation-free) toplulaştırma: kalın kesit MPR'de ~2-3x hızlı
    for (let x = 0; x < W; x++) {
      let acc = mode === "mip" ? -Infinity : mode === "minip" ? Infinity : 0;
      for (let yy = y0; yy <= y1; yy++) {
        const v = sl[yy * W + x];
        if (mode === "mip") { if (v > acc) acc = v; } else if (mode === "minip") { if (v < acc) acc = v; } else acc += v;
      }
      out[o + x] = mode === "avg" ? acc / cnt : acc;
    }
  }
  return out;
}

function sagittalPlane(s: SeriesData, x: number, k: number, mode: Mode): Float32Array {
  const N = s.slices.length, W = s.width, H = s.height;
  const out = new Float32Array(H * N);
  const x0 = Math.max(0, x - k), x1 = Math.min(W - 1, x + k);
  const cnt = x1 - x0 + 1;
  for (let r = 0; r < N; r++) {
    const sl = s.slices[N - 1 - r];
    const o = r * H;
    for (let yy = 0; yy < H; yy++) {
      const b = yy * W;
      if (mode === "single" || cnt === 1) { out[o + yy] = sl[b + x]; continue; }
      let acc = mode === "mip" ? -Infinity : mode === "minip" ? Infinity : 0;
      for (let xx = x0; xx <= x1; xx++) {
        const v = sl[b + xx];
        if (mode === "mip") { if (v > acc) acc = v; } else if (mode === "minip") { if (v < acc) acc = v; } else acc += v;
      }
      out[o + yy] = mode === "avg" ? acc / cnt : acc;
    }
  }
  return out;
}

interface PlaneProps {
  title: string;
  w: number;
  rows: number;
  rowScale: number;
  data: Float32Array;
  wl: number;
  ww: number;
  invert: boolean;
  cross: { x: number; y: number };
  color: string;
  onPick: (ix: number, iy: number) => void;
  onWheel: (dir: number) => void;
}

function Plane({ title, w, rows, rowScale, data, wl, ww, invert, cross, color, onPick, onWheel }: PlaneProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 300, h: 300 });
  const down = useRef(false);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const geo = () => {
    const s = Math.min(size.w / w, size.h / (rows * rowScale)) * 0.96;
    return { s, ox: (size.w - w * s) / 2, oy: (size.h - rows * rowScale * s) / 2 };
  };

  useEffect(() => {
    const c = cv.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = size.w * dpr;
    c.height = size.h * dpr;
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#05070a";
    ctx.fillRect(0, 0, size.w, size.h);
    const off = document.createElement("canvas");
    off.width = w; off.height = rows;
    const octx = off.getContext("2d")!;
    const img = octx.createImageData(w, rows);
    const u32 = new Uint32Array(img.data.buffer);
    const lo = wl - ww / 2, k = 255 / Math.max(1, ww);
    for (let i = 0; i < data.length; i++) {
      let g = (data[i] - lo) * k;
      g = g < 0 ? 0 : g > 255 ? 255 : g;
      if (invert) g = 255 - g;
      const gi = g | 0;
      u32[i] = 0xff000000 | (gi << 16) | (gi << 8) | gi;
    }
    octx.putImageData(img, 0, 0);
    const { s, ox, oy } = geo();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(off, ox, oy, w * s, rows * rowScale * s);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(ox + cross.x * s, oy); ctx.lineTo(ox + cross.x * s, oy + rows * rowScale * s);
    ctx.moveTo(ox, oy + cross.y * rowScale * s); ctx.lineTo(ox + w * s, oy + cross.y * rowScale * s);
    ctx.stroke();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, wl, ww, invert, cross.x, cross.y, size, w, rows, rowScale, color]);

  const pick = (e: React.PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const { s, ox, oy } = geo();
    const ix = (e.clientX - r.left - ox) / s;
    const iy = (e.clientY - r.top - oy) / (s * rowScale);
    if (ix >= 0 && iy >= 0 && ix < w && iy < rows) onPick(Math.floor(ix), Math.floor(iy));
  };

  return (
    <div className="relative flex min-h-0 flex-col border border-[#1a2230] bg-black">
      <div className="absolute left-2 top-1 z-10 font-mono text-[10px] font-bold" style={{ color }}>{title}</div>
      <div ref={wrap} className="min-h-0 flex-1">
        <canvas
          ref={cv}
          style={{ width: size.w, height: size.h, cursor: "crosshair" }}
          onPointerDown={(e) => { down.current = true; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); pick(e); }}
          onPointerMove={(e) => down.current && pick(e)}
          onPointerUp={() => (down.current = false)}
          onWheel={(e) => onWheel(e.deltaY > 0 ? 1 : -1)}
        />
      </div>
    </div>
  );
}

interface Props {
  series: SeriesData;
  wl: number;
  ww: number;
  invert: boolean;
  onClose: () => void;
}

export default function VolumeView({ series, wl: wl0, ww: ww0, invert, onClose }: Props) {
  const N = series.slices.length;
  const W = series.width;
  const H = series.height;
  const spacing = series.sliceSpacing || series.sliceThickness || 1;
  const ratio = spacing / (series.pixelSpacing || 1);
  const [cur, setCur] = useState({ x: Math.floor(W / 2), y: Math.floor(H / 2), z: Math.floor(N / 2) });
  const [slab, setSlab] = useState(0);
  const [mode, setMode] = useState<Mode>("single");
  const [wl, setWl] = useState(wl0);
  const [ww, setWw] = useState(ww0);
  const [tab, setTab] = useState<"not" | "oblik" | "3b">("not");
  const [big, setBig] = useState(false);

  const m: Mode = slab === 0 ? "single" : mode === "single" ? "avg" : mode;
  const kz = Math.round(slab / 2 / spacing);
  const kxy = Math.round(slab / 2 / (series.pixelSpacing || 1));
  const ax = useMemo(() => axialPlane(series, cur.z, kz, m), [series, cur.z, kz, m]);
  const co = useMemo(() => coronalPlane(series, cur.y, kxy, m), [series, cur.y, kxy, m]);
  const sa = useMemo(() => sagittalPlane(series, cur.x, kxy, m), [series, cur.x, kxy, m]);
  const clamp = (v: number, max: number) => Math.max(0, Math.min(max - 1, v));
  const val = series.slices[cur.z]?.[cur.y * W + cur.x];
  const zMm = series.slicePositions ? series.slicePositions[cur.z] : cur.z * spacing;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#05070a]">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-[#1a2230] bg-[#0b0f16] px-3 py-2 text-xs">
        <span className="font-mono font-black tracking-widest text-cyan-300">MPR · {series.description}</span>
        <span className="font-mono text-slate-400">x {cur.x} · y {cur.y} · kesit {cur.z + 1}/{N} · z {zMm.toFixed(1)} mm · değer {val !== undefined ? val.toFixed(0) : "—"} {series.unit}</span>
        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-1 text-slate-300">Kalın kesit
            <input type="range" min={0} max={40} step={1} value={slab} onChange={(e) => setSlab(Number(e.target.value))} className="w-28" />
            <span className="w-12 font-mono text-cyan-300">{slab} mm</span>
          </label>
          {(["avg", "mip", "minip"] as const).map((k) => (
            <button key={k} disabled={slab === 0} onClick={() => setMode(k)} className={`rounded px-2 py-1 font-bold disabled:opacity-40 ${m === k && slab > 0 ? "bg-cyan-400/20 text-cyan-200 ring-1 ring-cyan-400/50" : "text-slate-300 hover:bg-[#161e2b]"}`}>
              {k === "avg" ? "Ort." : k === "mip" ? "MIP" : "MinIP"}
            </button>
          ))}
          <label className="flex items-center gap-1 text-slate-300">WL
            <input type="number" value={Math.round(wl)} onChange={(e) => setWl(Number(e.target.value))} className="w-16 rounded border border-[#1e2735] bg-[#0e141d] px-1 py-0.5 text-slate-100" />
          </label>
          <label className="flex items-center gap-1 text-slate-300">WW
            <input type="number" value={Math.round(ww)} onChange={(e) => setWw(Math.max(1, Number(e.target.value)))} className="w-16 rounded border border-[#1e2735] bg-[#0e141d] px-1 py-0.5 text-slate-100" />
          </label>
          <button onClick={onClose} className="rounded border border-[#2d3b4e] bg-[#141b24] px-3 py-1 font-bold text-slate-200 hover:bg-[#1f2937]">✕ Kapat</button>
        </div>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-2 gap-1 p-1">
        {!big && <>
        <Plane title="AKSİYEL" w={W} rows={H} rowScale={1} data={ax} wl={wl} ww={ww} invert={invert} color="#22d3ee"
          cross={{ x: cur.x + 0.5, y: cur.y + 0.5 }}
          onPick={(ix, iy) => setCur((c) => ({ ...c, x: clamp(ix, W), y: clamp(iy, H) }))}
          onWheel={(d) => setCur((c) => ({ ...c, z: clamp(c.z + d, N) }))} />
        <Plane title="KORONAL" w={W} rows={N} rowScale={ratio} data={co} wl={wl} ww={ww} invert={invert} color="#fbbf24"
          cross={{ x: cur.x + 0.5, y: N - 1 - cur.z + 0.5 }}
          onPick={(ix, iy) => setCur((c) => ({ ...c, x: clamp(ix, W), z: clamp(N - 1 - iy, N) }))}
          onWheel={(d) => setCur((c) => ({ ...c, y: clamp(c.y + d, H) }))} />
        <Plane title="SAGİTAL" w={H} rows={N} rowScale={ratio} data={sa} wl={wl} ww={ww} invert={invert} color="#f472b6"
          cross={{ x: cur.y + 0.5, y: N - 1 - cur.z + 0.5 }}
          onPick={(ix, iy) => setCur((c) => ({ ...c, y: clamp(ix, H), z: clamp(N - 1 - iy, N) }))}
          onWheel={(d) => setCur((c) => ({ ...c, x: clamp(c.x + d, W) }))} />
        </>}
        <div className={`flex min-h-0 flex-col overflow-hidden border border-[#1a2230] bg-[#0b0f16] ${big ? "col-span-2 row-span-2" : ""}`}>
          <div className="flex shrink-0 items-center gap-1 border-b border-[#1a2230] px-2 py-1 text-[11px]">
            {([["not", "Notlar"], ["oblik", "Oblik MPR"], ["3b", "3B hacim"]] as const).map(([k, l]) => (
              <button key={k} onClick={() => setTab(k)} className={`cursor-pointer rounded px-2 py-0.5 font-bold ${tab === k ? "bg-cyan-400/20 text-cyan-200 ring-1 ring-cyan-400/50" : "bg-[#141b24] text-slate-300 hover:bg-[#1f2937]"}`}>{l}</button>
            ))}
            <button onClick={() => setBig((b) => !b)} className="ml-auto cursor-pointer rounded bg-[#141b24] px-2 py-0.5 font-bold text-slate-300 hover:bg-[#1f2937]">{big ? "▣ Küçült" : "⛶ Büyüt"}</button>
          </div>
          <div className="min-h-0 flex-1">
          {tab === "oblik" && <ObliquePanel series={series} center={cur} wl={wl} ww={ww} invert={invert} />}
          {tab === "3b" && <VolumeRender series={series} />}
          {tab === "not" && <div className="h-full overflow-auto p-3 text-[11px] leading-relaxed text-slate-300">
          <div className="mb-1 text-xs font-bold text-slate-100">MPR notları</div>
          <ul className="list-disc space-y-1 pl-4">
            <li>Bir düzleme tıklayın/sürükleyin: diğer düzlemlerde <b>çapraz referans çizgileri</b> aynı noktayı gösterir.</li>
            <li>Tekerlek: tıklanan düzlemin normali boyunca gezinir.</li>
            <li>Kalın kesit: ortalama / MIP (en parlak) / MinIP (en koyu) projeksiyonu.</li>
            <li>Kesit aralığı <b>{spacing.toFixed(2)} mm</b>, piksel <b>{(series.pixelSpacing || 1).toFixed(2)} mm</b> (dikey ölçek {ratio.toFixed(2)}×).</li>
            <li><b>Oblik MPR</b> ve <b>3B hacim</b> (VR/MIP, STL) sekmelerinden eğimli düzlem ve hacim görüntüleme kullanılır.</li>
            <li className="text-amber-300">Koronal/sagittal yönelim, kesitlerin kafa yönüne artan sıralandığı varsayımına dayanır.</li>
            {N < 12 && <li className="text-amber-300">Kesit sayısı az ({N}); yeniden kesit görüntüleri kaba görünebilir.</li>}
          </ul>
        </div>}
          </div>
        </div>
      </div>
    </div>
  );
}
