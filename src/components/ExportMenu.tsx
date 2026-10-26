"use client";

import { useRef, useState } from "react";
import type { KeyImage, SeriesData } from "@/lib/types";
import { exportPngZip, exportVideoWebm } from "@/lib/exportMedia";
import { buildKeyObjectSelection } from "@/lib/dicomSr";

interface Props {
  series: SeriesData | null;
  wl: number; ww: number; invert: boolean; slice: number;
  keyImages: KeyImage[];
  toast: (m: string, ms?: number) => void;
}

function download(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/** Dışa aktarma: cine video (WebM), kesit PNG ZIP, anahtar kesit DICOM KO. */
export default function ExportMenu({ series, wl, ww, invert, slice, keyImages, toast }: Props) {
  const [open, setOpen] = useState(false);
  const [dlg, setDlg] = useState<"video" | "zip" | null>(null);
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(1);
  const [fps, setFps] = useState(12);
  const [side, setSide] = useState(512);
  const [prog, setProg] = useState<{ done: number; total: number } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const n = series?.slices.length ?? 0;
  const imageOk = !!series && (!series.specialType || series.specialType === "image") && n > 0;

  const openDlg = (k: "video" | "zip") => {
    if (!imageOk) { toast("Önce bir görüntü serisi açın."); return; }
    setFrom(1); setTo(n); setDlg(k); setOpen(false);
  };
  const run = async () => {
    if (!series || !dlg) return;
    const f = Math.max(1, Math.min(n, from)) - 1, t = Math.max(f + 1, Math.min(n, to)) - 1;
    abort.current = new AbortController();
    setProg({ done: 0, total: t - f + 1 });
    const o = { wl, ww, invert, maxSide: side, from: f, to: t, fps, onProgress: (done: number, total: number) => setProg({ done, total }), signal: abort.current.signal };
    try {
      if (dlg === "video") { download(await exportVideoWebm(series, o), `cine-${series.modality}-${f + 1}-${t + 1}.webm`); toast("Video indirildi (WebM).", 4000); }
      else { download(new Blob([(await exportPngZip(series, o)).slice().buffer as ArrayBuffer], { type: "application/zip" }), `kesitler-${series.modality}-${f + 1}-${t + 1}.zip`); toast("Kesitler ZIP olarak indirildi.", 4000); }
      setDlg(null);
    } catch (e) { toast(`Dışa aktarma başarısız: ${e instanceof Error ? e.message : "hata"}`, 6000); }
    finally { setProg(null); }
  };
  const exportKo = () => {
    setOpen(false);
    if (!series || !imageOk) { toast("Önce bir görüntü serisi açın."); return; }
    if (keyImages.length === 0) { toast("Önce en az bir anahtar kesit (★) ekleyin."); return; }
    if (!series.sopUids || !series.sopClassUid || !series.seriesUid) { toast("Bu seride SOP Instance UID bilgisi yok (örnek vaka veya UID'siz görüntü); KO yalnızca gerçek DICOM serileri için üretilir.", 7000); return; }
    const items = keyImages.filter((k) => series.sopUids![k.slice]).map((k) => ({ sopUid: series.sopUids![k.slice], note: k.note }));
    const bytes = buildKeyObjectSelection({
      patientName: series.patientName, patientId: series.patientId, patientSex: series.patientSex, studyUid: series.studyUid, studyDate: series.studyDate, institution: series.institution,
      seriesUid: series.seriesUid, sopClassUid: series.sopClassUid, items,
    });
    download(new Blob([bytes.slice().buffer as ArrayBuffer], { type: "application/dicom" }), `KO-${series.modality}-${items.length}-anahtar-kesit.dcm`);
    toast(`DICOM Key Object (${items.length} anahtar kesit) indirildi.`, 5000);
  };

  const item = "block w-full cursor-pointer px-3 py-1.5 text-left hover:bg-[#1a2330]";
  return (
    <div className="relative shrink-0">
      <button type="button" onClick={() => setOpen((o) => !o)} className="cursor-pointer rounded-md border border-[#2d3b4e] bg-[#111823] px-2 py-1 text-[11px] font-semibold text-slate-300 hover:bg-[#1a2330]">Dışa aktar ▾</button>
      {open && (
        <div className="absolute left-0 top-full z-40 mt-1 w-64 rounded-lg border border-[#2d3b4e] bg-[#0b0f16] py-1 text-[11px] text-slate-200 shadow-2xl">
          <button className={item} onClick={() => openDlg("video")}>🎞 Cine video (WebM)…</button>
          <button className={item} onClick={() => openDlg("zip")}>🖼 Kesitler → PNG (ZIP)…</button>
          <button className={item} onClick={exportKo}>★ Anahtar kesitler → DICOM KO</button>
          <div className="px-3 py-1 text-[10px] leading-relaxed text-slate-500">Video/PNG görüntü verisini olduğu gibi aktarır; kimlik bilgisi içermez ama anonimleştirme/DICOM etiketi taşımaz.</div>
        </div>
      )}
      {dlg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-80 rounded-xl border border-[#2d3b4e] bg-[#0b0f16] p-4 text-xs text-slate-200 shadow-2xl">
            <div className="mb-3 text-sm font-bold text-cyan-300">{dlg === "video" ? "Cine video (WebM)" : "Kesitler → PNG (ZIP)"}</div>
            <div className="space-y-2">
              <label className="flex items-center justify-between">İlk kesit<input aria-label="İlk kesit" type="number" min={1} max={n} value={from} onChange={(e) => setFrom(Number(e.target.value))} className="w-20 rounded border border-[#1e2735] bg-[#0e141d] px-1 py-0.5" /></label>
              <label className="flex items-center justify-between">Son kesit<input aria-label="Son kesit" type="number" min={1} max={n} value={to} onChange={(e) => setTo(Number(e.target.value))} className="w-20 rounded border border-[#1e2735] bg-[#0e141d] px-1 py-0.5" /></label>
              {dlg === "video" && <label className="flex items-center justify-between">Kare/sn<input aria-label="Kare hızı" type="number" min={1} max={30} value={fps} onChange={(e) => setFps(Math.max(1, Math.min(30, Number(e.target.value))))} className="w-20 rounded border border-[#1e2735] bg-[#0e141d] px-1 py-0.5" /></label>}
              <label className="flex items-center justify-between">Boyut (px)
                <select aria-label="Boyut" value={side} onChange={(e) => setSide(Number(e.target.value))} className="w-24 rounded border border-[#1e2735] bg-[#0e141d] px-1 py-0.5"><option value={256}>256</option><option value={512}>512</option><option value={1024}>1024</option></select>
              </label>
              <div className="text-[10px] text-slate-500">Geçerli pencere (WL {Math.round(wl)} / WW {Math.round(ww)}){invert ? ", ters" : ""} uygulanır. Şu an {slice + 1}. kesitte.</div>
              {prog && <div className="h-2 overflow-hidden rounded bg-[#1a2230]"><div className="h-full bg-cyan-400" style={{ width: `${(prog.done / prog.total) * 100}%` }} /></div>}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button className="cursor-pointer rounded border border-[#2d3b4e] px-3 py-1" onClick={() => { abort.current?.abort(); setDlg(null); }}>{prog ? "İptal" : "Kapat"}</button>
              <button data-testid="export-run" disabled={!!prog} className="cursor-pointer rounded bg-cyan-500 px-3 py-1 font-bold text-black disabled:opacity-50" onClick={() => void run()}>{prog ? `${prog.done}/${prog.total}` : "Dışa aktar"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
