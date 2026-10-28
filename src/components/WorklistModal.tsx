"use client";

import { useCallback, useEffect, useState } from "react";
import type { StudyRow, UserInfo } from "@/lib/types";

interface PacsStudy {
  studyUid: string;
  patientName: string;
  patientId: string;
  studyDate: string;
  modalities: string;
  description: string;
  instances: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  user: UserInfo;
  onOpenStudy: (s: StudyRow) => void;
  onOpenPacs: (s: PacsStudy) => void;
}

const STATUS_LABEL: Record<string, string> = { bekliyor: "Bekliyor", okunuyor: "Okunuyor", taslak: "Taslak", onayli: "Onaylı" };

function triageChip(level: string, score: number) {
  if (!level) return <span className="text-slate-600">—</span>;
  const c = score > 0.8 ? "border-rose-500/50 bg-rose-500/20 text-rose-200" : score > 0.6 ? "border-orange-500/50 bg-orange-500/15 text-orange-200" : score > 0.4 ? "border-yellow-500/50 bg-yellow-500/15 text-yellow-200" : "border-emerald-500/40 bg-emerald-500/10 text-emerald-200";
  return <span className={`whitespace-nowrap rounded border px-1.5 py-0.5 font-mono text-[9.5px] font-bold ${c}`}>{level}</span>;
}

export default function WorklistModal({ open, onClose, user, onOpenStudy, onOpenPacs }: Props) {
  const [tab, setTab] = useState<"liste" | "pacs">("liste");
  const [rows, setRows] = useState<StudyRow[]>([]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [pacs, setPacs] = useState<PacsStudy[]>([]);
  const [pq, setPq] = useState("");
  const [pacsErr, setPacsErr] = useState("");
  const canAssign = true;

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch(`/api/studies?${new URLSearchParams({ q, status })}`);
    if (r.ok) setRows((await r.json()) as StudyRow[]);
    setLoading(false);
  }, [q, status]);
  useEffect(() => {
    if (open && tab === "liste") void (async () => { await load(); })();
  }, [open, tab, load]);

  const patch = async (id: number, body: Record<string, unknown>) => {
    await fetch(`/api/studies/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    void load();
  };
  const searchPacs = async () => {
    setPacsErr("");
    const r = await fetch(`/api/pacs/studies?q=${encodeURIComponent(pq)}`);
    const d = await r.json();
    if (!r.ok) { setPacs([]); setPacsErr((d as { error?: string }).error ?? "PACS hatası"); return; }
    setPacs(d as PacsStudy[]);
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
      <div className="flex h-full max-h-[88vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-[#232e40] bg-[#0b0f16] shadow-2xl">
        <div className="flex items-center gap-3 border-b border-[#1a2230] px-4 py-3">
          <h2 className="text-sm font-black tracking-wide text-slate-100">Çalışma listesi</h2>
          {(["liste", "pacs"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`cursor-pointer rounded px-3 py-1 text-xs font-bold ${tab === t ? "bg-cyan-400/15 text-cyan-300 ring-1 ring-cyan-400/40" : "text-slate-400 hover:text-slate-200"}`}>{t === "liste" ? "Yerel / HBYS" : "PACS (DICOMweb)"}</button>
          ))}
          <button onClick={onClose} className="ml-auto cursor-pointer rounded border border-[#2d3b4e] bg-[#141b24] px-2.5 py-1 text-xs text-slate-300 hover:text-white">✕</button>
        </div>

        {tab === "liste" && (
          <>
            <div className="flex flex-wrap items-center gap-2 border-b border-[#1a2230] px-4 py-2 text-xs">
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Hasta, ID, açıklama ara…" className="w-64 rounded border border-[#1e2735] bg-[#0e141d] px-2 py-1.5 text-slate-200 placeholder:text-slate-600 focus:outline-none" />
              <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded border border-[#1e2735] bg-[#0e141d] px-2 py-1.5 text-slate-200">
                <option value="">Tüm durumlar</option>
                {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <span className="text-slate-500">Triyaj önceliğine göre sıralıdır (en acil üstte).</span>
              <button onClick={() => void load()} className="ml-auto cursor-pointer text-cyan-400">⟳ yenile</button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full border-collapse text-[11px]">
                <thead className="sticky top-0 bg-[#0b0f16] text-left text-slate-500">
                  <tr>{["Triyaj", "Hasta", "ID", "Modalite", "Açıklama", "Tarih", "Durum", "Atanan", "Rapor", ""].map((h) => <th key={h} className="border-b border-[#1a2230] px-3 py-2 font-semibold">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {rows.length === 0 && <tr><td colSpan={10} className="px-3 py-8 text-center text-slate-500">{loading ? "Yükleniyor…" : "Kayıt yok. Görüntü açıp ☁ ile sunucuya kaydedin veya HBYS/PACS'tan getirin."}</td></tr>}
                  {rows.map((s) => (
                    <tr key={s.id} className="hover:bg-[#101722]">
                      <td className="border-b border-[#141b26] px-3 py-2">{triageChip(s.triageLevel, s.triageScore)}</td>
                      <td className="border-b border-[#141b26] px-3 py-2 font-semibold text-slate-100">{s.patientName}</td>
                      <td className="border-b border-[#141b26] px-3 py-2 font-mono text-slate-400">{s.patientId}</td>
                      <td className="border-b border-[#141b26] px-3 py-2 font-bold text-cyan-300">{s.modality}</td>
                      <td className="border-b border-[#141b26] px-3 py-2 text-slate-300">{s.seriesDescription}<span className="ml-1 text-slate-600">({s.sliceCount})</span></td>
                      <td className="border-b border-[#141b26] px-3 py-2 text-slate-400">{s.studyDate}</td>
                      <td className="border-b border-[#141b26] px-3 py-2">
                        <select value={s.workStatus} disabled={!canAssign && s.workStatus === "onayli"} onChange={(e) => void patch(s.id, { workStatus: e.target.value })} className="rounded border border-[#1e2735] bg-[#0e141d] px-1 py-0.5 text-slate-200">
                          {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k} disabled={k === "onayli" && !canAssign}>{v}</option>)}
                        </select>
                      </td>
                      <td className="border-b border-[#141b26] px-3 py-2 text-slate-300">{s.assignedToName || (canAssign ? <button onClick={() => void patch(s.id, { assignTo: "me" })} className="cursor-pointer text-cyan-400 hover:underline">bana ata</button> : "—")}</td>
                      <td className="border-b border-[#141b26] px-3 py-2">{s.reportStatus ? <span className={s.reportStatus === "onaylandi" ? "text-emerald-300" : "text-rose-300"}>{s.reportStatus === "onaylandi" ? "onaylı" : "taslak"}</span> : <span className="text-slate-600">—</span>}</td>
                      <td className="border-b border-[#141b26] px-3 py-2 text-right">
                        {s.hasFiles ? <button onClick={() => { onOpenStudy(s); onClose(); }} className="cursor-pointer rounded bg-cyan-500 px-2.5 py-1 font-bold text-slate-950 hover:bg-cyan-400">Aç</button> : <span className="text-[10px] text-slate-600">görüntü yok</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {tab === "pacs" && (
          <>
            <div className="flex items-center gap-2 border-b border-[#1a2230] px-4 py-2 text-xs">
              <input value={pq} onChange={(e) => setPq(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void searchPacs()} placeholder="Hasta adı veya ID (QIDO-RS)…" className="w-72 rounded border border-[#1e2735] bg-[#0e141d] px-2 py-1.5 text-slate-200 placeholder:text-slate-600 focus:outline-none" />
              <button onClick={() => void searchPacs()} className="cursor-pointer rounded bg-cyan-500 px-3 py-1.5 font-bold text-slate-950">Ara</button>
              <span className="text-slate-500">PACS adresi: Yönetim → Entegrasyon.</span>
            </div>
            {pacsErr && <div className="border-b border-[#1a2230] px-4 py-2 text-xs font-semibold text-rose-300">{pacsErr}</div>}
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full border-collapse text-[11px]">
                <thead className="sticky top-0 bg-[#0b0f16] text-left text-slate-500"><tr>{["Hasta", "ID", "Tarih", "Modalite", "Açıklama", "Görüntü", ""].map((h) => <th key={h} className="border-b border-[#1a2230] px-3 py-2 font-semibold">{h}</th>)}</tr></thead>
                <tbody>
                  {pacs.map((s) => (
                    <tr key={s.studyUid} className="hover:bg-[#101722]">
                      <td className="border-b border-[#141b26] px-3 py-2 font-semibold text-slate-100">{s.patientName}</td>
                      <td className="border-b border-[#141b26] px-3 py-2 font-mono text-slate-400">{s.patientId}</td>
                      <td className="border-b border-[#141b26] px-3 py-2 text-slate-400">{s.studyDate}</td>
                      <td className="border-b border-[#141b26] px-3 py-2 font-bold text-cyan-300">{s.modalities}</td>
                      <td className="border-b border-[#141b26] px-3 py-2 text-slate-300">{s.description}</td>
                      <td className="border-b border-[#141b26] px-3 py-2 text-slate-400">{s.instances}</td>
                      <td className="border-b border-[#141b26] px-3 py-2 text-right"><button onClick={() => { onOpenPacs(s); onClose(); }} className="cursor-pointer rounded bg-cyan-500 px-2.5 py-1 font-bold text-slate-950 hover:bg-cyan-400">Getir ve aç</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
