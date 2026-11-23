"use client";

import { useState } from "react";
import type { ImageReview } from "@/lib/types";

interface Props {
  review: ImageReview;
  currentSlice: number;
  unit: string;
  onGotoSlice: (slice: number) => void;
}

const PAGE_SIZE = 24;

export default function ReviewMetrics({ review, currentSlice, unit, onGotoSlice }: Props) {
  const [page, setPage] = useState(0);
  const color = review.mode === "color";
  const frameLabel = ["US", "XA", "RF", "XC"].includes(review.modality.toUpperCase()) ? "Kare" : "Kesit";
  const pages = Math.max(1, Math.ceil(review.frames.length / PAGE_SIZE));
  const validPage = Math.min(page, pages - 1);
  const visible = review.frames.slice(validPage * PAGE_SIZE, (validPage + 1) * PAGE_SIZE);
  const keys = new Set(review.keyFrames);
  const peak = Math.max(1, ...review.frames.map((f) => color ? Math.max(f.redCoverage ?? 0, f.blueCoverage ?? 0) : f.changeFromPrevious));

  return (
    <section aria-label="Kesit bazlı görüntü ölçümleri" className="rounded-xl border border-[#1e2735] bg-[#0e141d] p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-bold uppercase tracking-widest text-cyan-300">{frameLabel} bazlı gerçek piksel ölçümü</h3>
        <span className="font-mono text-[10px] text-slate-400">{review.frameCount} {frameLabel.toLowerCase()}</span>
      </div>
      <p className="mt-1 text-[10.5px] leading-relaxed text-slate-400">
        {color
          ? "Kırmızı ve mavi çubuklar yalnızca görüntüdeki RGB piksel oranıdır; Doppler hızı, akım yönü veya hastalık göstergesi DEĞİLDİR."
          : "Parlaklık/kontrast değişimi yalnızca kareler arası istatistiktir; lezyon tespiti veya normal tetkik sonucu DEĞİLDİR."}
      </p>

      {/* Overview chart: responsive bars; acts as a frame navigator */}
      <div className="mt-2 flex h-14 items-end gap-[2px] overflow-x-auto rounded border border-[#1c2835] bg-[#080c12] px-1 pb-1 pt-2" aria-label="Kare değişimi çizelgesi">
        {review.frames.map((f) => {
          const a = color ? f.redCoverage ?? 0 : f.changeFromPrevious;
          const b = color ? f.blueCoverage ?? 0 : 0;
          const active = currentSlice === f.sliceIndex;
          return (
            <button
              type="button" key={f.sliceIndex}
              onClick={() => { onGotoSlice(f.sliceIndex); setPage(Math.floor(f.sliceIndex / PAGE_SIZE)); }}
              title={`${frameLabel} ${f.sliceIndex + 1}: ${color ? `kırmızı %${a}, mavi %${b}` : `istatistiksel değişim %${a}`}`}
              aria-label={`${frameLabel} ${f.sliceIndex + 1} görüntüsüne git`}
              className={`relative flex h-10 shrink-0 cursor-pointer items-end justify-center gap-px rounded-sm border-b-2 ${active ? "border-cyan-300 bg-cyan-400/10" : "border-transparent hover:bg-slate-700/30"}`}
              style={{ width: review.frames.length > 100 ? 6 : review.frames.length > 30 ? 9 : Math.max(12, Math.floor(278 / review.frames.length)) }}
            >
              <span className={color ? "w-1 rounded-t bg-rose-400" : "w-1.5 rounded-t bg-emerald-400"} style={{ height: `${Math.max(2, Math.round((a / peak) * 34))}px` }} />
              {color && <span className="w-1 rounded-t bg-blue-400" style={{ height: `${Math.max(2, Math.round((b / peak) * 34))}px` }} />}
              {keys.has(f.sliceIndex) && <span className="absolute -top-1 h-1 w-1 rounded-full bg-amber-300" />}
            </button>
          );
        })}
      </div>
      <div className="mt-1 flex items-center justify-between font-mono text-[9px] text-slate-500">
        <span>1</span><span className="text-amber-300">● temsilî inceleme kareleri</span><span>{review.frameCount}</span>
      </div>

      <div className="mt-2 max-h-64 overflow-y-auto rounded border border-[#1c2835] bg-[#080c12]">
        <table className="w-full border-collapse font-mono text-[10px]">
          <thead className="sticky top-0 bg-[#0b1018] text-slate-400">
            <tr>
              <th className="px-2 py-1.5 text-left">{frameLabel}</th>
              {color ? <><th className="px-1 text-right text-rose-300">Kırmızı</th><th className="px-1 text-right text-blue-300">Mavi</th></>
                : <><th className="px-1 text-right">Ort. ({unit})</th><th className="px-1 text-right">Kontrast</th></>}
              <th className="px-2 text-right">Fark*</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((f) => (
              <tr key={f.sliceIndex} className={`border-t border-[#151d29] ${currentSlice === f.sliceIndex ? "bg-cyan-400/12" : "hover:bg-slate-700/15"}`}>
                <td className="px-2 py-1">
                  <button type="button" onClick={() => onGotoSlice(f.sliceIndex)} className={`cursor-pointer font-bold hover:underline ${currentSlice === f.sliceIndex ? "text-cyan-200" : "text-slate-200"}`}>{keys.has(f.sliceIndex) ? "★ " : ""}{f.sliceIndex + 1}</button>
                </td>
                {color
                  ? <><td className="px-1 text-right text-rose-300">%{f.redCoverage ?? 0}</td><td className="px-1 text-right text-blue-300">%{f.blueCoverage ?? 0}</td></>
                  : <><td className="px-1 text-right text-slate-300">{f.mean}</td><td className="px-1 text-right text-slate-300">{f.contrast}</td></>}
                <td className="px-2 text-right text-slate-400">%{f.changeFromPrevious}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="mt-2 flex items-center justify-between text-[10px] text-slate-400">
          <button type="button" disabled={validPage === 0} onClick={() => setPage(validPage - 1)} className="rounded border border-[#273448] px-2 py-1 disabled:opacity-40">‹ Önceki</button>
          <span>{validPage + 1}/{pages} · {(visible[0]?.sliceIndex ?? 0) + 1}–{(visible.at(-1)?.sliceIndex ?? 0) + 1}</span>
          <button type="button" disabled={validPage === pages - 1} onClick={() => setPage(validPage + 1)} className="rounded border border-[#273448] px-2 py-1 disabled:opacity-40">Sonraki ›</button>
        </div>
      )}
      <p className="mt-1 text-[9.5px] text-slate-500">* Önceki kareye göre görüntü istatistik farkı; klinik aciliyet skoru değildir.</p>
    </section>
  );
}
