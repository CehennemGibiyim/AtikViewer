"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { SeriesData } from "@/lib/types";
import {
  BLINK_DEFAULT_HZ,
  BLINK_MAX_HZ,
  BLINK_MIN_HZ,
  blinkSideAt,
  clampBlinkHz,
  diffGray,
  diffRgba,
  frameIndexFor,
  pairLabel,
  resample,
  toFloat,
  toGray,
  type CompareMode,
  type MammoPair,
} from "@/lib/mammoCompare";

interface Props {
  pair: MammoPair;
  /** Açık kesit indeksi (sol meme serisinin kare numarası). */
  slice: number;
  /** Pencere/seviye (gösterim değerleri). */
  wl: number;
  ww: number;
  invert?: boolean;
  onModeChange?: (mode: CompareMode) => void;
  onStatus?: (message: string) => void;
}

/** Bellek için karşılaştırma görüntüsü bu kenara kadar küçültülür (mm/cm ölçümü yapılmaz). */
const MAX_DIM = 1200;

function drawGray(canvas: HTMLCanvasElement | null, data: Uint8Array, w: number, h: number) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  canvas.width = w;
  canvas.height = h;
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    const o = i * 4;
    img.data[o] = v;
    img.data[o + 1] = v;
    img.data[o + 2] = v;
    img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

function drawRgba(canvas: HTMLCanvasElement | null, data: Uint8ClampedArray, w: number, h: number) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  canvas.width = w;
  canvas.height = h;
  ctx.putImageData(new ImageData(data, w, h), 0, 0);
}

/**
 * Mamografi sağ-sol karşılaştırma paneli.
 * Ayna: iki meme yan yana (sağ solda, radyoloji alışkanlığı) · Blink: tek pencerede
 * dönüşümlü yanıp sönme · Fark: kırmızı = sağ meme daha parlak, mavi = sol meme daha parlak.
 * Tanı aracı değildir; yalnızca görsel karşılaştırma sağlar.
 */
export default function MammoComparePanel({ pair, slice, wl, ww, invert, onModeChange, onStatus }: Props) {
  const [mode, setMode] = useState<CompareMode>("mirror");
  const [hz, setHz] = useState(BLINK_DEFAULT_HZ);
  const [gain, setGain] = useState(2);
  const [side, setSide] = useState<"right" | "left">("right");
  const mirrorRight = useRef<HTMLCanvasElement | null>(null);
  const mirrorLeft = useRef<HTMLCanvasElement | null>(null);
  const single = useRef<HTMLCanvasElement | null>(null);

  const frames = useMemo(() => {
    const rightSlices = pair.right.slices;
    const leftSlices = pair.left.slices;
    if (!rightSlices.length || !leftSlices.length) return null;
    const li = Math.max(0, Math.min(slice, leftSlices.length - 1));
    const ri = frameIndexFor(rightSlices.length, leftSlices.length, li);
    const rightFrame = rightSlices[ri];
    const leftFrame = leftSlices[li];
    if (!rightFrame || !leftFrame) return null;

    const w = Math.max(pair.left.width, 1);
    const h = Math.max(pair.left.height, 1);
    const scale = Math.min(1, MAX_DIM / Math.max(w, h));
    const dstW = Math.max(1, Math.round(w * scale));
    const dstH = Math.max(1, Math.round(h * scale));

    const leftPix = resample(toFloat(leftFrame), w, h, dstW, dstH);
    const rightPix = resample(
      toFloat(rightFrame),
      Math.max(pair.right.width, 1),
      Math.max(pair.right.height, 1),
      dstW,
      dstH,
    );
    const leftGray = toGray(leftPix, wl, ww, invert);
    const rightGray = toGray(rightPix, wl, ww, invert);

    return {
      width: dstW,
      height: dstH,
      leftFrameNo: li + 1,
      rightFrameNo: ri + 1,
      leftGray,
      rightGray,
      gray: diffGray(leftGray, rightGray, gain),
      rgba: diffRgba(rightGray, leftGray, gain),
    };
  }, [pair.right.slices, pair.left.slices, pair.left.width, pair.left.height, pair.right.width, pair.right.height, slice, wl, ww, invert, gain]);

  useEffect(() => {
    if (mode !== "blink") return;
    const started = performance.now();
    let last: "right" | "left" | null = null;
    let raf = 0;
    const tick = (now: number) => {
      const next = blinkSideAt(now - started, hz);
      if (next !== last) {
        last = next;
        setSide(next);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [mode, hz]);

  useEffect(() => {
    if (!frames) return;
    if (mode === "mirror") {
      drawGray(mirrorRight.current, frames.rightGray, frames.width, frames.height);
      drawGray(mirrorLeft.current, frames.leftGray, frames.width, frames.height);
    } else if (mode === "blink") {
      drawGray(single.current, side === "right" ? frames.rightGray : frames.leftGray, frames.width, frames.height);
    } else {
      drawRgba(single.current, frames.rgba, frames.width, frames.height);
    }
  }, [frames, mode, side]);

  function chooseMode(next: CompareMode) {
    setMode(next);
    onModeChange?.(next);
    onStatus?.(
      next === "mirror"
        ? "Sağ-sol ayna: iki meme yan yana, ortak pencere ve kesit."
        : next === "blink"
          ? "Blink: tek pencerede iki meme dönüşümlü gösteriliyor; Space ile duraklatın."
          : "Fark: kırmızı = sağ meme daha parlak, mavi = sol meme daha parlak.",
    );
  }

  if (!frames) {
    return (
      <div className="rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-[11.5px] text-amber-200">
        {pairLabel(pair)} için görüntü verisi yok.
      </div>
    );
  }

  const button = (value: CompareMode, text: string, hint: string) => (
    <button
      key={value}
      type="button"
      onClick={() => chooseMode(value)}
      title={hint}
      className={`rounded px-2 py-1 text-[11px] font-bold ${
        mode === value ? "bg-cyan-500/25 text-cyan-100" : "bg-slate-800/70 text-slate-300 hover:bg-slate-700/70"
      }`}
    >
      {text}
    </button>
  );

  return (
    <div className="rounded-lg border border-slate-700/70 bg-slate-900/60 p-2">
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-[11px] font-bold text-emerald-300">{pairLabel(pair)}</span>
        {button("mirror", "Ayna", "Sağ-sol yan yana")}
        {button("blink", "Blink", "Dönüşümlü yanıp sönme")}
        {button("diff", "Fark", "İşaretli piksel farkı")}
        {mode === "blink" && (
          <label className="ml-2 flex items-center gap-1 text-[10.5px] text-slate-400">
            {BLINK_MIN_HZ}–{BLINK_MAX_HZ} Hz
            <input
              type="range"
              min={BLINK_MIN_HZ}
              max={BLINK_MAX_HZ}
              step={0.5}
              value={hz}
              onChange={(e) => setHz(clampBlinkHz(Number(e.target.value)))}
              className="w-20"
            />
            <span className="w-8 font-mono text-slate-300">{hz.toFixed(1)}</span>
          </label>
        )}
        {mode === "diff" && (
          <label className="ml-2 flex items-center gap-1 text-[10.5px] text-slate-400">
            <input
              type="range"
              min={1}
              max={8}
              step={1}
              value={gain}
              onChange={(e) => setGain(Number(e.target.value))}
              className="w-20"
            />
            <span className="w-10 font-mono text-slate-300">×{gain}</span>
          </label>
        )}
      </div>

      {mode === "mirror" && (
        <div className="grid grid-cols-2 gap-2">
          <figure>
            <figcaption className="mb-1 text-[10.5px] font-bold text-slate-400">
              SAĞ MEME · {pair.view} · kare {frames.rightFrameNo}
            </figcaption>
            <canvas ref={mirrorRight} className="w-full rounded bg-black" />
          </figure>
          <figure>
            <figcaption className="mb-1 text-[10.5px] font-bold text-slate-400">
              SOL MEME · {pair.view} · kare {frames.leftFrameNo}
            </figcaption>
            <canvas ref={mirrorLeft} className="w-full rounded bg-black" />
          </figure>
        </div>
      )}

      {mode === "blink" && (
        <div>
          <div className="mb-1 text-[10.5px] font-bold text-slate-400">
            {side === "right" ? "SAĞ MEME" : "SOL MEME"} · {pair.view} · kare{" "}
            {side === "right" ? frames.rightFrameNo : frames.leftFrameNo}
          </div>
          <canvas ref={single} className="w-full rounded bg-black" />
        </div>
      )}

      {mode === "diff" && (
        <div>
          <div className="mb-1 flex items-center gap-3 text-[10.5px] text-slate-400">
            <span className="font-bold">FARK · {pair.view}</span>
            <span className="text-red-300">■ sağ daha parlak</span>
            <span className="text-blue-300">■ sol daha parlak</span>
          </div>
          <canvas ref={single} className="w-full rounded bg-black" />
        </div>
      )}

      <div className="mt-1.5 text-[10px] leading-relaxed text-slate-500">
        Yalnızca görsel karşılaştırma; tanı aracı değildir. Fark görüntüsünde pozisyon, kompresyon ve
        meme boyutu farkları da görünür — asimetri ile karıştırmayın.
      </div>
    </div>
  );
}
