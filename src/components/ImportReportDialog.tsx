"use client";

import { useEffect } from "react";
import type { ImportStats } from "@/lib/dicom";

export interface ImportReport {
  stats: ImportStats;
  warnings: string[];
  source: "klasör" | "dosya" | "sürükle-bırak" | "sunucu" | "PACS";
}

/** "Klasör yüklenmedi" belirsizliğini giderir: her dosyanın neden açılmadığını kalıcı olarak gösterir. */
export default function ImportReportDialog({ report, onClose }: { report: ImportReport; onClose: () => void }) {
  const { stats, warnings, source } = report;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const nothing = stats.seriesOpened === 0;
  const unsupported = Object.entries(stats.unsupported);
  const failed = Object.entries(stats.failed);
  const rows: [string, number, string][] = [
    ["Seçilen dosya", stats.total, "text-slate-200"],
    ["DICOM olarak tanınan", stats.dicom, "text-cyan-300"],
    ["Standart görüntü (PNG/JPG)", stats.images, "text-cyan-300"],
    ["Açılan seri / nesne", stats.seriesOpened, nothing ? "text-rose-300" : "text-emerald-300"],
    ["Tıbbi olmayan / sistem dosyası (DICOMDIR, viewer, .inf …)", stats.skippedNonMedical, "text-slate-400"],
    ["DICOM değil / okunamadı", stats.unreadable, stats.unreadable ? "text-amber-300" : "text-slate-400"],
    ["Piksel verisi olmayan DICOM (KO, PR …)", stats.noPixel, "text-slate-400"],
  ];

  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="import-report-title" className="flex max-h-[90dvh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-[#273448] bg-[#0b1018] shadow-2xl">
        <header className={`flex items-start justify-between gap-3 border-b border-[#1e2735] p-4 ${nothing ? "bg-rose-500/10" : "bg-emerald-500/5"}`}>
          <div>
            <h2 id="import-report-title" className={`text-sm font-bold ${nothing ? "text-rose-200" : "text-emerald-200"}`}>
              {nothing ? `Bu ${source} içinden görüntü açılamadı` : `Yükleme raporu (${source})`}
            </h2>
            <p className="mt-1 text-xs text-slate-400">{stats.total} dosya {(stats.ms / 1000).toFixed(1)} saniyede incelendi.</p>
          </div>
          <button type="button" aria-label="Yükleme raporunu kapat" onClick={onClose} className="rounded p-2 text-slate-300 hover:bg-white/10">✕</button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 text-xs">
          <table className="w-full">
            <tbody>
              {rows.map(([label, n, cls]) => (
                <tr key={label} className="border-b border-[#141c28]">
                  <td className="py-1.5 pr-3 text-slate-400">{label}</td>
                  <td className={`py-1.5 text-right font-mono font-bold ${cls}`}>{n}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {unsupported.length > 0 && (
            <div className="rounded-lg border border-amber-400/30 bg-amber-400/5 p-3">
              <div className="font-semibold text-amber-200">Desteklenmeyen sıkıştırma biçimi</div>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-slate-300">
                {unsupported.map(([name, n]) => <li key={name}>{name}: {n} dosya</li>)}
              </ul>
            </div>
          )}
          {failed.length > 0 && (
            <div className="rounded-lg border border-rose-400/30 bg-rose-400/5 p-3">
              <div className="font-semibold text-rose-200">Çözülemeyen dosyalar</div>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-slate-300">
                {failed.map(([msg, n]) => <li key={msg}>{n} dosya — {msg}</li>)}
              </ul>
            </div>
          )}
          {warnings.length > 0 && (
            <details className="rounded-lg border border-[#1e2735] p-3 text-slate-300">
              <summary className="cursor-pointer font-semibold text-slate-200">Tüm uyarılar ({warnings.length})</summary>
              <ul className="mt-2 list-disc space-y-1 pl-4">{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
            </details>
          )}

          {nothing && (
            <div className="rounded-lg border border-cyan-400/30 bg-cyan-400/5 p-3 leading-relaxed text-slate-300">
              <div className="font-semibold text-cyan-200">Ne yapabilirsiniz?</div>
              <ul className="mt-1 list-disc space-y-1 pl-4">
                {stats.total === 0 && <li>Klasör boş görünüyor veya tarayıcı dosyaları vermedi. Tarayıcının &quot;dosyaları yükle&quot; onayını kabul ettiğinizden emin olun.</li>}
                {stats.dicom === 0 && stats.total > 0 && <li>Seçilen klasörde DICOM dosyası bulunamadı. Hasta CD&apos;sinde genellikle <b>DICOM</b> adlı alt klasörü veya CD&apos;nin kök klasörünü seçin.</li>}
                {stats.unreadable > 0 && <li>Bazı dosyalar DICOM olarak okunamadı; bunlar viewer programı, rapor veya bozuk dosya olabilir.</li>}
                {unsupported.length > 0 && <li>Desteklenmeyen biçimdeki dosyaları PACS veya CD&apos;yi hazırlayan programla sıkıştırılmamış (Explicit VR Little Endian) olarak yeniden dışa aktarın.</li>}
                <li>Mobil tarayıcılar (iOS/Android) klasör seçmeyi desteklemez; bu durumda <b>Dosya aç</b> ile dosyaları tek tek veya ZIP olarak seçin.</li>
              </ul>
            </div>
          )}
        </div>
        <footer className="flex justify-end border-t border-[#1e2735] p-3">
          <button type="button" onClick={onClose} className="rounded-lg bg-cyan-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-cyan-400">Tamam</button>
        </footer>
      </section>
    </div>
  );
}
