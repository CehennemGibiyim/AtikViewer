"use client";

import { useEffect, useRef, useState } from "react";

export interface ImageExport {
  dataUrl: string;
  filename: string;
  sliceLabel: string;
}

/** Önizleme, indirme engellense bile görünür kalır; indirme doğrudan kullanıcı tıklamasındadır. */
export default function ExportImageDialog({ image, onClose }: { image: ImageExport; onClose: () => void }) {
  const [url, setUrl] = useState("");
  const [requested, setRequested] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl = "";
    fetch(image.dataUrl).then((r) => r.blob()).then((blob) => {
      objectUrl = URL.createObjectURL(blob);
      if (!cancelled) setUrl(objectUrl);
      else URL.revokeObjectURL(objectUrl);
    }).catch(() => { if (!cancelled) setUrl(image.dataUrl); });
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); window.removeEventListener("keydown", onKey); };
  }, [image.dataUrl, onClose]);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="png-export-title" className="flex max-h-[90dvh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-[#273448] bg-[#0b1018] shadow-2xl">
        <header className="flex items-center justify-between border-b border-[#1e2735] p-4">
          <div><h2 id="png-export-title" className="text-sm font-bold text-cyan-200">PNG görüntü önizlemesi</h2><p className="mt-1 text-xs text-slate-400">{image.sliceLabel} · {image.filename}</p></div>
          <button ref={closeRef} type="button" aria-label="PNG önizlemesini kapat" onClick={onClose} className="rounded p-2 text-slate-300 hover:bg-white/10">✕</button>
        </header>
        <div className="min-h-0 flex-1 overflow-auto bg-black p-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image.dataUrl} alt={image.sliceLabel} className="mx-auto max-h-[55dvh] max-w-full object-contain" />
        </div>
        <div className="space-y-3 border-t border-[#1e2735] p-4">
          <div className="flex flex-wrap gap-2">
            <a href={url || image.dataUrl} download={image.filename} onClick={() => setRequested(true)} className="rounded-lg bg-cyan-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-cyan-400">PNG dosyasını indir</a>
            <a href={url || image.dataUrl} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-slate-600 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-white/5">Görüntüyü yeni sekmede aç ↗</a>
          </div>
          <p role="status" className="text-[11px] leading-relaxed text-slate-400">
            {requested ? "İndirme istendi. Dosya gelmediyse önizleme ortamı indirmeleri engelliyor olabilir: görüntüyü yeni sekmede açıp kaydedebilirsiniz." : "Görüntü hazır. Kaydetmek için indirme düğmesine tıklayın. Gömülü önizlemelerde tarayıcı izinleri indirmeyi kısıtlayabilir."}
          </p>
        </div>
      </section>
    </div>
  );
}
