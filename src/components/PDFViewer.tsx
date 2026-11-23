"use client";

import type { EncapsulatedPDFDocument } from "@/lib/types";

interface Props {
  pdf: EncapsulatedPDFDocument;
}

export default function PDFViewer({ pdf }: Props) {
  const downloadPdf = () => {
    const a = document.createElement("a");
    a.href = pdf.dataUrl;
    a.download = `${pdf.title.replace(/\s+/g, "_")}.pdf`;
    a.click();
  };

  return (
    <div className="flex h-full w-full flex-col bg-[#070a0f] p-2 text-slate-200 overflow-hidden">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between border-b border-[#1a2230] pb-2 mb-2 px-1">
        <div className="flex items-center gap-2">
          <span className="rounded bg-rose-500/20 px-2 py-0.5 font-mono text-[10px] font-bold text-rose-300 border border-rose-500/40">
            DICOM ENCAPSULATED PDF
          </span>
          <h2 className="text-sm font-bold text-slate-100">{pdf.title}</h2>
          <span className="font-mono text-[10px] text-slate-500">({(pdf.sizeBytes / 1024).toFixed(1)} KB)</span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={downloadPdf}
            className="cursor-pointer rounded bg-cyan-500/20 px-3 py-1 text-xs font-bold text-cyan-200 hover:bg-cyan-500/30 border border-cyan-500/40"
          >
            PDF İndir ⬇
          </button>
        </div>
      </div>

      {/* PDF Iframe */}
      <div className="flex-1 rounded-lg border border-[#1e2735] bg-[#1a2230] overflow-hidden">
        <iframe
          src={pdf.dataUrl}
          title={pdf.title}
          className="h-full w-full border-0"
        />
      </div>
    </div>
  );
}
