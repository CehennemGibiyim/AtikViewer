"use client";

import { useState } from "react";
import type { DicomSRDocument, SRNode } from "@/lib/types";

interface Props {
  sr: DicomSRDocument;
  onJumpToSlice?: (sliceNumber: number) => void;
}

function NodeView({ node, depth = 0, onJump }: { node: SRNode; depth?: number; onJump?: (s: number) => void }) {
  const [collapsed, setCollapsed] = useState(false);
  const hasChildren = node.children && node.children.length > 0;

  const conceptTitle = node.conceptName?.meaning || node.conceptName?.code || node.relationship || "Öğe";

  return (
    <div className="my-1 rounded-md border border-[#1e2735] bg-[#0c121c] p-2 text-xs text-slate-200">
      <div className="flex flex-wrap items-center justify-between gap-1">
        <div className="flex items-center gap-1.5 font-semibold text-cyan-300">
          {hasChildren && (
            <button
              onClick={() => setCollapsed(!collapsed)}
              className="cursor-pointer rounded bg-[#162234] px-1 text-[10px] font-bold text-slate-400 hover:text-white"
            >
              {collapsed ? "▶" : "▼"}
            </button>
          )}
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{node.valueType}</span>
          <span>{conceptTitle}</span>
        </div>

        {node.referencedSlice !== undefined && onJump && (
          <button
            onClick={() => onJump(node.referencedSlice!)}
            className="cursor-pointer rounded bg-cyan-500/20 px-2 py-0.5 text-[10px] font-bold text-cyan-200 hover:bg-cyan-500/30"
          >
            Kesit {node.referencedSlice} ⤴
          </button>
        )}
      </div>

      {node.textValue && (
        <p className="mt-1 whitespace-pre-wrap rounded bg-[#070a0f] p-1.5 font-mono text-[11px] text-slate-300">
          {node.textValue}
        </p>
      )}

      {node.codeValue && (
        <div className="mt-1 font-mono text-[10.5px] text-emerald-300">
          Kod: <span className="font-bold">{node.codeValue.meaning}</span> ({node.codeValue.scheme}: {node.codeValue.code})
        </div>
      )}

      {node.numValue && (
        <div className="mt-1 font-mono text-[11px] text-amber-300">
          Ölçüm Değeri: <span className="font-bold text-white">{node.numValue.value}</span> {node.numValue.unit}
        </div>
      )}

      {hasChildren && !collapsed && (
        <div className="mt-2 pl-3 border-l border-[#1e2735] space-y-1">
          {node.children!.map((child) => (
            <NodeView key={child.id} node={child} depth={depth + 1} onJump={onJump} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function SRViewer({ sr, onJumpToSlice }: Props) {
  const [search, setSearch] = useState("");

  return (
    <div className="flex h-full w-full flex-col bg-[#070a0f] p-3 text-slate-200 overflow-hidden">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between border-b border-[#1a2230] pb-2 mb-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded bg-violet-500/20 px-2 py-0.5 font-mono text-[10px] font-bold text-violet-300 border border-violet-500/40">
              DICOM SR (Structured Report)
            </span>
            <h2 className="text-sm font-bold text-slate-100">{sr.title}</h2>
          </div>
          <div className="mt-0.5 font-mono text-[10px] text-slate-400">
            SOP UID: {sr.sopInstanceUid} {sr.completionFlag && `· Durum: ${sr.completionFlag}`} {sr.verificationFlag && `· Doğrulama: ${sr.verificationFlag}`}
          </div>
        </div>

        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rapor içinde ara…"
          className="rounded border border-[#1e2735] bg-[#0e141d] px-2.5 py-1 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none"
        />
      </div>

      {/* Tree Content */}
      <div className="flex-1 overflow-y-auto pr-1">
        <NodeView node={sr.root} onJump={onJumpToSlice} />
      </div>
    </div>
  );
}
