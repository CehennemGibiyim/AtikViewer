"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { fmtConf } from "@/lib/format";
import type {
  Finding, FindingApprovalStatus, KeyImage, ModelCard, ReportAddendum, ReportVersion, TemplateRow, UserInfo,
} from "@/lib/types";

export interface ReportData {
  id?: number;
  status: "taslak" | "onaylandi";
  version?: number;
  studyUid: string;
  patientName: string;
  patientId: string;
  patientAge: string;
  patientSex: string;
  studyDate: string;
  modality: string;
  bodyPart: string;
  seriesDescription: string;
  institution: string;
  sliceCount: number;
  technique: string;
  findingsText: string;
  impression: string;
  recommendation: string;
  clinicalInfo: string;
  findings: Finding[];
  findingsApproval: Record<string, FindingApprovalStatus>;
  engine: string;
  aiModel: string;
  modelCard: string;
  triageLevel: string;
  triageScore: number;
  approvedBy: string;
  doctorTitle: string;
  doctorRegNo: string;
  approvedAt: string | null;
  contentHash?: string;
  keyImageDataUrl: string;
  keyImages: KeyImage[];
  measurementsText: string;
  createdAt: string;
}

export type SaveResult = { ok: boolean; error?: string; data?: Partial<ReportData> };

interface Props {
  open: boolean;
  onClose: () => void;
  report: ReportData;
  user: UserInfo;
  onSave: (r: ReportData, action: "save" | "approve") => Promise<SaveResult>;
  onGotoSlice?: (sliceNumber: number) => void;
}

// ───────── Web Speech API (Türkçe dikte) ─────────
interface SpeechRec {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null; onerror: (() => void) | null; start(): void; stop(): void;
}
type SpeechCtor = new () => SpeechRec;

function postProcess(t: string): string {
  return t
    .replace(/\s*\byeni satır\b\s*/gi, "\n")
    .replace(/\s*\biki nokta üst üste\b/gi, ":")
    .replace(/\s*\bvirgül\b/gi, ",")
    .replace(/\s*\bnokta\b/gi, ".");
}

function MicButton({ onText }: { onText: (t: string) => void }) {
  const [on, setOn] = useState(false);
  const rec = useRef<SpeechRec | null>(null);
  const toggle = () => {
    if (on) { rec.current?.stop(); return; }
    const w = window as unknown as { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor };
    const C = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!C) { alert("Bu tarayıcı konuşma tanımayı desteklemiyor (Chrome/Edge önerilir)."); return; }
    const r = new C();
    r.lang = "tr-TR"; r.continuous = true; r.interimResults = false;
    r.onresult = (e) => {
      let s = "";
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) s += e.results[i][0].transcript;
      if (s) onText(postProcess(s.trim()) + " ");
    };
    r.onend = () => setOn(false);
    r.onerror = () => setOn(false);
    rec.current = r;
    r.start();
    setOn(true);
  };
  return (
    <button type="button" onClick={toggle} title="Sesle dikte (Türkçe). Komutlar: nokta, virgül, yeni satır" className={`ml-2 rounded px-1.5 text-[10px] font-bold ${on ? "animate-pulse bg-rose-500 text-white" : "bg-slate-200 text-slate-700 hover:bg-slate-300"}`}>
      {on ? "● dinliyor" : "🎤 dikte"}
    </button>
  );
}

const STATUS_TR: Record<FindingApprovalStatus, string> = { onaylandi: "✓ Radyolog onayladı", reddedildi: "✗ Reddedildi", duzenlendi: "✎ Düzenlendi", bekliyor: "Onay bekliyor" };

export default function ReportPrintModal({ open, onClose, report: initial, user, onSave, onGotoSlice }: Props) {
  const [report, setReport] = useState<ReportData>(initial);
  const [editing, setEditing] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [versions, setVersions] = useState<ReportVersion[]>([]);
  const [addenda, setAddenda] = useState<ReportAddendum[]>([]);
  const [addText, setAddText] = useState("");
  const [showVersions, setShowVersions] = useState(false);

  useEffect(() => { setReport(initial); setError(""); setEditing(false); }, [initial, open]);

  const loadDetail = async (id: number) => {
    const r = await fetch(`/api/reports/${id}`);
    if (!r.ok) return;
    const d = (await r.json()) as { versions: ReportVersion[]; addenda: ReportAddendum[] };
    setVersions(d.versions);
    setAddenda(d.addenda);
  };
  useEffect(() => {
    if (!open) return;
    fetch("/api/templates").then((r) => (r.ok ? r.json() : [])).then((t: TemplateRow[]) => setTemplates(t)).catch(() => {});
  }, [open]);
  useEffect(() => { if (open && report.id) void loadDetail(report.id); else { setVersions([]); setAddenda([]); } }, [open, report.id, report.version]);

  const card = useMemo<ModelCard | null>(() => { try { return report.modelCard ? (JSON.parse(report.modelCard) as ModelCard) : null; } catch { return null; } }, [report.modelCard]);

  if (!open) return null;
  const approved = report.status === "onaylandi";
  const canWrite = true;
  const pending = report.findings.filter((f) => (report.findingsApproval[f.id] ?? "bekliyor") === "bekliyor").length;
  const set = <K extends keyof ReportData>(k: K, v: ReportData[K]) => setReport((r) => ({ ...r, [k]: v }));
  const append = (k: "technique" | "findingsText" | "impression" | "recommendation") => (t: string) => setReport((r) => ({ ...r, [k]: (r[k] + (r[k] && !r[k].endsWith(" ") && !r[k].endsWith("\n") ? " " : "") + t).trimStart() }));

  const cycle = (id: string) => {
    const order: FindingApprovalStatus[] = ["bekliyor", "onaylandi", "reddedildi", "duzenlendi"];
    const cur = report.findingsApproval[id] ?? "bekliyor";
    set("findingsApproval", { ...report.findingsApproval, [id]: order[(order.indexOf(cur) + 1) % order.length] });
  };

  const save = async (action: "save" | "approve") => {
    setBusy(true); setError("");
    const res = await onSave(report, action);
    setBusy(false);
    if (!res.ok) { setError(res.error ?? "İşlem başarısız"); return; }
    if (res.data) setReport((r) => ({ ...r, ...res.data }));
    setDialog(false); setEditing(false);
  };

  const applyTemplate = (id: string) => {
    const t = templates.find((x) => String(x.id) === id);
    if (!t) return;
    setReport((r) => ({ ...r, technique: t.technique || r.technique, findingsText: t.findings || r.findingsText, impression: t.impression || r.impression, recommendation: t.recommendation || r.recommendation }));
  };
  const saveTemplate = async () => {
    const name = window.prompt("Şablon adı", `${report.modality} ${report.bodyPart} — özel`);
    if (!name) return;
    const r = await fetch("/api/templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, modality: report.modality, bodyPart: report.bodyPart, technique: report.technique, findings: report.findingsText, impression: report.impression, recommendation: report.recommendation }) });
    if (r.ok) fetch("/api/templates").then((x) => x.json()).then((t: TemplateRow[]) => setTemplates(t));
  };
  const draftImpression = async () => {
    setBusy(true); setError("");
    const r = await fetch("/api/reports/draft-impression", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modality: report.modality, bodyPart: report.bodyPart, findings: report.findings.map((f) => ({ label: f.label, detail: f.detail, slice: f.keySliceNumber, category: f.category, severity: f.severity, status: report.findingsApproval[f.id] ?? "bekliyor" })) }),
    });
    setBusy(false);
    const d = (await r.json()) as { text?: string; source?: string; error?: string };
    if (!r.ok || !d.text) { setError(d.error ?? "Taslak üretilemedi"); return; }
    set("impression", `${d.text}\n[Taslak — ${d.source === "llm" ? "LLM" : "kural tabanlı"}; hekim doğrulaması gerekir]`);
  };
  const addMissed = () => {
    const label = window.prompt("AI'nın kaçırdığı bulgu (kısa ad)");
    if (!label) return;
    const slice = Number(window.prompt("Kesit numarası", "1") ?? "1") || 1;
    const f: Finding = {
      id: `m${Date.now()}`, sliceIndex: slice - 1, sliceStart: slice - 1, sliceEnd: slice - 1, keySliceNumber: slice, sliceRangeStr: `Kesit ${slice}`,
      anatomicalLocation: "Hekim girişi", densityOrSignal: "—", sizeMmStr: "—", bbox: null, label, detail: "Radyolog tarafından eklenen bulgu (AI tarafından saptanmadı).",
      category: "Hekim", severity: "orta", confidence: 0, confidenceKind: "none", source: "manual",
    };
    setReport((r) => ({ ...r, findings: [...r.findings, f], findingsApproval: { ...r.findingsApproval, [f.id]: "onaylandi" }, findingsText: `${r.findingsText}\n\n+ ${label} [Kesit ${slice}] (radyolog eklemesi)` }));
  };

  /** FHIR dosyasını fetch ile alıp indirir (sunucuda da, statik demoda da çalışır). */
  const downloadFhir = async (id: number) => {
    try {
      const r = await fetch(`/api/reports/${id}/fhir`);
      if (!r.ok) throw new Error(((await r.json()) as { error?: string }).error ?? "FHIR dışa aktarılamadı");
      const blob = new Blob([await r.text()], { type: "application/fhir+json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `rapor-${id}.fhir.json`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch (e) { setError(e instanceof Error ? e.message : "FHIR dışa aktarılamadı"); }
  };

  /**
   * Yazdırma: rapor kâğıdı, uygulama düzeninin (sabit yükseklik/overflow) dışında,
   * body'nin doğrudan çocuğu olan geçici bir #print-root içine kopyalanır; böylece
   * tarayıcı yazdırma önizlemesi boş sayfa yerine raporun tamamını (çok sayfa) basar.
   */
  const printReport = () => {
    const paper = document.getElementById("report-paper");
    if (!paper) { window.print(); return; }
    const clone = paper.cloneNode(true) as HTMLElement;
    // Düzenleme modundaki alanların değerleri kopyaya geçmez; düz metne çevrilir.
    const src = paper.querySelectorAll("textarea, input, select");
    clone.querySelectorAll("textarea, input, select").forEach((el, i) => {
      const v = (src[i] as HTMLInputElement | undefined)?.value ?? "";
      const span = document.createElement("div");
      span.style.whiteSpace = "pre-wrap";
      span.textContent = v;
      el.replaceWith(span);
    });
    const root = document.createElement("div");
    root.id = "print-root";
    root.appendChild(clone);
    document.body.appendChild(root);
    const cleanup = () => { root.remove(); window.removeEventListener("afterprint", cleanup); };
    window.addEventListener("afterprint", cleanup);
    // Görseller (anahtar kesit) yüklenmeden yazdırmayı başlatma
    const imgs = Array.from(root.querySelectorAll("img")).filter((im) => !im.complete);
    void Promise.all(imgs.map((im) => new Promise<void>((res) => { im.onload = im.onerror = () => res(); })))
      .then(() => setTimeout(() => window.print(), 50));
  };

  const addAddendum = async () => {
    if (!report.id || addText.trim().length < 3) return;
    setBusy(true);
    const r = await fetch(`/api/reports/${report.id}/addenda`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: addText }) });
    setBusy(false);
    if (r.ok) { setAddText(""); void loadDetail(report.id); } else setError(((await r.json()) as { error?: string }).error ?? "Addendum eklenemedi");
  };

  const linkify = (text: string) =>
    text.split(/(Kesit \d+)/g).map((part, i) => {
      const m = /^Kesit (\d+)$/.exec(part);
      return m && onGotoSlice ? (
        <button key={i} type="button" className="font-semibold text-[#0e7490] underline decoration-dotted print:no-underline" onClick={() => { onGotoSlice(Number(m[1])); onClose(); }}>{part}</button>
      ) : (<span key={i}>{part}</span>);
    });

  const Field = ({ name, k, rows }: { name: string; k: "technique" | "findingsText" | "impression" | "recommendation"; rows: number }) => (
    <div>
      <div className="flex items-center font-bold uppercase text-slate-900">{name}{editing && <MicButton onText={append(k)} />}</div>
      {editing ? <textarea value={report[k]} onChange={(e) => set(k, e.target.value)} rows={rows} className="mt-1 w-full rounded border border-slate-300 p-2 text-xs" /> : <p className="mt-0.5 whitespace-pre-wrap">{linkify(report[k])}</p>}
    </div>
  );

  const images = report.keyImages.length > 0 ? report.keyImages.slice(0, 4).map((k) => ({ src: k.dataUrl, cap: `Kesit ${k.slice + 1}${k.note ? ` · ${k.note}` : ""}` })) : report.keyImageDataUrl ? [{ src: report.keyImageDataUrl, cap: "Anahtar kesit" }] : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-2 backdrop-blur-sm sm:p-4 print:static print:z-auto print:bg-white print:p-0">
      <div className="flex h-full max-h-[96vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-[#232e40] bg-[#0d121a] shadow-2xl print:max-h-none print:h-auto print:border-none print:bg-white print:shadow-none">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[#1e2735] bg-[#0b0f16] px-4 py-3 print:hidden">
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs font-bold uppercase tracking-wider text-cyan-400">Radyoloji raporu</span>
            <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${approved ? "border-emerald-500/40 bg-emerald-500/20 text-emerald-400" : "border-rose-500/40 bg-rose-500/20 text-rose-300"}`}>
              {approved ? `✓ ONAYLANDI · v${report.version ?? 1} · KİLİTLİ` : "⚠ ONAYLANMAMIŞ TASLAK"}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!approved && canWrite && (
              <>
                <button onClick={() => setEditing(!editing)} className={`cursor-pointer rounded-lg px-3 py-1.5 text-xs font-bold ${editing ? "bg-amber-500 text-slate-950" : "border border-[#2d3b4e] bg-[#141b24] text-slate-200 hover:bg-[#1a2330]"}`}>{editing ? "Düzenlemeyi bitir" : "✎ Düzenle"}</button>
                <button disabled={busy} onClick={() => void save("save")} className="cursor-pointer rounded-lg border border-cyan-400/40 px-3 py-1.5 text-xs font-bold text-cyan-300 hover:bg-cyan-400/10 disabled:opacity-50">💾 Taslağı kaydet</button>
                <button onClick={() => setDialog(true)} className="cursor-pointer rounded-lg bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-1.5 text-xs font-bold text-slate-950 hover:from-emerald-400 hover:to-teal-400">✓ Onayla</button>
              </>
            )}
            {report.id && <button type="button" onClick={() => void downloadFhir(report.id!)} className="cursor-pointer rounded-lg border border-[#2d3b4e] bg-[#141b24] px-3 py-1.5 text-xs font-bold text-slate-200 hover:bg-[#1a2330]">FHIR ⬇</button>}
            <button onClick={printReport} className="cursor-pointer rounded-lg bg-cyan-500 px-3.5 py-1.5 text-xs font-bold text-slate-950 hover:bg-cyan-400">🖨 Yazdır / PDF</button>
            <button onClick={onClose} className="cursor-pointer rounded-lg border border-[#2d3b4e] bg-[#141b24] p-1.5 text-xs text-slate-400 hover:text-slate-100">✕</button>
          </div>
        </div>

        {(error || (!approved && canWrite && pending > 0)) && (
          <div className="shrink-0 space-y-1 border-b border-[#1e2735] bg-[#0b0f16] px-4 py-2 text-[11px] print:hidden">
            {error && <div className="font-semibold text-rose-300">⚠ {error}</div>}
            {!approved && pending > 0 && <div className="text-amber-300">{pending} bulgu henüz gözden geçirilmedi — tablodaki durum düğmesine tıklayarak Onayla/Reddet/Düzenlendi olarak işaretleyin. Onay için hepsi işaretlenmeli.</div>}
          </div>
        )}

        {editing && (
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[#1e2735] bg-[#0b0f16] px-4 py-2 text-xs print:hidden">
            <select defaultValue="" onChange={(e) => { applyTemplate(e.target.value); e.target.value = ""; }} className="rounded border border-[#1e2735] bg-[#0e141d] px-2 py-1 text-slate-200">
              <option value="" disabled>Şablon uygula…</option>
              {templates.filter((t) => !t.modality || t.modality === report.modality).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <button onClick={() => void saveTemplate()} className="rounded border border-[#2d3b4e] px-2 py-1 text-slate-200 hover:bg-[#1a2330]">Şablon olarak kaydet</button>
            <button disabled={busy} onClick={() => void draftImpression()} className="rounded border border-violet-400/40 px-2 py-1 font-bold text-violet-200 hover:bg-violet-400/10 disabled:opacity-50">✨ Taslak izlenim üret</button>
            <button onClick={addMissed} className="rounded border border-amber-400/40 px-2 py-1 font-bold text-amber-200 hover:bg-amber-400/10">＋ AI&apos;nın kaçırdığı bulgu</button>
            <span className="text-slate-500">Taslak izlenim yalnızca doğruladığınız bulgulara dayanır; hasta kimliği dışarı gönderilmez.</span>
          </div>
        )}

        <div className="flex-1 overflow-y-auto bg-[#070a0f] p-3 sm:p-6 print:overflow-visible print:bg-white print:p-0">
          <div id="report-paper" className="relative mx-auto min-h-[1050px] w-full max-w-[800px] rounded-sm bg-white p-8 text-slate-900 shadow-2xl sm:p-12 print:m-0 print:w-full print:max-w-none print:p-8 print:shadow-none" style={{ fontFamily: "'Segoe UI', Roboto, Helvetica, Arial, sans-serif" }}>
            <div className="pointer-events-none absolute inset-0 z-0 flex select-none items-center justify-center overflow-hidden">
              <div className={`-rotate-[32deg] whitespace-nowrap font-black uppercase tracking-[0.2em] ${approved ? "text-emerald-500/[0.05]" : "text-rose-500/[0.12]"}`} style={{ fontSize: approved ? 60 : 52 }}>{approved ? "ONAYLANDI" : "ONAYLANMAMIŞ TASLAK"}</div>
            </div>

            <div className="relative z-10 flex min-h-[960px] flex-col justify-between">
              <div>
                <div className="flex items-end justify-between border-b-[3px] border-[#0e7490] pb-2">
                  <h1 className="text-2xl font-black tracking-wider text-[#0e7490]">ATIKVIEWER</h1>
                  <div className="text-right">
                    <div className="text-xs font-black uppercase tracking-wider text-slate-800">Radyoloji raporu</div>
                    <div className="font-mono text-[11px] text-slate-600">{new Date(report.createdAt || Date.now()).toLocaleString("tr-TR")}</div>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-x-4 gap-y-2 border-b border-slate-200 pb-3 text-[11px]">
                  {([["Hasta adı", report.patientName], ["Hasta ID", report.patientId], ["Yaş", report.patientAge || "-"], ["Cinsiyet", report.patientSex || "-"], ["Çalışma tarihi", report.studyDate || "-"], ["Modalite", report.modality], ["Çalışma açıklaması", report.seriesDescription], ["Vücut bölgesi", report.bodyPart], ["Kurum", report.institution]] as const).map(([k, v]) => (
                    <div key={k}><span className="font-bold text-slate-900">{k}: </span><span className="text-slate-800">{v}</span></div>
                  ))}
                </div>

                <div className="mt-3">
                  {!approved ? (
                    <p className="text-[11.5px] font-bold text-[#b91c1c]">Bu rapor radyolog tarafından henüz onaylanmamıştır. Tanı amaçlı kullanılamaz.</p>
                  ) : (
                    <div className="rounded border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11.5px] font-bold text-emerald-800">
                      ✓ Radyolog tarafından onaylanmıştır. <span className="font-normal text-emerald-700">({report.doctorTitle} {report.approvedBy} · {report.approvedAt ? new Date(report.approvedAt).toLocaleString("tr-TR") : ""})</span>
                    </div>
                  )}
                  {report.engine === "simulated-sample" && <p className="mt-1 text-[10.5px] font-bold text-amber-700">DEMO: Bulgular örnek vakaya önceden tanımlanmış simülasyondur.</p>}
                </div>

                <div className="mt-5">
                  <h2 className="text-sm font-black uppercase tracking-wide text-[#0e7490]">Rapor</h2>
                  <div className="mt-1 h-0.5 w-full bg-slate-200" />
                  <div className="mt-3 grid grid-cols-1 items-start gap-5 md:grid-cols-12">
                    <div className="flex flex-col gap-3 text-[11.5px] leading-relaxed text-slate-800 md:col-span-8">
                      {report.clinicalInfo && <div><div className="font-bold uppercase text-slate-900">Klinik bilgi</div><p className="mt-0.5 whitespace-pre-wrap">{report.clinicalInfo}</p></div>}
                      <Field name="Teknik" k="technique" rows={3} />
                      <Field name="Kesit bazlı bulgular" k="findingsText" rows={8} />
                      <Field name="Sonuç/İzlenim" k="impression" rows={3} />
                      <Field name="Öneri" k="recommendation" rows={2} />
                      {report.measurementsText && <div><div className="font-bold uppercase text-slate-900">Ölçümler</div><p className="mt-0.5 whitespace-pre-wrap font-mono text-[10.5px]">{report.measurementsText}</p></div>}
                      <p className="mt-1 text-[10px] italic text-slate-500">{report.engine === "image-review" ? "Bu bölüm yalnızca gerçek piksellerden hesaplanan görüntü ölçümleridir; hastalık tanısı, normal sonuç veya acil triyaj değildir. Radyolog yorumu gerekir." : "Bu çıktı yapay zeka/kural tabanlı veya DEMO desteklidir; hekim doğrulaması gerekir."}</p>
                    </div>
                    <div className="flex flex-col items-center gap-2 md:col-span-4">
                      {images.length === 0 && <div className="flex h-40 w-full items-center justify-center rounded border border-dashed border-slate-300 text-[10px] text-slate-400">Anahtar kesit yok</div>}
                      {images.map((im, i) => (
                        <figure key={i} className="w-full max-w-[230px]">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={im.src} alt={im.cap} className="block aspect-square w-full rounded-md border-2 border-slate-900 bg-black object-contain" />
                          <figcaption className="mt-0.5 text-center font-mono text-[9.5px] font-bold text-slate-600">{im.cap}</figcaption>
                        </figure>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="mt-6">
                  <h2 className="text-sm font-black uppercase tracking-wide text-[#0e7490]">{report.engine === "image-review" ? "Kesit/kare bazlı görüntü ölçümleri (tanısal bulgu değildir)" : "AI aday bulguları / DEMO ve hekim doğrulaması"}</h2>
                  <div className="mt-1 h-0.5 w-full bg-slate-200" />
                  <table className="mt-2 w-full border-collapse text-[11px]">
                    <thead><tr className="border-b border-slate-300 text-left font-bold text-slate-600"><th className="w-[22%] py-1.5 pr-2">Bulgu / konum</th><th className="w-[18%] py-1.5 pr-2">Kesit</th><th className="w-[40%] py-1.5 pr-2">Açıklama / ölçüm</th><th className="w-[20%] py-1.5 text-right">Radyolog</th></tr></thead>
                    <tbody>
                      {report.findings.length === 0 && <tr><td colSpan={4} className="py-2 italic text-slate-500">Bulgu kaydı yok.</td></tr>}
                      {report.findings.map((f, i) => {
                        const st = report.findingsApproval[f.id] ?? (approved ? "onaylandi" : "bekliyor");
                        return (
                          <tr key={f.id} className="border-b border-slate-200 align-top">
                            <td className="py-2.5 pr-2 font-bold"><div>{i + 1}. {f.label}</div><div className="mt-0.5 text-[9.5px] font-normal text-slate-500">{f.anatomicalLocation}</div></td>
                            <td className="py-2.5 pr-2"><div className="font-bold text-[#0e7490]">{onGotoSlice && f.category !== "Sistem" ? <button type="button" className="underline decoration-dotted print:no-underline" onClick={() => { onGotoSlice(f.keySliceNumber); onClose(); }}>Kesit {f.keySliceNumber}</button> : `Kesit ${f.keySliceNumber}`}</div><div className="font-mono text-[10px] text-slate-600">{f.sliceRangeStr}</div>{f.zLocationMm !== undefined && <div className="font-mono text-[9px] text-slate-400">z {f.zLocationMm > 0 ? "+" : ""}{f.zLocationMm} mm</div>}</td>
                            <td className="py-2.5 pr-2 leading-snug text-slate-700"><div>{f.detail}</div><div className="mt-1 font-mono text-[9.5px] text-slate-500">{f.densityOrSignal} · {f.sizeMmStr}{fmtConf(f) ? ` · ${fmtConf(f)}` : ""}{f.metrics?.volumeMl !== undefined ? ` · V ${f.metrics.volumeMl} mL` : ""}{f.metrics?.lungRads ? ` · Lung-RADS ${f.metrics.lungRads} eşiği` : ""}</div></td>
                            <td className="py-2.5 text-right font-bold">
                              {!approved && canWrite ? (
                                <button type="button" onClick={() => cycle(f.id)} className={`cursor-pointer rounded border px-2 py-0.5 text-[10px] font-bold print:border-none ${st === "onaylandi" ? "border-emerald-300 bg-emerald-50 text-emerald-800" : st === "reddedildi" ? "border-rose-300 bg-rose-50 text-rose-800" : st === "duzenlendi" ? "border-amber-300 bg-amber-50 text-amber-800" : "border-slate-300 bg-slate-100 text-slate-700"}`}>{STATUS_TR[st]}</button>
                              ) : <span>{STATUS_TR[st]}</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {card && (
                  <div className="mt-4 rounded border border-slate-200 bg-slate-50 p-2.5 text-[10px] leading-snug text-slate-600">
                    <div className="font-bold text-slate-700">Yapay zeka yöntemi: {card.name} v{card.version}</div>
                    <div><b>Amaç:</b> {card.intendedUse}</div>
                    <div><b>Yöntem:</b> {card.method}</div>
                    <div><b>Sınırlılıklar:</b> {card.limitations.join(" · ")}</div>
                    <div><b>Klinik doğrulama:</b> {card.validation}</div>
                  </div>
                )}

                {addenda.length > 0 && (
                  <div className="mt-4">
                    <h2 className="text-sm font-black uppercase tracking-wide text-[#0e7490]">Ek raporlar (addendum)</h2>
                    <div className="mt-1 h-0.5 w-full bg-slate-200" />
                    {addenda.map((a) => (
                      <div key={a.id} className="mt-2 text-[11px] text-slate-800"><div className="font-mono text-[9.5px] text-slate-500">{new Date(a.createdAt).toLocaleString("tr-TR")} · {a.createdByName}</div><p className="whitespace-pre-wrap">{a.text}</p></div>
                    ))}
                  </div>
                )}
              </div>

              <div className="mt-12 pt-4">
                <div className="grid grid-cols-2 gap-8 text-[11.5px]">
                  <div>
                    <div className="font-bold text-slate-900">Raporlayan hekim:</div>
                    <div className="mt-1 font-semibold text-slate-800">{approved ? `${report.doctorTitle} ${report.approvedBy}` : "(onay bekleniyor)"}</div>
                    {approved && <div className="text-[10px] text-slate-600">Sicil/diploma: {report.doctorRegNo}</div>}
                    <div className="mt-6 w-48 border-b border-slate-400" />
                  </div>
                  <div>
                    <div className="font-bold text-slate-900">İmza / Kaşe:</div>
                    {approved ? (
                      <div className="mt-1 inline-block rounded border border-emerald-300 bg-emerald-50 p-1.5 font-mono text-[9.5px] text-emerald-800">
                        <div className="font-bold">✓ Yerel onay (kimlik doğrulaması yapılmadı)</div>
                        <div>SHA-256: {report.contentHash?.slice(0, 24)}…</div>
                        <div className="text-[9px] text-emerald-700">Kimlik doğrulanmamıştır; nitelikli elektronik imza (NES) değildir.</div>
                      </div>
                    ) : <div className="mt-1 text-[10px] italic text-slate-500">(onay bekleniyor)</div>}
                    <div className="mt-6 w-48 border-b border-slate-400" />
                  </div>
                </div>
                <div className="mt-6 border-t border-slate-200 pt-2 text-[9.5px] text-slate-500">Bu rapordaki yapay zeka destekli bölümler taslak niteliğindedir ve sorumlu hekim onayı gerektirir.</div>
              </div>
            </div>
          </div>

          <div className="mx-auto mt-4 max-w-[800px] space-y-3 print:hidden">
            {approved && canWrite && report.id && (
              <div className="rounded-lg border border-[#1e2735] bg-[#0b0f16] p-3">
                <div className="text-xs font-bold text-slate-200">Addendum ekle (onaylı rapor değiştirilemez; düzeltme ek olarak kaydedilir)</div>
                <textarea value={addText} onChange={(e) => setAddText(e.target.value)} rows={3} className="mt-2 w-full rounded border border-[#1e2735] bg-[#0e141d] p-2 text-xs text-slate-200" placeholder="Ek bulgu / düzeltme metni…" />
                <button disabled={busy || addText.trim().length < 3} onClick={() => void addAddendum()} className="mt-2 cursor-pointer rounded bg-cyan-500 px-3 py-1 text-xs font-bold text-slate-950 disabled:opacity-40">Addendum kaydet</button>
              </div>
            )}
            {report.id && (
              <div className="rounded-lg border border-[#1e2735] bg-[#0b0f16] p-3 text-xs text-slate-300">
                <button onClick={() => setShowVersions((v) => !v)} className="font-bold text-slate-200">{showVersions ? "▾" : "▸"} Sürüm geçmişi ({versions.length})</button>
                {showVersions && <ul className="mt-2 space-y-1 font-mono text-[10.5px]">{versions.map((v) => <li key={v.id}>v{v.versionNo} · {v.action} · {v.createdByName} · {new Date(v.createdAt).toLocaleString("tr-TR")}</li>)}</ul>}
              </div>
            )}
          </div>
        </div>
      </div>

      {dialog && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 p-4">
          <div className="w-full max-w-md rounded-xl border border-emerald-500/40 bg-[#0d141e] p-5 shadow-2xl">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-100">Raporu onayla</h3>
            <p className="mt-2 text-xs leading-relaxed text-slate-400">
              Onaylandıktan sonra rapor <b>kilitlenir</b>; değişiklik yalnızca addendum ile yapılır.
            </p>
            <div className="mt-3 rounded-md border border-[#232e40] bg-[#141b24] p-2.5 text-xs text-slate-200">
              <div className="font-bold">{user.title} {user.fullName}</div>
              <div className="text-slate-400">Sicil/diploma: {user.regNo || <span className="text-amber-300">tanımlı değil</span>}</div>
              <a href={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/yonetim`} className="mt-1 inline-block text-[11px] text-cyan-400 hover:underline">Hekim profilini düzenle →</a>
            </div>
            <p className="mt-3 rounded-md border border-amber-400/40 bg-amber-400/10 p-2.5 text-[11px] leading-relaxed text-amber-200">
              ⚠ Uygulamada oturum açma kapalıdır: bu onay <b>kimlik doğrulaması yapmaz</b>. Rapora yukarıdaki ad
              yazılır ve içerik SHA-256 ile mühürlenir; bu, nitelikli elektronik imza (NES) değildir.
            </p>
            {error && <div className="mt-2 text-xs font-semibold text-rose-300">{error}</div>}
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => { setDialog(false); setError(""); }} className="cursor-pointer rounded-lg border border-[#232e40] px-3.5 py-1.5 text-xs text-slate-300 hover:bg-[#1a2330]">İptal</button>
              <button disabled={busy || pending > 0 || !user.fullName.trim()} onClick={() => void save("approve")} className="cursor-pointer rounded-lg bg-emerald-500 px-4 py-1.5 text-xs font-bold text-slate-950 hover:bg-emerald-400 disabled:opacity-40">{busy ? "Onaylanıyor…" : "✓ Onayla ve kilitle"}</button>
            </div>
            {pending > 0 && <div className="mt-2 text-[11px] text-amber-300">{pending} bulgu gözden geçirilmedi.</div>}
          </div>
        </div>
      )}
    </div>
  );
}
