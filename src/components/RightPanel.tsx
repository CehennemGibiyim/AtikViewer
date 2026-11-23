"use client";

import { useEffect, useRef, useState } from "react";
import { fmtConf } from "@/lib/format";
import { KIND_LABEL, annotationSummary } from "@/lib/geometry";
import ReviewMetrics from "./ReviewMetrics";
import type {
  AiMode, AiProtocol, AnalysisResult, Annotation, Finding, KeyImage, SavedReport, SeriesData, StudyRow, UserInfo,
} from "@/lib/types";
import type { ScanState } from "./Viewport";

const SEV: Record<string, { color: string; bg: string; label: string }> = {
  kritik: { color: "#ff3b5c", bg: "rgba(255,59,92,0.14)", label: "KRİTİK" },
  yuksek: { color: "#ff9f1c", bg: "rgba(255,159,28,0.13)", label: "YÜKSEK" },
  orta: { color: "#ffd60a", bg: "rgba(255,214,10,0.12)", label: "ORTA" },
  dusuk: { color: "#4cc9f0", bg: "rgba(76,201,240,0.11)", label: "DÜŞÜK" },
  normal: { color: "#2ee6a8", bg: "rgba(46,230,168,0.11)", label: "BİLGİ" },
};

const MODES: { id: AiMode; icon: string; title: string; sub: string }[] = [
  { id: "kapsamli", icon: "▤", title: "Kapsamlı rapor", sub: "Kesit bazlı bulgular" },
  { id: "triyaj", icon: "⚠", title: "Acil triyaj", sub: "Kritik aday taraması" },
  { id: "ayirici", icon: "⇄", title: "Ayırıcı tanı", sub: "Olasılık + gerekçe" },
  { id: "hasta", icon: "☺", title: "Hasta özeti", sub: "Anlaşılır açıklama" },
];

export interface FeedItem {
  t: string;
  text: string;
  kind: "info" | "finding" | "done" | "warn";
}
type Status = "idle" | "infer" | "scanning" | "done";

interface Props {
  user: UserInfo;
  series: SeriesData | null;
  currentSlice: number;
  status: Status;
  scan: ScanState | null;
  mode: AiMode;
  setMode: (m: AiMode) => void;
  clinicalNote: string;
  setClinicalNote: (s: string) => void;
  protocol: AiProtocol;
  setProtocol: (p: AiProtocol) => void;
  resolved: "ct-head" | "ct-chest" | "image-review" | "none";
  analysis: AnalysisResult | null;
  revealedIds: Set<string>;
  feed: FeedItem[];
  engineNotes: string[];
  onStart: () => void;
  onGotoFinding: (f: Finding) => void;
  activeFindingId: string | null;
  overlayOpacity: number;
  setOverlayOpacity: (n: number) => void;
  hasMasks: boolean;
  annotations: Annotation[];
  pxMm: number;
  onDeleteAnnotation: (id: string) => void;
  onClearAnnotations: () => void;
  onGotoSlice: (i: number) => void;
  keyImages: KeyImage[];
  onRemoveKeyImage: (id: string) => void;
  patientReports: SavedReport[];
  priorStudies: StudyRow[];
  onOpenSaved: (id: number) => void;
  onOpenPrior: (s: StudyRow) => void;
  onRefreshReports: () => void;
  onOpenReportModal: () => void;
  currentReportStatus: "taslak" | "onaylandi";
  onStartAll?: () => void;
  loadedCount?: number;
}

function priorDelta(f: Finding, priors: SavedReport[]): string | null {
  const m = f.metrics;
  if (!m || f.category === "Sistem") return null;
  for (const r of priors) {
    const pf = r.findingsJson.find((x) => x.category === f.category && x.metrics && x.source !== "manual");
    if (!pf?.metrics) continue;
    const parts: string[] = [];
    if (m.maxDiameterMm !== undefined && pf.metrics.maxDiameterMm !== undefined) {
      const d = m.maxDiameterMm - pf.metrics.maxDiameterMm;
      parts.push(`çap ${pf.metrics.maxDiameterMm.toFixed(0)} → ${m.maxDiameterMm.toFixed(0)} mm (${d >= 0 ? "+" : ""}${d.toFixed(1)})`);
    }
    if (m.volumeMl !== undefined && pf.metrics.volumeMl) {
      const pct = ((m.volumeMl - pf.metrics.volumeMl) / pf.metrics.volumeMl) * 100;
      parts.push(`hacim ${pf.metrics.volumeMl} → ${m.volumeMl} mL (${pct >= 0 ? "+" : ""}${pct.toFixed(0)}%)`);
    }
    if (parts.length) return `Önceki (${new Date(r.createdAt).toLocaleDateString("tr-TR")}): ${parts.join(" · ")}. Kayıt (registration) yapılmadan, yalnızca ölçüm karşılaştırması.`;
  }
  return null;
}

const PROTO_LABEL = {
  "ct-head": "BT Beyin · kanama adayı (kural tabanlı)",
  "ct-chest": "BT Toraks · nodül adayı (kural tabanlı)",
  "image-review": "Her karede gerçek piksel ölçümü · tanı / triyaj yok",
  none: "Otomatik inceleme kapalı (seçiminiz)",
} as const;

export default function RightPanel(p: Props) {
  const { series, status, scan, analysis, revealedIds, feed } = p;
  const [tab, setTab] = useState<"ai" | "rapor" | "olcum" | "dicom" | "gecmis">("ai");
  const [cardOpen, setCardOpen] = useState(false);
  const feedRef = useRef<HTMLDivElement>(null);
  useEffect(() => { feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight }); }, [feed]);
  useEffect(() => {
    if (tab === "gecmis") p.onRefreshReports();
    // p kimliği her render'da değiştiği için bilinçli olarak yalnızca sekme izlenir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const revealed = analysis?.findings.filter((f) => revealedIds.has(f.id)) ?? [];
  const busy = status === "infer" || status === "scanning";
  const unit = series?.unit ?? "SI";
  const priors = p.patientReports.filter((r) => !series || r.studyUid !== series.studyUid).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <div className="flex h-full w-full flex-col border-l border-[#1a2230] bg-[#0b0f16]">
      <div className="flex shrink-0 border-b border-[#1a2230]">
        {([["ai", "Vision AI"], ["rapor", "Rapor"], ["olcum", `Ölçüm${p.annotations.length ? ` (${p.annotations.length})` : ""}`], ["dicom", "DICOM"], ["gecmis", "Geçmiş"]] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} className={`flex-1 cursor-pointer px-1 py-2.5 text-[11px] font-semibold tracking-wide ${tab === id ? "border-b-2 border-cyan-400 text-cyan-300" : "text-slate-400 hover:text-slate-200"}`}>{label}</button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {tab === "ai" && (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-2">
              {MODES.map((m) => (
                <button key={m.id} onClick={() => p.setMode(m.id)} className={`cursor-pointer rounded-lg border p-2.5 text-left ${p.mode === m.id ? "border-cyan-400/60 bg-cyan-400/10" : "border-[#1e2735] bg-[#0e141d] hover:border-[#2c394d]"}`}>
                  <div className="text-base text-cyan-300">{m.icon}</div>
                  <div className="mt-1 text-xs font-bold text-slate-100">{m.title}</div>
                  <div className="mt-0.5 text-[10px] leading-tight text-slate-500">{m.sub}</div>
                </button>
              ))}
            </div>

            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
              Analiz protokolü
              <select value={p.protocol} onChange={(e) => p.setProtocol(e.target.value as AiProtocol)} className="mt-1 w-full rounded-lg border border-[#1e2735] bg-[#0e141d] px-2 py-1.5 text-xs normal-case tracking-normal text-slate-200 focus:outline-none">
                <option value="auto">Otomatik (BT adayı / diğerlerinde kesit incelemesi)</option>
                <option value="review">Tüm karelerde görüntü ölçümü (tanısal değil)</option>
                <option value="ct-head">BT Beyin — kanama adayı</option>
                <option value="ct-chest">BT Toraks — nodül adayı</option>
                <option value="none">İncelemeyi kapat</option>
              </select>
              <span className={`mt-1 block text-[10.5px] normal-case tracking-normal ${p.resolved === "none" || p.resolved === "image-review" ? "text-amber-300" : "text-emerald-300"}`}>→ {PROTO_LABEL[p.resolved]}{p.resolved === "image-review" && " · MR/US/grafi için hastalık modeli değil"}</span>
            </label>
            {p.mode === "triyaj" && p.resolved === "image-review" && (
              <p className="rounded-lg border border-amber-400/40 bg-amber-400/5 p-2 text-[10.5px] leading-relaxed text-amber-200">
                US/MR/grafi için acil klinik sınıflandırıcı bağlı değil. Başlatıldığında yalnızca kare bazlı görüntü ölçümleri gösterilir; acil/normal kararı verilmez.
              </p>
            )}

            <textarea value={p.clinicalNote} onChange={(e) => p.setClinicalNote(e.target.value)} placeholder="Klinik bilgi / hekim notu…" rows={2} className="w-full resize-none rounded-lg border border-[#1e2735] bg-[#0e141d] p-2.5 text-xs text-slate-200 placeholder:text-slate-600 focus:border-cyan-400/50 focus:outline-none" />

            <button onClick={p.onStart} disabled={!series || busy || !!(series.specialType && series.specialType !== "image")} className="cursor-pointer rounded-lg bg-gradient-to-r from-cyan-500 to-emerald-500 px-4 py-2.5 text-sm font-bold text-[#06131a] shadow-lg disabled:opacity-40">
              {busy ? "Kareler tek tek işleniyor…" : p.resolved === "image-review" ? `▶ ${status === "done" ? "Yeniden incele" : "Görüntü incelemesini başlat"} (${series?.slices.length ?? 0} kare)` : status === "done" ? "⟳ Yeniden analiz et" : `▶ Analizi başlat (${series?.slices.length ?? 0} kesit)`}
            </button>
            {p.onStartAll && (p.loadedCount ?? 0) > 1 && (
              <button onClick={p.onStartAll} disabled={busy} className="cursor-pointer rounded-lg border border-violet-400/50 bg-violet-500/10 px-4 py-2 text-xs font-bold text-violet-200 hover:bg-violet-500/20 disabled:opacity-40">
                ✨ Tüm yüklenen serileri birlikte AI ile analiz et ({p.loadedCount} seri)
              </button>
            )}

            {busy && scan && (
              <div className="rounded-lg border border-emerald-400/30 bg-emerald-400/5 p-3">
                <div className="flex items-center justify-between text-[11px] font-semibold text-emerald-300">
                  <span>{scan.phaseLabel}</span>
                  <span className="rounded border border-emerald-500/40 bg-emerald-950 px-2 py-0.5 font-mono text-xs font-bold">Kesit {Math.min(scan.scannedSlices + 1, scan.totalSlices)} / {scan.totalSlices}</span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#13202b]"><div className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-emerald-400" style={{ width: `${((scan.scannedSlices + scan.sliceProgress) / Math.max(1, scan.totalSlices)) * 100}%` }} /></div>
                <div className="mt-1.5 font-mono text-[10px] text-slate-500">{p.resolved === "image-review" ? "Her karede gerçek pikseller: parlaklık · kontrast · varsa kırmızı/mavi renk oranı" : "BT pikselleri: doku maskesi → aday odak incelemesi"}</div>
              </div>
            )}

            {feed.length > 0 && (
              <div className="rounded-lg border border-[#1e2735] bg-[#080c12]">
                <div className="border-b border-[#1e2735] px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">Analiz günlüğü</div>
                <div ref={feedRef} className="max-h-40 overflow-y-auto p-2 font-mono text-[10.5px] leading-relaxed">
                  {feed.map((it, i) => (
                    <div key={i} className="flex gap-2"><span className="shrink-0 text-slate-600">{it.t}</span><span className={it.kind === "finding" ? "font-semibold text-amber-300" : it.kind === "done" ? "font-bold text-emerald-300" : it.kind === "warn" ? "font-bold text-rose-300" : "text-slate-400"}>{it.text}</span></div>
                  ))}
                </div>
              </div>
            )}

            {status === "done" && analysis && (
              <>
                <div className={`rounded-lg border p-2.5 text-[11px] leading-snug ${analysis.engine === "cv-heuristic" || analysis.engine === "image-review" ? "border-cyan-400/40 bg-cyan-400/10 text-cyan-100" : analysis.engine === "no-model" ? "border-slate-500/40 bg-slate-500/10 text-slate-300" : "border-amber-400/40 bg-amber-400/10 text-amber-200"}`}>
                  <div className="font-bold">{analysis.engine === "image-review" ? `📊 ${analysis.review?.frameCount ?? 0} karede gerçek piksel incelemesi tamamlandı` : analysis.engine === "cv-heuristic" ? "ℹ Kural tabanlı BT aday odakları (derin öğrenme değil)" : analysis.engine === "no-model" ? "ℹ Otomatik inceleme kapalı" : "⚠ DEMO — önceden tanımlı örnek bulgular"}</div>
                  <p className="mt-0.5">
                    {analysis.engine === "image-review" ? "Her karenin parlaklık/kontrast ve varsa renkli piksel dağılımı ölçüldü. Bu tanısal AI, hastalık saptaması veya acil klinik triyaj değildir; görüntüleri hekim değerlendirmelidir."
                      : analysis.engine === "cv-heuristic" ? "BT piksellerinden aday odaklar hesaplandı (HU, boyut, hacim). Klinik doğrulama yok; yanlış pozitif/negatif olabilir."
                        : analysis.engine === "no-model" ? "İnceleme bu seri için kapalı. Boş sonuç 'normal' demek değildir." : "Bulgular örnek vakaya önceden tanımlanmıştır; gerçek model çıktısı değildir."}
                  </p>
                  <button onClick={() => setCardOpen((v) => !v)} className="mt-1 cursor-pointer text-[10.5px] font-bold underline">{analysis.engine === "image-review" ? (cardOpen ? "Ölçüm yöntemini gizle" : "Ölçüm yöntemini göster") : (cardOpen ? "Model kartını gizle" : "Model kartını göster")}</button>
                  {cardOpen && (
                    <div className="mt-1.5 space-y-1 rounded bg-black/30 p-2 text-[10.5px] text-slate-200">
                      <div><b>{analysis.modelCard.name}</b> v{analysis.modelCard.version}</div>
                      <div><b>Amaç:</b> {analysis.modelCard.intendedUse}</div>
                      <div><b>Yöntem:</b> {analysis.modelCard.method}</div>
                      <div><b>Sınırlılıklar:</b><ul className="list-disc pl-4">{analysis.modelCard.limitations.map((l) => <li key={l}>{l}</li>)}</ul></div>
                      <div><b>Doğrulama:</b> {analysis.modelCard.validation}</div>
                    </div>
                  )}
                </div>
                {p.engineNotes.map((n) => <div key={n} className="rounded border border-amber-400/30 bg-amber-400/5 p-2 text-[10.5px] text-amber-200">⚠ {n}</div>)}
                {analysis.engine === "image-review" && (
                  <div role="note" className="rounded-lg border border-amber-400/35 bg-amber-400/5 p-2.5 text-[10.5px] leading-relaxed text-amber-100">
                    {p.mode === "triyaj" ? "⚠ Bu modalitede tanısal acil triyaj modeli bağlı değil. Ölçümler görüntüyü incelemek içindir; acil/normal kararı vermez." : "Klinik triyaj yapılmadı. Tanı ve acil değerlendirme radyoloğa aittir."}
                  </div>
                )}
                {analysis.review && <ReviewMetrics review={analysis.review} currentSlice={p.currentSlice} unit={unit} onGotoSlice={p.onGotoSlice} />}
                {(analysis.engine === "cv-heuristic" || analysis.engine === "simulated-sample") && (
                  <div className="rounded-lg border p-3" style={{ borderColor: analysis.triage.score > 0.8 ? "#ff3b5c66" : analysis.triage.score > 0.6 ? "#ff9f1c55" : "#2ee6a844", background: analysis.triage.score > 0.8 ? "rgba(255,59,92,0.08)" : "rgba(46,230,168,0.05)" }}>
                    <div className="flex items-center justify-between"><span className="text-xs font-black tracking-wide text-slate-100">TRİYAJ: {analysis.triage.level}</span><span className="font-mono text-[10px] text-slate-400">öncelik {analysis.triage.score.toFixed(2)}</span></div>
                    <p className="mt-1 text-[11px] leading-snug text-slate-300">{analysis.triage.note}</p>
                  </div>
                )}
                {p.hasMasks && (
                  <label className="flex items-center gap-2 text-[11px] text-slate-300">AI maske örtüsü
                    <input type="range" min={0} max={0.8} step={0.05} value={p.overlayOpacity} onChange={(e) => p.setOverlayOpacity(Number(e.target.value))} className="flex-1" />
                    <span className="w-8 font-mono text-cyan-300">{Math.round(p.overlayOpacity * 100)}%</span>
                  </label>
                )}
              </>
            )}

            {revealed.length > 0 && (
              <div className="flex flex-col gap-2">
                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{analysis?.engine === "image-review" ? "Temsilî kareler / inceleme noktaları" : "Bulgular"} ({revealed.length})</div>
                {revealed.map((f) => {
                  const sv = SEV[f.severity];
                  const here = p.currentSlice >= f.sliceStart && p.currentSlice <= f.sliceEnd;
                  const peak = p.currentSlice === f.sliceIndex;
                  const delta = priorDelta(f, priors);
                  return (
                    <div key={f.id} className={`rounded-xl border p-3 ${peak ? "bg-[#111927] ring-2 ring-cyan-400" : here ? "bg-[#0e1622] ring-1 ring-cyan-500/60" : "bg-[#0b1018]"}`} style={{ borderColor: peak ? "#22d3ee" : `${sv.color}55` }}>
                      <div className="flex items-center justify-between gap-2 border-b border-[#1f2937] pb-2">
                        <div className="flex items-center gap-1.5">
                          <span className="rounded border border-cyan-500/50 bg-cyan-950 px-2 py-0.5 font-mono text-xs font-black text-cyan-300">KESİT {f.keySliceNumber}</span>
                          <span className="font-mono text-[10px] text-slate-400">({f.sliceRangeStr})</span>
                        </div>
                        <span className="rounded px-2 py-0.5 font-mono text-[9px] font-black" style={{ color: sv.color, background: sv.bg, border: `1px solid ${sv.color}66` }}>{f.category === "Sistem" ? "BİLGİ" : sv.label}</span>
                      </div>
                      <div className="mt-2 text-xs font-bold text-slate-100">{f.label}</div>
                      {f.category !== "Sistem" && <div className="mt-0.5 text-[10px] font-medium text-cyan-300/90">📍 {f.anatomicalLocation}</div>}
                      <p className="mt-1.5 rounded border border-[#1a2332] bg-[#080c12]/80 p-2 text-[11px] leading-relaxed text-slate-300">{f.detail}</p>
                      {f.category !== "Sistem" && (
                        <div className="mt-2 grid grid-cols-2 gap-1 border-t border-[#1a2332] pt-1.5 font-mono text-[9.5px] text-slate-400">
                          <div><span className="text-slate-500">Dansite/sinyal: </span><span className="font-semibold text-slate-200">{f.densityOrSignal}</span></div>
                          <div><span className="text-slate-500">Boyut: </span><span className="font-semibold text-slate-200">{f.sizeMmStr}</span></div>
                          {f.metrics?.volumeMl !== undefined && <div><span className="text-slate-500">Hacim: </span><span className="font-semibold text-slate-200">{f.metrics.volumeMl} mL</span></div>}
                          {f.metrics?.lungRads && <div><span className="text-slate-500">Lung-RADS eşiği: </span><span className="font-semibold text-slate-200">{f.metrics.lungRads}</span></div>}
                          {fmtConf(f) && <div className="col-span-2"><span className="text-slate-500">Güven: </span><span className="font-semibold text-slate-200">{fmtConf(f)}</span></div>}
                        </div>
                      )}
                      {delta && <div className="mt-1.5 rounded border border-violet-400/30 bg-violet-400/5 p-1.5 text-[10px] text-violet-200">↺ {delta}</div>}
                      {f.category !== "Sistem" && (
                        <div className="mt-2.5 flex items-center justify-between">
                          {peak ? <span className="flex items-center gap-1 rounded border border-cyan-500/40 bg-cyan-950/60 px-2 py-0.5 text-[10px] font-bold text-cyan-300"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400" />Şu anki kesitte</span> : <span className="text-[9.5px] text-slate-500">z {f.zLocationMm !== undefined ? `${f.zLocationMm > 0 ? "+" : ""}${f.zLocationMm} mm` : "—"}</span>}
                          <button onClick={() => p.onGotoFinding(f)} className="cursor-pointer rounded bg-cyan-500 px-3 py-1 text-[11px] font-bold text-slate-950 hover:bg-cyan-400">Kesit {f.keySliceNumber}&apos;e git ⤴</button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {status === "done" && analysis && (
              <button onClick={p.onOpenReportModal} className="cursor-pointer rounded-lg border border-cyan-400/40 bg-gradient-to-r from-cyan-500/20 to-emerald-500/20 p-2.5 text-xs font-bold text-cyan-200 hover:border-cyan-400">📄 Raporu aç (doğrula / onayla / yazdır)</button>
            )}
            {status === "done" && analysis && p.mode === "ayirici" && (
              <div className="rounded-lg border border-[#1e2735] bg-[#0e141d] p-3">
                <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">Ayırıcı tanı (bilgi amaçlı)</div>
                {analysis.differentials.length === 0 && <p className="text-[11px] text-slate-400">Bu seri için üretilemedi.</p>}
                {analysis.differentials.map((d) => (
                  <div key={d.dx} className="mb-2">
                    <div className="flex items-center justify-between text-[11px]"><span className="font-semibold text-slate-200">{d.dx}</span><span className="font-mono text-cyan-300">~%{Math.round(d.probability * 100)}</span></div>
                    <div className="mt-0.5 h-1 overflow-hidden rounded bg-[#13202b]"><div className="h-full bg-cyan-400/70" style={{ width: `${d.probability * 100}%` }} /></div>
                    <p className="mt-0.5 text-[10px] text-slate-400">{d.rationale}</p>
                  </div>
                ))}
                <p className="text-[10px] text-slate-500">Olasılıklar bilgi amaçlı kabaca değerlerdir; kalibre edilmiş model çıktısı değildir.</p>
              </div>
            )}
            {status === "done" && analysis && p.mode === "hasta" && (
              <div className="rounded-lg border border-emerald-400/25 bg-emerald-400/5 p-3"><div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-emerald-300">Hasta dostu özet</div><p className="text-[11.5px] leading-relaxed text-slate-200">{analysis.patientSummary}</p></div>
            )}
            {!series && <p className="mt-4 text-center text-xs text-slate-500">Önce bir seri açın.</p>}
          </div>
        )}

        {tab === "rapor" && (
          <div className="flex flex-col gap-2.5">
            <div className={`flex items-center justify-between rounded-lg border p-2.5 ${p.currentReportStatus === "onaylandi" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-rose-500/40 bg-rose-500/10 text-rose-300"}`}>
              <div className="text-xs font-bold">{p.currentReportStatus === "onaylandi" ? "✓ ONAYLI · KİLİTLİ" : "⚠ ONAYLANMAMIŞ TASLAK"}</div>
              <button onClick={p.onOpenReportModal} className="cursor-pointer rounded bg-cyan-500 px-2.5 py-1 text-[11px] font-bold text-slate-950 hover:bg-cyan-400">{p.currentReportStatus === "onaylandi" ? "İncele / addendum" : "Aç / onayla"}</button>
            </div>
            {analysis ? (
              <pre className="whitespace-pre-wrap rounded-lg border border-[#1e2735] bg-[#080c12] p-3 font-mono text-[10.5px] leading-relaxed text-slate-200">{`TEKNİK\n${analysis.technique}\n\nBULGULAR\n${analysis.findingsText}\n\nSONUÇ/İZLENİM\n${analysis.impression}\n\nÖNERİ\n${analysis.recommendation}`}</pre>
            ) : <p className="mt-4 text-center text-xs text-slate-500">Rapor için önce analiz çalıştırın veya raporu boş şablonla açın.</p>}
            {!analysis && <button onClick={p.onOpenReportModal} className="cursor-pointer rounded border border-cyan-400/40 px-3 py-2 text-xs font-bold text-cyan-300">📄 Raporu aç</button>}
          </div>
        )}

        {tab === "olcum" && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between"><span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Ölçümler ({p.annotations.length})</span>{p.annotations.length > 0 && <button onClick={p.onClearAnnotations} className="cursor-pointer text-[10px] text-rose-400 hover:underline">Tümünü sil</button>}</div>
            {p.annotations.length === 0 && <p className="text-[11px] text-slate-500">Araç çubuğundan uzunluk, açı, ROI, ok vb. seçip görüntü üzerinde çizin. Ölçümler çalışmayla birlikte sunucuya kaydedilir ve rapora eklenir.</p>}
            {[...p.annotations].sort((a, b) => a.slice - b.slice).map((a) => (
              <div key={a.id} className="flex items-start gap-2 rounded-lg border border-[#1e2735] bg-[#0e141d] p-2 text-[11px]">
                <button onClick={() => p.onGotoSlice(a.slice)} className="cursor-pointer rounded border border-cyan-500/40 bg-cyan-950 px-1.5 py-0.5 font-mono text-[10px] font-bold text-cyan-300">K{a.slice + 1}</button>
                <div className="min-w-0 flex-1"><div className="font-semibold text-slate-200">{KIND_LABEL[a.kind]}</div><div className="font-mono text-[10.5px] text-slate-400">{annotationSummary(a, p.pxMm, unit, series?.suv?.factor)}</div></div>
                <button onClick={() => p.onDeleteAnnotation(a.id)} className="cursor-pointer text-slate-500 hover:text-rose-400" title="Sil">✕</button>
              </div>
            ))}
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Anahtar kesitler ({p.keyImages.length})</div>
            {p.keyImages.length === 0 && <p className="text-[11px] text-slate-500">Araç çubuğundaki ★ ile geçerli kesiti anahtar kesit olarak ekleyin (rapora en fazla 4 tanesi girer).</p>}
            <div className="grid grid-cols-2 gap-2">
              {p.keyImages.map((k) => (
                <div key={k.id} className="relative overflow-hidden rounded-lg border border-[#1e2735] bg-black">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={k.dataUrl} alt={`Kesit ${k.slice + 1}`} className="aspect-square w-full cursor-pointer object-contain" onClick={() => p.onGotoSlice(k.slice)} />
                  <div className="flex items-center justify-between bg-[#0b0f16] px-1.5 py-1 text-[10px] text-slate-300"><span>Kesit {k.slice + 1}{k.note ? ` · ${k.note}` : ""}</span><button onClick={() => p.onRemoveKeyImage(k.id)} className="cursor-pointer text-slate-500 hover:text-rose-400">✕</button></div>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === "dicom" && (
          !series ? <p className="mt-6 text-center text-xs text-slate-500">Önce bir görüntü açın.</p> : (
            <table className="w-full border-collapse font-mono text-[10.5px]">
              <thead><tr className="text-left text-slate-400"><th className="border-b border-[#1e2735] py-1.5 pr-2">Tag</th><th className="border-b border-[#1e2735] py-1.5 pr-2">Ad</th><th className="border-b border-[#1e2735] py-1.5">Değer</th></tr></thead>
              <tbody>
                {series.tags.map((t, i) => (
                  <tr key={i} className="hover:bg-[#101722]"><td className="border-b border-[#141b26] py-1 pr-2 text-cyan-400/80">{t.tag}</td><td className="border-b border-[#141b26] py-1 pr-2 text-slate-400">{t.name}</td><td className="max-w-[140px] truncate border-b border-[#141b26] py-1 text-slate-200" title={t.value}>{t.value}</td></tr>
                ))}
              </tbody>
            </table>
          )
        )}

        {tab === "gecmis" && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between"><span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Bu hastanın çalışmaları ({p.priorStudies.length})</span><button onClick={p.onRefreshReports} className="cursor-pointer text-[10px] text-cyan-400">⟳ yenile</button></div>
            {p.priorStudies.length === 0 && <p className="text-[11px] text-slate-500">Sunucuya kayıtlı başka çalışma yok. (Çalışma Listesi → ☁ Sunucuya kaydet ile geçmiş oluşur.)</p>}
            {p.priorStudies.map((s) => (
              <div key={s.id} className="rounded-lg border border-[#1e2735] bg-[#0e141d] p-2 text-[11px]">
                <div className="font-bold text-slate-100">{s.modality} · {s.seriesDescription}</div>
                <div className="text-slate-400">{s.studyDate} · {s.sliceCount} kesit · {s.workStatus}</div>
                {s.hasFiles ? <button onClick={() => p.onOpenPrior(s)} className="mt-1.5 cursor-pointer rounded bg-violet-500/20 px-2 py-0.5 text-[10.5px] font-bold text-violet-200 hover:bg-violet-500/30">Karşılaştırma panelinde aç</button> : <span className="mt-1 block text-[10px] text-slate-500">Görüntüler sunucuda yok</span>}
              </div>
            ))}
            <div className="mt-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">Raporlar ({p.patientReports.length})</div>
            {p.patientReports.map((r) => (
              <div key={r.id} className="rounded-lg border border-[#1e2735] bg-[#0e141d] p-2.5">
                <div className="flex items-center justify-between"><span className="text-xs font-bold text-slate-100">#{r.id} · {r.modality} — {r.seriesDescription}</span><span className={`rounded px-1.5 py-0.5 text-[9px] font-black ${r.status === "onaylandi" ? "border border-emerald-500/30 bg-emerald-500/20 text-emerald-300" : "border border-rose-500/30 bg-rose-500/20 text-rose-300"}`}>{r.status === "onaylandi" ? "ONAYLI" : "TASLAK"} v{r.version}</span></div>
                <div className="mt-1 text-[10px] text-slate-400">{new Date(r.createdAt).toLocaleString("tr-TR")}{r.approvedBy ? ` · ${r.approvedBy}` : ""}</div>
                <button onClick={() => p.onOpenSaved(r.id)} className="mt-2 cursor-pointer rounded border border-cyan-500/40 bg-cyan-500/20 px-2.5 py-1 text-[10.5px] font-bold text-cyan-300 hover:bg-cyan-500/30">🖨 Aç / yazdır</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
