"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Viewport, { type OverlayData, type ScanState } from "./Viewport";
import RefPanel from "./RefPanel";
import RightPanel, { type FeedItem } from "./RightPanel";
import ReportPrintModal, { type ReportData, type SaveResult } from "./ReportPrintModal";
import WorklistModal from "./WorklistModal";
import NotificationsBell from "./NotificationsBell";
import VolumeView from "./VolumeView";
import SRViewer from "./SRViewer";
import PDFViewer from "./PDFViewer";
import ECGViewer from "./ECGViewer";
import HangingProtocolEditorModal from "./HangingProtocolEditorModal";
import ViewerErrorBoundary from "./ViewerErrorBoundary";
import FileSelectControl from "./FileSelectControl";
import { APP_BUILD } from "./ClientRecovery";
import ImportReportDialog, { type ImportReport } from "./ImportReportDialog";
import ExportImageDialog, { type ImageExport } from "./ExportImageDialog";
import { loadWindowPresets, writePreference } from "@/lib/browserPreferences";
import { assertNotAborted, withImportTimeout } from "@/lib/importOperation";
import { SAMPLE_CASE_INFOS, buildSampleCase } from "@/lib/sampleCases";
import { loadMedicalFiles, type ImportStats } from "@/lib/dicom";
import { resolveProtocol, runEngine } from "@/lib/ai/engine";
import { runImageReview } from "@/lib/ai/imageReview";
import { modelCardFor } from "@/lib/modelCards";
import { KIND_LABEL, annotationSummary } from "@/lib/geometry";
import { zipAnonymized } from "@/lib/dicomWrite";
import { findMatchingHangingProtocol, resolveHangingCellSeries } from "@/lib/hangingProtocols";
import type {
  AiMode, AiProtocol, AnalysisResult, Annotation, EngineKind, Finding, FindingApprovalStatus,
  HangingProtocolRule, ImageReview, KeyImage, Layout, Lesion, SavedReport, SeriesData, StudyRow, ToolName, UserInfo, WindowPreset,
} from "@/lib/types";

type Rot = 0 | 90 | 180 | 270;
const CELLS: Record<Layout, number> = { "1x1": 1, "1x2": 2, "2x1": 2, "2x2": 4, "1x3": 3, "3x1": 3, "2x3": 6, "3x2": 6 };
const GRID: Record<Layout, string> = {
  "1x1": "grid-cols-1 grid-rows-1",
  "1x2": "grid-cols-2 grid-rows-1",
  "2x1": "grid-cols-1 grid-rows-2",
  "2x2": "grid-cols-2 grid-rows-2",
  "1x3": "grid-cols-3 grid-rows-1",
  "3x1": "grid-cols-1 grid-rows-3",
  "2x3": "grid-cols-3 grid-rows-2",
  "3x2": "grid-cols-2 grid-rows-3",
};

const CT_PRESETS: WindowPreset[] = [
  { name: "Beyin", wl: 40, ww: 80 }, { name: "Akciğer", wl: -600, ww: 1500 }, { name: "Kemik", wl: 300, ww: 1500 },
  { name: "Yumuşak doku", wl: 50, ww: 350 }, { name: "Karaciğer", wl: 60, ww: 160 }, { name: "Mediasten", wl: 40, ww: 400 },
];

const TOOLS: { id: ToolName; label: string; hint: string }[] = [
  { id: "wl", label: "W/L", hint: "Sürükle: pencere/seviye" }, { id: "pan", label: "Kaydır", hint: "Sürükle: kaydır" },
  { id: "zoom", label: "Zoom", hint: "Sürükle: yakınlaştır" }, { id: "length", label: "Uzunluk", hint: "Sürükle: mm" },
  { id: "angle", label: "Açı", hint: "3 nokta" }, { id: "cobb", label: "Cobb", hint: "4 nokta: iki doğru arası açı" },
  { id: "rect", label: "Dikdörtgen", hint: "ROI istatistiği" }, { id: "ellipse", label: "Elips", hint: "ROI istatistiği" },
  { id: "polygon", label: "Çokgen", hint: "Noktalar, çift tık: bitir" }, { id: "arrow", label: "Ok", hint: "İşaret oku + not" },
  { id: "calib", label: "Kalibre", hint: "Bilinen uzunluğu çiz, mm gir" },
];

const ts = () => new Date().toLocaleTimeString("tr-TR", { hour12: false });
const uid = () => Math.random().toString(36).slice(2, 10);
const seriesKey = (s: SeriesData) => `${s.seriesUid ?? s.description}|${s.slices.length}`;
const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName);

function renderSlice(s: SeriesData, slice: number, wl: number, ww: number, invert: boolean, maxSide: number): HTMLCanvasElement {
  const W = s.width, H = s.height;
  const src = document.createElement("canvas");
  src.width = W; src.height = H;
  const ctx = src.getContext("2d")!;
  const img = ctx.createImageData(W, H);
  const u32 = new Uint32Array(img.data.buffer);
  const sliceIdx = Math.min(slice, s.slices.length - 1);
  const isColor = s.isColor && s.rgbaSlices && s.rgbaSlices[sliceIdx];

  if (isColor) {
    u32.set(s.rgbaSlices![sliceIdx]);
  } else {
    const sl = s.slices[sliceIdx];
    const lo = wl - ww / 2, k = 255 / Math.max(1, ww);
    for (let i = 0; i < sl.length; i++) {
      let g = (sl[i] - lo) * k;
      g = g < 0 ? 0 : g > 255 ? 255 : g;
      if (invert) g = 255 - g;
      const gi = g | 0;
      u32[i] = 0xff000000 | (gi << 16) | (gi << 8) | gi;
    }
  }

  ctx.putImageData(img, 0, 0);
  const sc = Math.min(1, maxSide / Math.max(W, H));
  if (sc >= 1) return src;
  const out = document.createElement("canvas");
  out.width = Math.round(W * sc); out.height = Math.round(H * sc);
  out.getContext("2d")!.drawImage(src, 0, 0, out.width, out.height);
  return out;
}

function lesionToFinding(l: Lesion, i: number, s: SeriesData): Finding {
  const peak = Math.round((l.sliceStart + l.sliceEnd) / 2);
  const N = s.slices.length;
  return {
    id: `sim${i + 1}`, sliceIndex: peak, sliceStart: l.sliceStart, sliceEnd: l.sliceEnd, keySliceNumber: peak + 1,
    sliceRangeStr: l.sliceStart === l.sliceEnd ? `Kesit ${l.sliceStart + 1}` : `Kesit ${l.sliceStart + 1} – ${l.sliceEnd + 1} (${l.sliceEnd - l.sliceStart + 1} kesitte)`,
    zLocationMm: Number(((peak - N / 2) * (s.sliceThickness || 5)).toFixed(1)),
    anatomicalLocation: l.anatomicalLocation ?? s.bodyPart, densityOrSignal: l.densityOrSignal ?? "—", sizeMmStr: l.sizeMmStr ?? "—",
    bbox: l.bbox, label: l.label, detail: l.detail, category: l.category, severity: l.severity,
    confidence: l.confidence, confidenceKind: "simulated", source: "simulated-sample",
  };
}

function Thumb({ series }: { series: SeriesData }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const src = renderSlice(series, Math.floor(series.slices.length / 2), series.defaultWL, series.defaultWW, false, 88);
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, 44, 44);
    ctx.drawImage(src, 0, 0, 44, 44);
  }, [series]);
  return <canvas ref={ref} width={44} height={44} className="shrink-0 rounded border border-[#232e40]" />;
}

function SeriesCard({ s, active, onClick }: { s: SeriesData; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`mb-1.5 flex w-full cursor-pointer items-center gap-2.5 rounded-lg border p-2 text-left transition-all ${active ? "border-cyan-400/60 bg-cyan-400/10" : "border-[#1e2735] bg-[#0e141d] hover:border-[#2c394d]"}`}>
      <Thumb series={s} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] font-black text-cyan-300">{s.modality}</span>
          <span className="font-mono text-[9px] font-bold text-slate-400">
            {s.specialType === "sr" ? "Yapısal Rapor" : s.specialType === "pdf" ? "PDF Rapor" : s.specialType === "ecg" ? "12-Kanal EKG" : `${s.slices.length} kesit`}
          </span>
        </div>
        <div className="truncate text-[11px] font-semibold text-slate-200" title={s.description}>{s.description}</div>
        <div className="truncate text-[9.5px] text-slate-400">{s.patientName}</div>
      </div>
    </button>
  );
}

const Btn = ({ on, onClick, children, title, disabled = false, tone = "cyan" }: { on?: boolean; onClick: () => void; children: React.ReactNode; title?: string; disabled?: boolean; tone?: "cyan" | "amber" | "emerald" | "violet" }) => {
  const t = { cyan: "bg-cyan-400/15 text-cyan-300 ring-1 ring-cyan-400/50", amber: "bg-amber-400/15 text-amber-300 ring-1 ring-amber-400/40", emerald: "bg-emerald-400/15 text-emerald-300 ring-1 ring-emerald-400/40", violet: "bg-violet-400/15 text-violet-300 ring-1 ring-violet-400/40" }[tone];
  return <button type="button" title={title} aria-pressed={on} disabled={disabled} onClick={onClick} className={`shrink-0 cursor-pointer rounded-md px-2.5 py-2 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 disabled:cursor-not-allowed disabled:opacity-40 ${on ? t : "text-slate-300 hover:bg-[#161e2b]"}`}>{children}</button>;
};

export default function Workstation({ user }: { user: UserInfo }) {
  // ───── Seriler ─────
  const [samples, setSamples] = useState<SeriesData[]>([]);
  const [samplesLoading, setSamplesLoading] = useState(true);
  const [sampleFailures, setSampleFailures] = useState<string[]>([]);
  const [loaded, setLoaded] = useState<SeriesData[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ count: number; total: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [toastMsg, setToastMsg] = useState("");

  // ───── Görünüm & Hanging Protocols ─────
  const [slice, setSlice] = useState(0);
  const [wl, setWl] = useState(40);
  const [ww, setWw] = useState(80);
  const [invert, setInvert] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [tool, setTool] = useState<ToolName>("wl");
  const [hoverVal, setHoverVal] = useState<number | null>(null);
  const [rotation, setRotation] = useState<Rot>(0);
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  const [cine, setCine] = useState(false);
  const [fps, setFps] = useState(9);
  const [presets, setPresets] = useState<WindowPreset[]>([]);
  const [layout, setLayout] = useState<Layout>("1x1");
  const [refIds, setRefIds] = useState<(string | null)[]>([null, null, null, null, null]);
  const [refWins, setRefWins] = useState<({ wl: number; ww: number } | undefined)[]>([undefined, undefined, undefined, undefined, undefined]);
  const [syncPanels, setSyncPanels] = useState(true);
  const [autoLayout, setAutoLayout] = useState(true);
  const [mpr, setMpr] = useState(false);
  const [showOverlays, setShowOverlays] = useState(true);
  const [hangingModalOpen, setHangingModalOpen] = useState(false);
  const [showSeriesPanel, setShowSeriesPanel] = useState(true);
  const [showRightPanel, setShowRightPanel] = useState(true);
  const [pngImage, setPngImage] = useState<ImageExport | null>(null);
  const closePng = useCallback(() => setPngImage(null), []);
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [importReport, setImportReport] = useState<ImportReport | null>(null);
  const [lastReport, setLastReport] = useState<ImportReport | null>(null);
  const closeImportReport = useCallback(() => setImportReport(null), []);
  const [savingFiles, setSavingFiles] = useState(false);
  const importRef = useRef<AbortController | null>(null);

  // ───── Ölçüm / Anahtar Kesit ─────
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [keyImages, setKeyImages] = useState<KeyImage[]>([]);
  const [pxOverride, setPxOverride] = useState<Record<string, number>>({});

  // ───── AI Durumu ─────
  const [status, setStatus] = useState<"idle" | "infer" | "scanning" | "done">("idle");
  const [mode, setMode] = useState<AiMode>("kapsamli");
  const [protocol, setProtocol] = useState<AiProtocol>("auto");
  const [clinicalNote, setClinicalNote] = useState("");
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [scan, setScan] = useState<ScanState | null>(null);
  const [activeFinding, setActiveFinding] = useState<string | null>(null);
  const [liveFindings, setLiveFindings] = useState<Finding[]>([]);
  const [masks, setMasks] = useState<OverlayData["masks"] | null>(null);
  const [overlayOpacity, setOverlayOpacity] = useState(0.35);
  const [engineNotes, setEngineNotes] = useState<string[]>([]);
  const runRef = useRef(0);

  // ───── Rapor & Modallar ─────
  const [reportOpen, setReportOpen] = useState(false);
  const [activeReport, setActiveReport] = useState<ReportData | null>(null);
  const [worklistOpen, setWorklistOpen] = useState(false);
  const [patientReports, setPatientReports] = useState<SavedReport[]>([]);
  const [priorStudies, setPriorStudies] = useState<StudyRow[]>([]);

  const all = useMemo(() => [...loaded, ...samples], [loaded, samples]);
  const series = all.find((s) => s.id === activeId) ?? null;
  const isImageSeries = !!series && (!series.specialType || series.specialType === "image") && series.slices.length > 0;
  const pxMm = series ? (pxOverride[series.id] ?? series.pixelSpacing) : 1;
  const resolved = series ? resolveProtocol(series, protocol) : "none";
  const reportStatus: "taslak" | "onaylandi" = activeReport && series && activeReport.studyUid === series.studyUid ? activeReport.status : "taslak";

  const toast = useCallback((m: string, ms = 5000) => {
    setToastMsg(m);
    if (ms) setTimeout(() => setToastMsg((c) => (c === m ? "" : c)), ms);
  }, []);

  const pushFeed = (text: string, kind: FeedItem["kind"] = "info") => setFeed((f) => [...f, { t: ts(), text, kind }]);

  useEffect(() => {
    const close = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setMpr(false); setHangingModalOpen(false); setWorklistOpen(false); setPngImage(null); setReportOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);

  // ───── Başlangıç Yüklemeleri ─────
  useEffect(() => {
    setPresets(loadWindowPresets());
    if (window.innerWidth < 900) setShowRightPanel(false);
    if (window.innerWidth < 640) setShowSeriesPanel(false);
    let cancelled = false;
    void (async () => {
      const built: SeriesData[] = [];
      const failed: string[] = [];
      for (const info of SAMPLE_CASE_INFOS) {
        // Her vaka ayrı turda: ağır bir örnek arayüzü bloke etmesin ve tek hata tüm listeyi sıfırlamasın.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        if (cancelled) return;
        try {
          const sample = buildSampleCase(info.id);
          if (!sample) throw new Error("vaka üretilemedi");
          built.push(sample);
          setSamples([...built]);
          if (built.length === 1) {
            setActiveId(sample.id);
            setSlice(Math.floor(sample.slices.length / 2));
            setWl(sample.defaultWL);
            setWw(sample.defaultWW);
          }
        } catch (error) {
          console.error(`Örnek vaka açılamadı: ${info.id}`, error);
          failed.push(`${info.title}: ${error instanceof Error ? error.message : "açılamadı"}`);
          setSampleFailures([...failed]);
        }
      }
      if (!cancelled) setSamplesLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const resetView = useCallback((s: SeriesData) => {
    setSlice(Math.floor(s.slices.length / 2));
    setWl(s.defaultWL);
    setWw(s.defaultWW);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setInvert(false);
    setRotation(0);
    setFlipH(false);
    setFlipV(false);
  }, []);

  // ───── Hanging Protocol Motoru Uygulama ─────
  const applyHangingProtocolRule = useCallback((rule: HangingProtocolRule, currentSeries: SeriesData, allAvailable: SeriesData[]) => {
    if (currentSeries.specialType && currentSeries.specialType !== "image") {
      toast("Bu nesne bir görüntü serisi değil. Düzen uygulamak için BT, MR veya grafi seçin.");
      return;
    }
    setLayout(rule.layout);
    const newRefIds: (string | null)[] = [null, null, null, null, null];
    const newRefWins: ({ wl: number; ww: number } | undefined)[] = [undefined, undefined, undefined, undefined, undefined];
    for (const cell of rule.cells) {
      const preset = CT_PRESETS.find((p) => p.name.toLowerCase() === cell.windowPreset?.toLowerCase());
      const window = cell.customWL ?? (preset ? { wl: preset.wl, ww: preset.ww } : undefined);
      if (cell.cellIndex === 0) {
        if (window) { setWl(window.wl); setWw(window.ww); }
      } else if (cell.cellIndex > 0 && cell.cellIndex <= 5) {
        const match = resolveHangingCellSeries(cell, currentSeries, allAvailable);
        newRefIds[cell.cellIndex - 1] = match?.id ?? null;
        newRefWins[cell.cellIndex - 1] = window;
      }
    }
    setRefIds(newRefIds);
    setRefWins(newRefWins);
    toast(`Düzen uygulandı: ${rule.name} (${rule.layout.replace("x", "×")})`, 4000);
  }, [toast]);

  const applyAutoLayout = useCallback((s: SeriesData, available: SeriesData[]) => {
    const matchedRule = findMatchingHangingProtocol(s, available);
    if (matchedRule) applyHangingProtocolRule(matchedRule, s, available);
    else {
      setLayout("1x1");
      setRefIds([null, null, null, null, null]);
      setRefWins([undefined, undefined, undefined, undefined, undefined]);
      toast(s.specialType && s.specialType !== "image"
        ? "Belge ve EKG nesneleri kendi görüntüleyicisinde açılır; otomatik ızgara yalnızca görüntü serilerine uygulanır."
        : "Bu incelemeye eşleşen protokol yok; tek panel kullanılıyor. Protokoller menüsünden özel düzen seçebilirsiniz.");
    }
  }, [applyHangingProtocolRule, toast]);

  const toggleAutoLayout = () => {
    const enabled = !autoLayout;
    setAutoLayout(enabled);
    if (!enabled) toast("Otomatik düzen kapatıldı; mevcut panel düzeni korunuyor.", 3500);
    else if (series) applyAutoLayout(series, all);
    else toast("Otomatik düzen açık. Bir görüntü serisi seçildiğinde uygulanacak.");
  };

  const requestMpr = () => {
    if (!series || !isImageSeries) { toast("MPR için önce çok kesitli bir BT veya MR görüntü serisi seçin."); return; }
    if (!["CT", "MR"].includes(series.modality) || series.isColor) { toast("MPR yalnızca gri tonlamalı, hacim oluşturan BT/MR serileri için kullanılabilir."); return; }
    if (series.slices.length < 3) { toast("MPR için aynı seride en az 3 kesit gerekir."); return; }
    setCine(false);
    setMpr(true);
  };

  const selectSeries = useCallback((s: SeriesData, siblings: SeriesData[] = []) => {
    runRef.current++;
    setActiveId(s.id);
    resetView(s);
    setAnnotations([]);
    setKeyImages([]);
    setStatus("idle");
    // Önceki seride elle seçilen BT/ölçüm protokolü yeni hastaya taşınmaz.
    setProtocol("auto");
    setAnalysis(null);
    setRevealed(new Set());
    setLiveFindings([]);
    setMasks(null);
    setEngineNotes([]);
    setFeed([]);
    setScan(null);
    setActiveFinding(null);
    setCine(false);
    setMpr(false);
    setPngImage(null);
    setHoverVal(null);
    setActiveReport(null);
    if (autoLayout) applyAutoLayout(s, [...siblings, ...all]);
  }, [resetView, autoLayout, applyAutoLayout, all]);

  // ───── Kalıcı Ölçüm & Anahtar Kesit ─────
  const stateKey = series ? `${series.studyUid}|${seriesKey(series)}` : "";
  const loadedKey = useRef("");
  useEffect(() => {
    if (!series) return;
    loadedKey.current = "";
    const key = stateKey;
    const controller = new AbortController();
    fetch(`/api/state?${new URLSearchParams({ studyUid: series.studyUid, seriesKey: seriesKey(series) })}`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { annotations: Annotation[]; keyImages: KeyImage[] } | null) => {
        if (controller.signal.aborted) return;
        if (d) { setAnnotations(Array.isArray(d.annotations) ? d.annotations : []); setKeyImages(Array.isArray(d.keyImages) ? d.keyImages : []); }
        loadedKey.current = key;
      })
      .catch(() => {});
    return () => controller.abort();
  }, [stateKey]);

  useEffect(() => {
    if (!series || loadedKey.current !== stateKey) return;
    const t = setTimeout(() => {
      fetch("/api/state", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ studyUid: series.studyUid, seriesKey: seriesKey(series), annotations, keyImages }) }).catch(() => {});
    }, 1200);
    return () => clearTimeout(t);
  }, [annotations, keyImages, stateKey, series]);

  // ───── Hasta Bağlamı / Önceki Tetkikler ─────
  const refreshContext = useCallback(async () => {
    if (!series) return;
    try {
      const [r, s] = await Promise.all([fetch(`/api/reports?patientId=${encodeURIComponent(series.patientId)}`), fetch("/api/studies")]);
      if (r.ok) setPatientReports((await r.json()) as SavedReport[]);
      if (s.ok) setPriorStudies(((await s.json()) as StudyRow[]).filter((x) => x.patientId === series.patientId && x.studyUid !== series.studyUid));
    } catch {}
  }, [series]);
  useEffect(() => { void refreshContext(); }, [refreshContext]);

  // ───── Cine & Kısayollar ─────
  useEffect(() => {
    if (!cine || !series || series.slices.length < 2) return;
    const iv = setInterval(() => setSlice((p) => (p + 1) % series.slices.length), 1000 / fps);
    return () => clearInterval(iv);
  }, [cine, series, fps]);

  const captureKey = useCallback(() => {
    if (!series || (series.specialType && series.specialType !== "image")) { toast("Anahtar kesit için bir görüntü serisi seçin."); return; }
    if (keyImages.length >= 8) { toast("En fazla 8 anahtar kesit"); return; }
    if (keyImages.some((k) => k.slice === slice)) { toast("Bu kesit zaten anahtar kesit"); return; }
    const note = (annotations.find((a) => a.slice === slice && a.kind === "arrow")?.text ?? "").slice(0, 40);
    const dataUrl = renderSlice(series, slice, wl, ww, invert, 320).toDataURL("image/jpeg", 0.85);
    setKeyImages((k) => [...k, { id: uid(), slice, note, dataUrl }].sort((a, b) => a.slice - b.slice));
    toast(`★ Kesit ${slice + 1} anahtar kesit olarak eklendi`, 2500);
  }, [series, keyImages, slice, wl, ww, invert, annotations, toast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!series || !isImageSeries || reportOpen || hangingModalOpen || worklistOpen || mpr || pngImage || isTyping(e.target) || e.ctrlKey || e.metaKey) return;
      if (e.key === "ArrowUp" || e.key === "ArrowLeft") setSlice((p) => Math.max(0, p - 1));
      else if (e.key === "ArrowDown" || e.key === "ArrowRight") setSlice((p) => Math.min(series.slices.length - 1, p + 1));
      else if (e.key === "r" || e.key === "R") setRotation((r) => ((r + 90) % 360) as Rot);
      else if (e.key === "h" || e.key === "H") setFlipH((v) => !v);
      else if (e.key === "v" || e.key === "V") setFlipV((v) => !v);
      else if (e.key === "k" || e.key === "K") captureKey();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [series, captureKey, isImageSeries, reportOpen, hangingModalOpen, worklistOpen, mpr, pngImage]);

  // ───── Dosya / Klasör / PACS ─────
  const beginImport = useCallback(() => {
    importRef.current?.abort();
    const controller = new AbortController();
    importRef.current = controller;
    setImportWarnings([]);
    return controller;
  }, []);

  const cancelImport = useCallback(() => {
    importRef.current?.abort();
    importRef.current = null;
    setProgress(null);
    toast("Yükleme iptal edildi. Menüleri kullanmaya devam edebilirsiniz.");
  }, [toast]);

  useEffect(() => () => importRef.current?.abort(), []);

  const processFiles = useCallback(async (files: FileList | File[] | null, existing?: AbortController, source: ImportReport["source"] = "dosya") => {
    const arr = Array.from(files ?? []);
    const emptyStats = (): ImportStats => ({ total: 0, skippedNonMedical: 0, dicom: 0, images: 0, unreadable: 0, noPixel: 0, unsupported: {}, failed: {}, seriesOpened: 0, ms: 0 });
    if (arr.length === 0) {
      const r: ImportReport = { stats: emptyStats(), warnings: [], source };
      setImportReport(r); setLastReport(r);
      return;
    }
    const controller = existing ?? beginImport();
    if (controller.signal.aborted) return;
    setProgress({ count: 0, total: arr.length });
    toast(`${arr.length} dosya alındı — hasta görüntüleri okunuyor…`, 0);
    let stats: ImportStats | null = null;
    try {
      const warns: string[] = [];
      const parsed = await loadMedicalFiles(arr, (c, t) => {
        if (importRef.current === controller && !controller.signal.aborted) setProgress({ count: c, total: t });
      }, (w) => warns.push(w), { signal: controller.signal, onStats: (st) => { stats = st; } });
      if (controller.signal.aborted || importRef.current !== controller) return;
      setImportWarnings(warns);
      const report: ImportReport = { stats: stats ?? { ...emptyStats(), total: arr.length, seriesOpened: parsed.length }, warnings: warns, source };
      setLastReport(report);
      if (parsed.length === 0) { setToastMsg(""); setImportReport(report); return; }
      const st = report.stats;
      // Bazı seriler açıldı ama bir kısmı çözülemediyse sessiz kalma: raporu kendiliğinden göster.
      if (Object.keys(st.failed).length || Object.keys(st.unsupported).length) setImportReport(report);
      setLoaded((prev) => [...parsed, ...prev]);
      const sorted = [...parsed].sort((a, b) => b.slices.length - a.slices.length);
      selectSeries(sorted[0], parsed);
      toast(`${arr.length} dosyadan ${parsed.length} seri açıldı${warns.length ? "; bazı dosyalar atlandı — ayrıntı için seri listesindeki “Yükleme raporu”." : "."}`, 6000);
    } catch (e) {
      setToastMsg("");
      if (!controller.signal.aborted && importRef.current === controller) {
        const r: ImportReport = { stats: { ...emptyStats(), total: arr.length }, warnings: [`Yükleme başarısız: ${e instanceof Error ? e.message : "dosya okunamadı"}`], source };
        setImportReport(r); setLastReport(r);
      }
    } finally {
      if (importRef.current === controller) { importRef.current = null; setProgress(null); }
    }
  }, [selectSeries, beginImport, toast]);

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const items = e.dataTransfer.items;
    if (!items?.length) return void processFiles(e.dataTransfer.files, undefined, "sürükle-bırak");
    const files: File[] = [];
    const walk = async (entry: FileSystemEntry): Promise<void> => {
      if (entry.isFile) await new Promise<void>((res) => (entry as FileSystemFileEntry).file((f) => { files.push(f); res(); }, () => res()));
      else if (entry.isDirectory) {
        const rd = (entry as FileSystemDirectoryEntry).createReader();
        for (;;) {
          const ents = await new Promise<FileSystemEntry[]>((res) => rd.readEntries((x) => res(x), () => res([])));
          if (!ents.length) break;
          for (const en of ents) await walk(en);
        }
      }
    };
    const jobs: Promise<void>[] = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const en = typeof it.webkitGetAsEntry === "function" ? it.webkitGetAsEntry() : null;
      if (en) jobs.push(walk(en)); else { const f = it.getAsFile(); if (f) files.push(f); }
    }
    await Promise.all(jobs);
    void processFiles(files, undefined, "sürükle-bırak");
  };

  const ensureStudy = useCallback(async (s: SeriesData): Promise<number | null> => {
    try {
      const r = await fetch("/api/studies", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ studyUid: s.studyUid, patientName: s.patientName, patientId: s.patientId, patientAge: s.patientAge, patientSex: s.patientSex, studyDate: s.studyDate, institution: s.institution, modality: s.modality, bodyPart: s.bodyPart, seriesDescription: s.description, sliceCount: s.slices.length }) });
      return r.ok ? ((await r.json()) as { id: number }).id : null;
    } catch { return null; }
  }, []);

  const saveToServer = async () => {
    if (!series) { toast("Önce bir seri açın."); return; }
    if (savingFiles) return;
    if (!series.files?.length) { toast("Örnek vakaların orijinal dosyası yok. Sunucuya kaydetmek için yerel DICOM dosyalarını açın."); return; }
    setSavingFiles(true);
    try {
      const id = await withImportTimeout(ensureStudy(series), undefined, 30000);
      if (!id) throw new Error("Çalışma kaydedilemedi");
      const files = series.files;
      let done = 0;
      for (let i = 0; i < files.length; i += 3) {
        await Promise.all(files.slice(i, i + 3).map(async (f, j) => {
          const last = i + j === files.length - 1 ? `&last=1&n=${files.length}` : "";
          const res = await fetch(`/api/storage/upload?studyId=${id}&name=${encodeURIComponent(f.name)}${last}`, { method: "POST", body: f, signal: AbortSignal.timeout(60000) });
          if (!res.ok) throw new Error(`${f.name} kaydedilemedi (${res.status})`);
          done++;
          toast(`Sunucuya kaydediliyor: ${done}/${files.length}`, 0);
        }));
      }
      toast(`${files.length} dosya sunucuya kaydedildi (şifreli).`);
      void refreshContext();
    } catch (e) { toast(`Kayıt başarısız: ${e instanceof Error ? e.message : "sunucu hatası"}`, 8000); }
    finally { setSavingFiles(false); }
  };

  const loadFromServer = useCallback(async (s: StudyRow, controller: AbortController): Promise<SeriesData[]> => {
    const signal = controller.signal;
    const r = await withImportTimeout(fetch(`/api/storage/study/${s.id}`, { signal }), signal);
    if (!r.ok) throw new Error("Çalışma dosyaları alınamadı");
    const { files } = (await r.json()) as { files: { id: number; name: string }[] };
    const out: File[] = [];
    for (let i = 0; i < files.length; i += 4) {
      assertNotAborted(signal);
      const part = await Promise.all(files.slice(i, i + 4).map(async (f) => {
        const res = await withImportTimeout(fetch(`/api/storage/file/${f.id}`, { signal }), signal);
        if (!res.ok) throw new Error(`${f.name} alınamadı`);
        return new File([await res.blob()], f.name);
      }));
      out.push(...part);
      if (importRef.current === controller) setProgress({ count: out.length, total: files.length });
    }
    return loadMedicalFiles(out, undefined, undefined, { signal });
  }, []);

  const openStored = async (s: StudyRow) => {
    const controller = beginImport();
    setProgress({ count: 0, total: s.sliceCount || 1 });
    try {
      const parsed = await loadFromServer(s, controller);
      if (controller.signal.aborted || importRef.current !== controller) return;
      if (!parsed.length) throw new Error("Çalışma görüntüleri okunamadı");
      setLoaded((p) => [...parsed, ...p]);
      selectSeries([...parsed].sort((a, b) => b.slices.length - a.slices.length)[0], parsed);
    } catch (e) { if (!controller.signal.aborted) toast(e instanceof Error ? e.message : "Çalışma açılamadı"); }
    finally { if (importRef.current === controller) { importRef.current = null; setProgress(null); } }
  };

  const openPrior = async (s: StudyRow) => {
    const controller = beginImport();
    setProgress({ count: 0, total: s.sliceCount || 1 });
    try {
      const parsed = await loadFromServer(s, controller);
      if (controller.signal.aborted || importRef.current !== controller) return;
      if (!parsed.length) throw new Error("Önceki çalışma okunamadı");
      const big = [...parsed].sort((a, b) => b.slices.length - a.slices.length)[0];
      setLoaded((p) => [...parsed, ...p]);
      setLayout("1x2"); setRefIds([big.id, null, null, null, null]); setRefWins([undefined, undefined, undefined, undefined, undefined]); setSyncPanels(true);
      toast("Önceki çalışma sağ panelde açıldı (konuma göre senkron).");
    } catch (e) { if (!controller.signal.aborted) toast(e instanceof Error ? e.message : "Önceki çalışma açılamadı"); }
    finally { if (importRef.current === controller) { importRef.current = null; setProgress(null); } }
  };

  const openPacs = async (s: { studyUid: string }) => {
    const controller = beginImport();
    const signal = controller.signal;
    setProgress({ count: 0, total: 1 });
    try {
      const li = await withImportTimeout(fetch(`/api/pacs/instances?studyUid=${encodeURIComponent(s.studyUid)}`, { signal }), signal);
      const list = (await li.json()) as { seriesUid: string; sopUid: string }[] | { error: string };
      if (!li.ok || !Array.isArray(list)) throw new Error((list as { error: string }).error ?? "PACS hatası");
      const files: File[] = [];
      for (let i = 0; i < list.length; i += 4) {
        assertNotAborted(signal);
        const part = await Promise.all(list.slice(i, i + 4).map(async (x) => {
          const r = await withImportTimeout(fetch(`/api/pacs/instance?${new URLSearchParams({ studyUid: s.studyUid, seriesUid: x.seriesUid, sopUid: x.sopUid })}`, { signal }), signal, 60000);
          if (!r.ok) throw new Error("Görüntü alınamadı");
          return new File([await r.blob()], `${x.sopUid}.dcm`);
        }));
        files.push(...part);
        if (importRef.current === controller) setProgress({ count: files.length, total: list.length });
      }
      if (!files.length) throw new Error("PACS çalışmasında görüntü bulunamadı");
      await processFiles(files, controller, "PACS");
    } catch (e) { if (!signal.aborted) toast(e instanceof Error ? e.message : "PACS hatası", 8000); }
    finally { if (importRef.current === controller) { importRef.current = null; setProgress(null); } }
  };

  const download = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };
  const exportPng = () => {
    if (!series || !isImageSeries) { toast("PNG dışa aktarmak için bir görüntü serisi seçin. PDF/SR/EKG bu işlemde görüntü kesiti değildir."); return; }
    try {
      const canvas = renderSlice(series, slice, wl, ww, invert, 2048);
      setPngImage({ dataUrl: canvas.toDataURL("image/png"), filename: `kesit-${slice + 1}.png`, sliceLabel: `${series.modality} · ${series.description} · Kesit ${slice + 1}/${series.slices.length}` });
    } catch (e) { toast(`PNG hazırlanamadı: ${e instanceof Error ? e.message : "görüntü hatası"}`); }
  };
  const exportAnon = () => {
    if (!series || !isImageSeries) { toast("Anonim DICOM dışa aktarımı için bir görüntü serisi seçin."); return; }
    if (!window.confirm("Anonimleştirilmiş DICOM (ZIP) oluşturulacak: ad, kimlik, tarih, kurum taşınmaz. Devam?")) return;
    try {
      download(new Blob([zipAnonymized(series).slice().buffer as ArrayBuffer], { type: "application/zip" }), `anonim-${series.modality}-${series.slices.length}kesit.zip`);
      toast("Anonim DICOM indirmesi istendi. Önizleme indirmeyi engellerse uygulamayı yeni sekmede açın.", 6500);
    } catch (e) { toast(`Dışa aktarma başarısız: ${e instanceof Error ? e.message : "bilinmeyen hata"}`); }
  };
  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.fullscreenEnabled && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
      else toast("Bu önizleme tam ekran izni vermiyor. Uygulamayı yeni sekmede açabilirsiniz.");
    } catch { toast("Tarayıcı tam ekran iznini engelledi. Yeni sekmede tekrar deneyebilirsiniz."); }
  };

  // ───── AI Analizi ─────
  const startAnalysis = async () => {
    if (!series || !isImageSeries) { toast("Belge/EKG için piksel analizi yapılamaz; önce bir görüntü serisi seçin."); return; }
    const s = series;
    const run = ++runRef.current;
    const N = s.slices.length;
    setStatus("infer"); setAnalysis(null); setRevealed(new Set()); setLiveFindings([]); setMasks(null); setEngineNotes([]);
    setActiveFinding(null); setFeed([]); setCine(false);
    setScan({ active: false, sliceProgress: 0, scannedSlices: 0, totalSlices: N, phaseLabel: "Hazırlanıyor" });
    pushFeed(`Oturum: ${s.modality} · ${s.description} · ${N} kesit`);
    void ensureStudy(s);

    const proto = resolveProtocol(s, protocol);
    const pace = Math.max(25, Math.min(140, 4200 / N));
    let engine: EngineKind = "no-model";
    let findings: Finding[] = [];
    let maskMap: OverlayData["masks"] = new Map();
    let review: ImageReview | undefined;
    let notes: string[] = [];
    const frameName = ["US", "XA", "RF", "XC"].includes(s.modality.toUpperCase()) ? "Kare" : "Kesit";

    const sweep = async (k: number) => {
      const t0 = performance.now();
      while (runRef.current === run) {
        const p = Math.min(1, (performance.now() - t0) / pace);
        setScan({ active: true, sliceProgress: p, scannedSlices: k, totalSlices: N, phaseLabel: `${frameName} ${k + 1}/${N} inceleniyor` });
        if (p >= 1) break;
        await new Promise((r) => requestAnimationFrame(r));
      }
    };

    try {
      if (proto === "none") {
        pushFeed("Otomatik inceleme kapalı (seçiminiz). Görüntüleri radyolog değerlendirmelidir.", "info");
      } else if (proto === "image-review") {
        engine = "image-review";
        pushFeed(`${s.modality} için ${N} ${frameName.toLowerCase()} gerçek piksel verisinden ölçülecek; klinik tanı/triyaj değildir.`, "info");
        setStatus("scanning");
        const out = await runImageReview(s, {
          aborted: () => runRef.current !== run,
          onSlice: async (k) => { setSlice(k); await sweep(k); },
        });
        if (!out || runRef.current !== run) return;
        review = out.review;
        findings = out.findings;
        notes = out.notes;
      } else if (s.lesions.length > 0 && protocol === "auto") {
        engine = "simulated-sample";
        pushFeed("DEMO: Bulgu etiketleri önceden tanımlıdır; şimdi her karede gerçek piksel ölçümü yapılıyor.", "warn");
        setStatus("scanning");
        const out = await runImageReview(s, {
          aborted: () => runRef.current !== run,
          onSlice: async (k) => { setSlice(k); await sweep(k); },
        });
        if (!out || runRef.current !== run) return;
        review = out.review;
        notes = out.notes;
        findings = s.lesions.map((l, i) => lesionToFinding(l, i, s));
      } else {
        engine = "cv-heuristic";
        pushFeed(`BT protokolü: ${proto === "ct-head" ? "beyin — kanama adayı" : "toraks — nodül adayı"} (kural tabanlı, klinik doğrulama yok).`);
        setStatus("scanning");
        const out = await runEngine(s, proto, {
          aborted: () => runRef.current !== run,
          onSlice: async (k) => { setSlice(k); await sweep(k); },
        });
        if (!out || runRef.current !== run) return;
        findings = out.findings; maskMap = out.masks; notes = out.notes;
      }
    } catch (error) {
      if (runRef.current !== run) return;
      pushFeed(`Görüntü incelemesi başarısız: ${error instanceof Error ? error.message : "işlem hatası"}`, "warn");
      setStatus("idle"); setScan(null);
      return;
    }

    if (runRef.current !== run) return;
    const stat = [...annotations].reverse().find((a) => a.stats);
    let result: AnalysisResult;
    try {
      const res = await fetch("/api/analyze", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studyUid: s.studyUid, engine, findings, review, clinicalNote,
          meta: { modality: s.modality, bodyPart: s.bodyPart, seriesDescription: s.description, sliceCount: N, sliceThickness: s.sliceThickness },
          roi: stat?.stats ? { mean: stat.stats.mean, std: stat.stats.std, slice: stat.slice } : null,
        }),
      });
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? "analiz başarısız");
      result = (await res.json()) as AnalysisResult;
    } catch (e) {
      pushFeed(`Sunucu analizi başarısız: ${e instanceof Error ? e.message : "hata"}`, "warn");
      setStatus("idle"); setScan(null);
      return;
    }
    if (runRef.current !== run) return;

    setLiveFindings(result.findings); setMasks(maskMap); setRevealed(new Set(result.findings.map((f) => f.id)));
    setAnalysis(result); setEngineNotes(notes); setStatus("done");
    setScan({ active: false, sliceProgress: 1, scannedSlices: N, totalSlices: N, phaseLabel: "Tamamlandı" });
    if (engine === "image-review" && result.review) {
      for (const index of result.review.keyFrames) {
        const metric = result.review.frames[index];
        pushFeed(`📊 ${frameName} ${index + 1}/${N}: ${result.review.mode === "color" ? `renkli alan %${metric.colorCoverage ?? 0} (kırmızı %${metric.redCoverage ?? 0}, mavi %${metric.blueCoverage ?? 0})` : `ortalama ${metric.mean}, kontrast ${metric.contrast}, kare farkı %${metric.changeFromPrevious}`}`, "info");
      }
      pushFeed(`✓ ${N} ${frameName.toLowerCase()} piksellerden ölçüldü · hastalık tanısı/acil klinik triyaj yapılmadı.`, "done");
    } else {
      for (const f of result.findings) if (f.category !== "Sistem" && f.category !== "ROI") pushFeed(`⚑ [Kesit ${f.keySliceNumber}/${N}] ${f.label} — ${f.densityOrSignal}, ${f.sizeMmStr}`, "finding");
      pushFeed(`✓ ${N} kesit işlendi · ${result.findings.filter((f) => f.category !== "Sistem" && f.category !== "ROI").length} aday odak · triyaj: ${result.triage.level}`, "done");
      if (result.triage.score > 0.8) pushFeed("⚠ Kritik aday odak: bildirim oluşturuldu (zil simgesi).", "warn");
    }
    setActiveReport(buildReport(result));
    const top = result.findings.find((f) => f.category !== "Sistem" && f.category !== "ROI");
    if (top) { setSlice(top.sliceIndex); setActiveFinding(top.id); }
    void refreshContext();
  };

  const measurementsText = useMemo(() => {
    const unit = series?.unit ?? "SI";
    return [...annotations].filter((a) => a.kind !== "arrow").sort((a, b) => a.slice - b.slice).map((a) => `Kesit ${a.slice + 1} · ${KIND_LABEL[a.kind]}: ${annotationSummary(a, pxMm, unit)}`).join("\n");
  }, [annotations, pxMm, series]);

  const buildReport = (r: AnalysisResult | null): ReportData => {
    const s = series!;
    const approvals: Record<string, FindingApprovalStatus> = {};
    for (const f of r?.findings ?? []) approvals[f.id] = f.category === "Sistem" || f.category === "ROI" ? "onaylandi" : "bekliyor";
    const engine = r?.engine ?? "no-model";
    return {
      status: "taslak", studyUid: s.studyUid, patientName: s.patientName, patientId: s.patientId, patientAge: s.patientAge, patientSex: s.patientSex,
      studyDate: s.studyDate, modality: s.modality, bodyPart: s.bodyPart, seriesDescription: s.description, institution: s.institution, sliceCount: s.slices.length,
      technique: r?.technique ?? `${s.description} serisi (${s.slices.length} kesit${s.sliceThickness ? `, ${s.sliceThickness} mm` : ""}) değerlendirildi.`,
      findingsText: r?.findingsText ?? "", impression: r?.impression ?? "", recommendation: r?.recommendation ?? "",
      clinicalInfo: clinicalNote, findings: r?.findings ?? [], findingsApproval: approvals, engine,
      aiModel: r?.model ?? "Model bağlı değil", modelCard: JSON.stringify(r?.modelCard ?? modelCardFor("no-model")),
      triageLevel: r?.triage.level ?? "", triageScore: r?.triage.score ?? 0, approvedBy: "", doctorTitle: "", doctorRegNo: "", approvedAt: null,
      keyImageDataUrl: renderSlice(s, slice, wl, ww, invert, 320).toDataURL("image/jpeg", 0.85), keyImages, measurementsText, createdAt: new Date().toISOString(),
    };
  };

  const openReport = () => {
    if (!series) { toast("Rapor için önce bir seri seçin."); return; }
    if (!isImageSeries) { toast("Bu nesne belge/EKG görüntüleyicisinde açık. Yeni radyoloji raporu için bir görüntü serisi seçin."); return; }
    if (activeReport && activeReport.studyUid === series.studyUid) {
      if (activeReport.status === "taslak") setActiveReport({ ...activeReport, keyImages, measurementsText: activeReport.id ? "" : measurementsText });
    } else setActiveReport(buildReport(analysis));
    setReportOpen(true);
  };

  const openSaved = async (id: number) => {
    const r = await fetch(`/api/reports/${id}`);
    if (!r.ok) { alert("Rapor açılamadı"); return; }
    const { report: x } = (await r.json()) as { report: SavedReport };
    let kis: KeyImage[] = [];
    let single = x.keyImageDataUrl;
    if (single.startsWith("[")) { try { kis = JSON.parse(single) as KeyImage[]; single = kis[0]?.dataUrl ?? ""; } catch { single = ""; } }
    setActiveReport({
      id: x.id, status: x.status, version: x.version, studyUid: x.studyUid, patientName: x.patientName, patientId: x.patientId, patientAge: x.patientAge, patientSex: x.patientSex,
      studyDate: x.studyDate, modality: x.modality, bodyPart: x.bodyPart, seriesDescription: x.seriesDescription, institution: x.institution, sliceCount: 0,
      technique: x.technique, findingsText: x.findingsText, impression: x.impression, recommendation: x.recommendation, clinicalInfo: x.clinicalInfo,
      findings: x.findingsJson, findingsApproval: x.findingsApproval, engine: x.engine, aiModel: x.aiModel, modelCard: x.modelCard, triageLevel: x.triageLevel, triageScore: x.triageScore,
      approvedBy: x.approvedBy, doctorTitle: x.doctorTitle, doctorRegNo: x.doctorRegNo, approvedAt: x.approvedAt, contentHash: x.contentHash,
      keyImageDataUrl: single, keyImages: kis, measurementsText: "", createdAt: x.createdAt,
    });
    setReportOpen(true);
  };

  const saveReport = async (r: ReportData, action: "save" | "approve"): Promise<SaveResult> => {
    let findingsText = r.findingsText;
    if (r.measurementsText.trim() && !findingsText.includes("ÖLÇÜMLER")) findingsText += `\n\nÖLÇÜMLER\n${r.measurementsText}`;
    const kiPayload = r.keyImages.length ? JSON.stringify(r.keyImages.slice(0, 4)) : r.keyImageDataUrl;
    let res: Response;
    try {
      res = await fetch("/api/reports", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reportId: r.id, action,
          study: { studyUid: r.studyUid, patientName: r.patientName, patientId: r.patientId, patientAge: r.patientAge, patientSex: r.patientSex, studyDate: r.studyDate, institution: r.institution, modality: r.modality, bodyPart: r.bodyPart, seriesDescription: r.seriesDescription, sliceCount: r.sliceCount || 1 },
          report: { mode, clinicalInfo: r.clinicalInfo, technique: r.technique, findingsText, impression: r.impression, recommendation: r.recommendation, findingsJson: r.findings, findingsApproval: r.findingsApproval, triageLevel: r.triageLevel, triageScore: r.triageScore, aiModel: r.aiModel, engine: r.engine, modelCard: r.modelCard, keyImageDataUrl: kiPayload, institution: r.institution },
        }),
      });
    } catch { return { ok: false, error: "Sunucuya ulaşılamadı" }; }
    const d = (await res.json()) as { error?: string; reportId: number; status: "taslak" | "onaylandi"; version: number; approvedAt: string | null; approvedBy: string; doctorTitle: string; doctorRegNo: string; contentHash: string };
    if (!res.ok) return { ok: false, error: d.error };
    const data: Partial<ReportData> = { id: d.reportId, status: d.status, version: d.version, approvedAt: d.approvedAt, approvedBy: d.approvedBy, doctorTitle: d.doctorTitle, doctorRegNo: d.doctorRegNo, contentHash: d.contentHash, findingsText, measurementsText: "" };
    setActiveReport({ ...r, ...data });
    void refreshContext();
    return { ok: true, data };
  };

  const gotoFinding = (f: Finding) => { setSlice(f.sliceIndex); setActiveFinding(f.id); };
  const addAnnotation = (a: Omit<Annotation, "id">) => setAnnotations((p) => [...p, { ...a, id: uid() }]);
  const calibrate = (pxLen: number) => {
    if (!series) return;
    const v = Number((window.prompt("Çizdiğiniz doğrunun gerçek uzunluğu (mm)", "10") ?? "").replace(",", "."));
    if (!v || v <= 0) return;
    setPxOverride((o) => ({ ...o, [series.id]: v / pxLen }));
    toast(`Kalibrasyon: ${(v / pxLen).toFixed(4)} mm/piksel (önceki ${series.pixelSpacing.toFixed(4)})`);
  };
  const savePreset = () => {
    const name = window.prompt("Pencere ön ayarı adı", `Özel ${Math.round(wl)}/${Math.round(ww)}`);
    if (!name) return;
    const next = [...presets, { name, wl, ww }];
    setPresets(next);
    const persistent = writePreference("atik_presets", next);
    toast(persistent ? "Pencere ön ayarı kaydedildi." : "Pencere ön ayarı bu sekmede kaydedildi; tarayıcı kalıcı depolamaya izin vermiyor.");
  };

  const allPresets = series?.modality === "CT" ? [...CT_PRESETS, ...presets] : presets;
  const overlay: OverlayData | null = masks ? { masks, opacity: overlayOpacity } : null;
  const cells = CELLS[layout];
  const refLabel = ["Panel 2", "Panel 3", "Panel 4", "Panel 5", "Panel 6"];

  return (
    <div data-testid="workstation" className="relative isolate flex h-dvh w-full flex-col overflow-hidden bg-[#070a0f] text-slate-200" onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); }} onDrop={onDrop}>
      {dragging && <div className="pointer-events-none absolute inset-0 z-50 flex flex-col items-center justify-center border-4 border-dashed border-cyan-400 bg-cyan-950/80 backdrop-blur-sm"><div className="text-4xl">📂</div><div className="mt-3 text-lg font-bold text-white">DICOM klasörünü / dosyaları / ZIP&apos;i bırakın</div></div>}
      {progress && (
        <div className="pointer-events-none absolute left-1/2 top-28 z-30 w-[min(420px,92vw)] -translate-x-1/2">
          <div role="status" aria-label="Dosya yükleme ilerlemesi" className="pointer-events-auto rounded-xl border border-cyan-500/40 bg-[#0d141e]/95 p-4 shadow-2xl">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-bold text-cyan-200">Hasta görüntüleri okunuyor…</div>
              <button type="button" onClick={cancelImport} className="rounded border border-slate-500/40 px-2 py-1 text-xs text-slate-300 hover:bg-white/10">Yüklemeyi iptal et</button>
            </div>
            <div className="mt-2 font-mono text-xs text-slate-300">{progress.count} / {progress.total}</div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#1b2532]"><div className="h-full bg-gradient-to-r from-cyan-400 to-emerald-400" style={{ width: `${(progress.count / Math.max(1, progress.total)) * 100}%` }} /></div>
            <p className="mt-2 text-[10px] text-slate-400">Menüleri kullanabilirsiniz. Takılırsa yüklemeyi iptal edin.</p>
          </div>
        </div>
      )}
      {toastMsg && <div data-testid="action-feedback" role="status" aria-live="polite" className="pointer-events-none fixed bottom-9 left-1/2 z-[80] w-max max-w-[min(640px,92vw)] -translate-x-1/2 rounded-lg border border-cyan-400/40 bg-[#0b1018]/95 px-4 py-2 text-center text-xs font-semibold leading-relaxed text-cyan-100 shadow-xl">{toastMsg}</div>}

      {/* ── Üst Çubuk 1 ── */}
      <header aria-label="Ana işlemler" className="relative z-20 flex shrink-0 flex-wrap items-center gap-1.5 border-b border-[#1a2230] bg-[#0b0f16] px-2 py-1.5 print:hidden">
        <div className="mr-1 flex shrink-0 items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded bg-gradient-to-br from-cyan-400 to-emerald-500 font-black text-[#06131a]">A</div>
          <span className="font-mono text-sm font-black tracking-[0.18em] text-slate-100">ATIK<span className="text-cyan-400">VIEWER</span></span>
          <span className="rounded border border-slate-700 px-1 py-0.5 font-mono text-[8px] text-slate-500">{APP_BUILD.split("-").slice(-1)[0]}</span>
          <a href={`/?fresh=${APP_BUILD}`} title="Arayüz paketini temiz biçimde yeniden yükle" className="rounded px-1.5 py-1 text-[10px] text-slate-400 hover:bg-white/10 hover:text-white">↻ Yenile</a>
        </div>
        <FileSelectControl onFiles={(files) => void processFiles(files, undefined, "dosya")} />
        <FileSelectControl directory onFiles={(files) => void processFiles(files, undefined, "klasör")} />
        <Btn onClick={() => setWorklistOpen(true)} title="Çalışma listesi / PACS">📋 Liste</Btn>
        <Btn disabled={savingFiles} onClick={() => void saveToServer()} title="Görüntüleri şifreli olarak sunucuya kaydet">{savingFiles ? "Kaydediliyor…" : "☁ Sunucuya kaydet"}</Btn>
        <div className="mx-1 h-6 w-px shrink-0 bg-[#1e2735]" />

        <Btn on={showSeriesPanel} onClick={() => setShowSeriesPanel((v) => !v)} title="Seri listesini göster/gizle">Seriler</Btn>
        <Btn on={showRightPanel} onClick={() => setShowRightPanel((v) => !v)} title="AI, rapor, ölçüm ve DICOM panelini göster/gizle">AI / Rapor paneli</Btn>

        {/* Layout Grid Selector */}
        <select
          aria-label="Izgara düzeni"
          value={layout}
          onChange={(e) => { const l = e.target.value as Layout; setLayout(l); setAutoLayout(false); }}
          title="Izgara Düzeni"
          className="shrink-0 rounded-md border border-[#1e2735] bg-[#0e141d] px-1.5 py-1.5 text-xs text-slate-200 focus:outline-none"
        >
          <option value="1x1">▢ 1×1</option>
          <option value="1x2">▯▯ 1×2</option>
          <option value="2x1">▭▭ 2×1</option>
          <option value="2x2">▦ 2×2</option>
          <option value="1x3">▯▯▯ 1×3</option>
          <option value="3x1">☰ 3×1</option>
          <option value="2x3">▤ 2×3</option>
          <option value="3x2">▥ 3×2</option>
        </select>

        {/* Hanging Protocols Selector & Editor */}
        <Btn on={autoLayout} tone="violet" onClick={toggleAutoLayout} title="Hanging protocol: modaliteye göre otomatik düzen">
          Oto-düzen
        </Btn>
        <Btn tone="violet" onClick={() => setHangingModalOpen(true)} title="Özel Asma Protokolü Kuralları Editörü">
          ⚙ Protokoller
        </Btn>
        <Btn on={syncPanels} tone="violet" onClick={() => { setSyncPanels((v) => !v); toast(syncPanels ? "Paneller arası kesit senkronu kapatıldı." : "Paneller arası kesit senkronu açıldı."); }} title="Paneller arası kesit senkronu (anatomik konuma göre)">
          Senkron
        </Btn>
        <Btn onClick={requestMpr} title="Çok düzlemli yeniden kesit (axial/koronal/sagittal, MIP)">
          MPR
        </Btn>
        <div className="mx-1 h-6 w-px shrink-0 bg-[#1e2735]" />
        <Btn onClick={exportPng} title="Geçerli kesiti PNG kaydet">PNG</Btn>
        <Btn onClick={exportAnon} title="Anonimleştirilmiş DICOM (ZIP)">Anonim DICOM</Btn>
        <Btn onClick={() => void toggleFullscreen()} title="Tam ekran">⛶</Btn>
        <div className="ml-auto flex min-w-0 flex-wrap items-center gap-2">
          <span className="rounded border border-amber-400/40 bg-amber-400/10 px-2 py-1 text-[9px] font-bold tracking-wide text-amber-300">KLİNİK KARAR İÇİN KULLANILAMAZ</span>
          <Link href="/kiyaslama" prefetch={false} className="rounded-lg border border-violet-400/50 bg-violet-500/10 px-2.5 py-1.5 text-xs font-bold text-violet-200 hover:bg-violet-500/20">📊 Kıyaslama</Link>
          <Link href="/yonetim" prefetch={false} className="rounded-lg border border-slate-500/50 px-2.5 py-1.5 text-xs font-bold text-slate-200 hover:bg-slate-500/10">⚙ Yönetim</Link>
          <NotificationsBell />
          <button onClick={openReport} className="cursor-pointer rounded-lg border border-cyan-400/60 bg-gradient-to-r from-cyan-500/20 to-emerald-500/20 px-3 py-1.5 text-xs font-bold text-cyan-200 hover:text-white">📄 Rapor <span className={`ml-1 rounded-full px-1.5 text-[9px] font-black ${reportStatus === "onaylandi" ? "bg-emerald-500 text-slate-950" : "bg-rose-500 text-white"}`}>{reportStatus === "onaylandi" ? "ONAYLI" : "TASLAK"}</span></button>
          <Link href="/yonetim" prefetch={false} title="Rapor imzasında görünecek hekim adı — düzenlemek için tıklayın" className="text-right leading-tight hover:opacity-80">
            <div className="text-[11px] font-semibold text-slate-200">{user.title} {user.fullName}</div>
            <div className="text-[9px] uppercase tracking-wider text-slate-500">{user.regNo ? `sicil ${user.regNo}` : "sicil tanımsız"}</div>
          </Link>
        </div>
      </header>

      {/* ── Üst Çubuk 2: Araçlar & Kontroller ── */}
      <div aria-label="Görüntü araçları" className="relative z-10 flex shrink-0 flex-wrap items-center gap-1 border-b border-[#1a2230] bg-[#0a0e15] px-2 py-1 print:hidden">
        {TOOLS.map((t) => <Btn key={t.id} on={tool === t.id} title={t.hint} onClick={() => setTool(t.id)}>{t.label}</Btn>)}
        <div className="mx-1 h-5 w-px shrink-0 bg-[#1e2735]" />
        <Btn on={invert} tone="amber" onClick={() => setInvert((v) => !v)}>Ters</Btn>
        <Btn onClick={() => setRotation((r) => ((r + 90) % 360) as Rot)} title="R">⟳ Döndür</Btn>
        <Btn on={flipH} onClick={() => setFlipH((v) => !v)} title="H">⇆</Btn>
        <Btn on={flipV} onClick={() => setFlipV((v) => !v)} title="V">⇅</Btn>
        <Btn onClick={() => { if (series) { resetView(series); toast("Görüntü ayarları sıfırlandı.", 2500); } else toast("Önce bir görüntü serisi açın."); }}>Sıfırla</Btn>
        {series?.overlays && series.overlays.length > 0 && (
          <Btn on={showOverlays} tone="emerald" onClick={() => setShowOverlays((v) => !v)} title="DICOM Katmanlarını (6000-601e) Göster/Gizle">
            Katman (60xx)
          </Btn>
        )}
        {series && series.slices.length > 1 && (
          <>
            <Btn on={cine} tone="emerald" onClick={() => setCine((c) => !c)}>{cine ? "■ Durdur" : "▶ Cine"}</Btn>
            <label className="flex shrink-0 items-center gap-1 text-[10px] text-slate-400">
              <input type="range" min={2} max={30} value={fps} onChange={(e) => setFps(Number(e.target.value))} className="w-16" />
              {fps} fps
            </label>
          </>
        )}
        <div className="mx-1 h-5 w-px shrink-0 bg-[#1e2735]" />
        <select aria-label="Pencere ön ayarı" value="" onChange={(e) => { const p = allPresets.find((x) => x.name === e.target.value); if (p) { setWl(p.wl); setWw(p.ww); } }} className="shrink-0 rounded-md border border-[#1e2735] bg-[#0e141d] px-2 py-1 text-xs text-slate-200 focus:outline-none">
          <option value="" disabled>Pencere</option>{allPresets.map((p) => <option key={p.name} value={p.name}>{p.name} ({p.wl}/{p.ww})</option>)}
        </select>
        <Btn onClick={savePreset}>＋ Ön ayar</Btn>
        <div className="mx-1 h-5 w-px shrink-0 bg-[#1e2735]" />
        <Btn tone="amber" onClick={captureKey} title="Anahtar kesit ekle (K)">★ Anahtar kesit{keyImages.length ? ` (${keyImages.length})` : ""}</Btn>
        {pxOverride[series?.id ?? ""] && <span className="shrink-0 rounded border border-emerald-400/30 px-1.5 py-0.5 text-[10px] text-emerald-300">kalibre</span>}
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Sol Panel: Seriler */}
        {showSeriesPanel && <aside aria-label="Seri listesi" className="flex w-48 shrink-0 flex-col border-r border-[#1a2230] bg-[#0b0f16] print:hidden">
          <div className="flex items-center justify-between border-b border-[#1a2230] px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">
            <span>Seriler ({all.length})</span>
            {loaded.length > 0 && <button onClick={() => { setLoaded([]); setRefIds([null, null, null, null, null]); if (series && !series.isSample && samples[0]) selectSeries(samples[0], samples); toast("Açılan dosyalar listeden kaldırıldı; sunucudaki kayıtlar silinmedi."); }} className="cursor-pointer text-[9.5px] normal-case text-rose-400 hover:underline">Temizle</button>}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {lastReport && <button type="button" onClick={() => setImportReport(lastReport)} className="mb-2 w-full rounded-lg border border-cyan-400/30 bg-cyan-400/5 px-2 py-1.5 text-left text-[10.5px] font-semibold text-cyan-200 hover:bg-cyan-400/10">Yükleme raporu: {lastReport.stats.total} dosya → {lastReport.stats.seriesOpened} seri</button>}
            {importWarnings.length > 0 && <details className="mb-2 rounded-lg border border-amber-400/30 bg-amber-400/5 p-2 text-[10px] text-amber-200"><summary className="cursor-pointer font-semibold">Yükleme uyarıları ({importWarnings.length})</summary><ul className="mt-1 space-y-1">{importWarnings.map((w, i) => <li key={i}>{w}</li>)}</ul></details>}
            {loaded.length > 0 && <div className="mb-1 px-1 text-[9px] font-bold uppercase tracking-widest text-emerald-400">Açılan ({loaded.length})</div>}
            {loaded.map((s) => <SeriesCard key={s.id} s={s} active={s.id === activeId || refIds.includes(s.id)} onClick={() => selectSeries(s)} />)}
            <div className="mb-1 mt-3 flex items-center justify-between px-1 text-[9px] font-bold uppercase tracking-widest text-slate-400"><span>Örnek vakalar</span>{samplesLoading && <span className="animate-pulse text-cyan-400">yükleniyor…</span>}</div>
            {sampleFailures.length > 0 && <details className="mb-2 rounded border border-amber-400/30 p-1.5 text-[9.5px] text-amber-200"><summary className="cursor-pointer">Açılamayan örnek ({sampleFailures.length})</summary>{sampleFailures.map((f) => <div key={f}>{f}</div>)}</details>}
            {samples.map((s) => <SeriesCard key={s.id} s={s} active={s.id === activeId || refIds.includes(s.id)} onClick={() => selectSeries(s)} />)}
          </div>
          {series && series.slices.length > 1 && !series.specialType && (
            <div className="border-t border-[#1a2230] bg-[#080d14] p-3">
              <div className="mb-1 flex justify-between font-mono text-[11px] font-bold"><span className="text-cyan-400">KESİT {slice + 1}</span><span className="text-slate-400">/ {series.slices.length}</span></div>
              <div className="relative w-full py-1">
                <input type="range" min={0} max={series.slices.length - 1} value={slice} onChange={(e) => setSlice(Number(e.target.value))} className="w-full cursor-pointer" />
                {liveFindings.map((f) => revealed.has(f.id) && f.category !== "Sistem" && f.category !== "ROI" ? (
                  <button key={f.id} onClick={() => setSlice(f.sliceIndex)} title={`Kesit ${f.keySliceNumber}: ${f.label}`} className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 cursor-pointer rounded-full border-2 border-slate-900 shadow-md hover:scale-125" style={{ left: `${(f.sliceIndex / Math.max(1, series.slices.length - 1)) * 100}%`, backgroundColor: slice === f.sliceIndex ? "#22d3ee" : f.severity === "kritik" ? "#ff3b5c" : f.severity === "yuksek" ? "#ff9f1c" : "#ffd60a" }} />
                ) : null)}
                {keyImages.map((k) => <button key={k.id} onClick={() => setSlice(k.slice)} title={`★ Kesit ${k.slice + 1}`} className="absolute -bottom-1 -translate-x-1/2 cursor-pointer text-[10px] leading-none text-amber-300" style={{ left: `${(k.slice / Math.max(1, series.slices.length - 1)) * 100}%` }}>★</button>)}
              </div>
            </div>
          )}
        </aside>}

        {/* Orta: Ana Görüntüleme & Çoklu Izgara / Özel Nesneler */}
        <main aria-label="Görüntüleme alanı" className="relative min-w-0 flex-1">
          <ViewerErrorBoundary resetKey={series?.id ?? "empty"}>
          {series?.specialType === "sr" && series.srData ? (
            <SRViewer sr={series.srData} onJumpToSlice={(s) => setSlice(s - 1)} />
          ) : series?.specialType === "pdf" && series.pdfData ? (
            <PDFViewer pdf={series.pdfData} />
          ) : series?.specialType === "ecg" && series.ecgData ? (
            <ECGViewer ecg={series.ecgData} />
          ) : (
            <div className={`grid h-full w-full gap-px bg-[#1a2230] ${GRID[layout]}`}>
              <div className="relative min-h-0 min-w-0 bg-[#07090c]">
                <Viewport
                  series={series} slice={slice} wl={wl} ww={ww} invert={invert} zoom={zoom} pan={pan} tool={tool} rotation={rotation} flipH={flipH} flipV={flipV} pxMm={pxMm}
                  scan={scan} findings={liveFindings} revealedIds={revealed} activeFindingId={activeFinding} overlay={overlay} showDicomOverlays={showOverlays} annotations={annotations}
                  onSlice={setSlice} onWL={(a, b) => { setWl(a); setWw(b); }} onZoom={setZoom} onPan={setPan}
                  onAddAnnotation={addAnnotation} onCalibrate={calibrate} onHover={setHoverVal}
                />
                {series && (
                  <>
                    <div className="pointer-events-none absolute left-3 top-2 font-mono text-[10.5px] leading-relaxed text-cyan-200/80"><div className="font-bold text-white">{series.patientName}</div><div>{series.modality} · {series.description}</div><div className="text-slate-400">ID: {series.patientId}</div></div>
                    <div className="pointer-events-none absolute right-3 top-2 text-right font-mono text-[10.5px] leading-relaxed text-cyan-200/80"><div className="font-bold text-cyan-300">Kesit {slice + 1}/{series.slices.length}{series.sliceThickness ? ` · ${series.sliceThickness} mm` : ""}</div><div>Zoom %{Math.round(zoom * 100)}</div>{hoverVal !== null && <div className="font-bold text-emerald-300">{hoverVal.toFixed(0)} {series.unit}</div>}</div>
                    <div className="pointer-events-none absolute bottom-2 left-3 font-mono text-[10.5px] text-cyan-200/80">{series.isColor ? "True Color (RGB)" : `WL ${Math.round(wl)} · WW ${Math.round(ww)}`}{invert ? " · TERS" : ""} · {pxMm.toFixed(3)} mm/px</div>
                  </>
                )}
                {!series && <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2"><div className="text-xl font-bold text-slate-200">DICOM klasörü / dosya / ZIP sürükleyin veya açın</div><div className="text-xs text-slate-500">Sıkıştırılmış (JPEG, JPEG 2000, JPEG-LS, RLE, True Color, SR, PDF, ECG) nesneler desteklenir.</div></div>}
              </div>
              {Array.from({ length: cells - 1 }, (_, i) => (
                <div key={i} className="min-h-0 min-w-0 bg-[#07090c]">
                  <RefPanel
                    allSeries={all} seriesId={refIds[i]} onSeriesChange={(id) => setRefIds((r) => r.map((x, k) => (k === i ? id : x)))}
                    primary={series} primarySlice={slice} syncSlice={syncPanels} windowOverride={refWins[i]} tool={tool} invert={invert}
                    rotation={rotation} flipH={flipH} flipV={flipV} onPrimarySlice={(n) => series && setSlice(Math.max(0, Math.min(series.slices.length - 1, n)))} label={refLabel[i]}
                  />
                </div>
              ))}
            </div>
          )}
          </ViewerErrorBoundary>
        </main>

        {showRightPanel && <aside aria-label="İnceleme paneli" className="w-[300px] shrink-0 xl:w-[340px] 2xl:w-[380px] print:hidden">
          <ViewerErrorBoundary resetKey={series?.id ?? "empty"} label="İnceleme paneli">
          <RightPanel
            user={user} series={series} currentSlice={slice} status={status} scan={scan} mode={mode} setMode={setMode}
            clinicalNote={clinicalNote} setClinicalNote={setClinicalNote} protocol={protocol} setProtocol={setProtocol} resolved={resolved}
            analysis={analysis} revealedIds={revealed} feed={feed} engineNotes={engineNotes}
            onStart={() => void startAnalysis()} onGotoFinding={gotoFinding} activeFindingId={activeFinding}
            overlayOpacity={overlayOpacity} setOverlayOpacity={setOverlayOpacity} hasMasks={!!masks && masks.size > 0}
            annotations={annotations} pxMm={pxMm} onDeleteAnnotation={(id) => setAnnotations((a) => a.filter((x) => x.id !== id))} onClearAnnotations={() => setAnnotations([])} onGotoSlice={setSlice}
            keyImages={keyImages} onRemoveKeyImage={(id) => setKeyImages((k) => k.filter((x) => x.id !== id))}
            patientReports={patientReports} priorStudies={priorStudies} onOpenSaved={(id) => void openSaved(id)} onOpenPrior={(s) => void openPrior(s)} onRefreshReports={() => void refreshContext()}
            onOpenReportModal={openReport} currentReportStatus={reportStatus}
          />
          </ViewerErrorBoundary>
        </aside>}
      </div>

      <footer className="flex min-h-7 shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-[#1a2230] bg-[#0b0f16] px-3 font-mono text-[10px] text-slate-400 print:hidden">
        <span className={status === "scanning" ? "font-bold text-emerald-400" : ""}>{status === "idle" ? "HAZIR" : status === "infer" ? "HAZIRLANIYOR…" : status === "scanning" ? `ANALİZ: ${scan?.phaseLabel ?? ""}` : `ANALİZ TAMAM — ${analysis?.engine ?? ""}`}</span>
        {series && (
          <>
            <span>{series.width}×{series.height} · {series.isColor ? "RGB" : series.slices[0]?.constructor.name.replace("Array", "")}</span>
            <span>Ölçüm: {annotations.length}</span>
            <span>★ {keyImages.length}</span>
            {series.overlays && series.overlays.length > 0 && <span className="text-emerald-400">Katman: {series.overlays.length}</span>}
          </>
        )}
        <span className="ml-auto hidden text-amber-300/80 lg:inline">DEMO / ARAŞTIRMA — kural tabanlı aday bulgular klinik olarak doğrulanmamıştır</span>
      </footer>

      {activeReport && <ReportPrintModal open={reportOpen} onClose={() => setReportOpen(false)} report={activeReport} user={user} onSave={saveReport} onGotoSlice={(n) => setSlice(Math.max(0, n - 1))} />}
      <WorklistModal open={worklistOpen} onClose={() => setWorklistOpen(false)} user={user} onOpenStudy={(s) => void openStored(s)} onOpenPacs={(s) => void openPacs(s)} />
      {mpr && series && <div className="fixed inset-0 z-50 bg-[#070a0f]"><ViewerErrorBoundary resetKey={series.id} label="MPR" onClose={() => setMpr(false)}><VolumeView series={series} wl={wl} ww={ww} invert={invert} onClose={() => setMpr(false)} /></ViewerErrorBoundary></div>}
      {pngImage && <ExportImageDialog image={pngImage} onClose={closePng} />}
      {importReport && <ImportReportDialog report={importReport} onClose={closeImportReport} />}
      {hangingModalOpen && <HangingProtocolEditorModal
        open={hangingModalOpen}
        onClose={() => setHangingModalOpen(false)}
        onApplyProtocol={(rule) => { if (series) applyHangingProtocolRule(rule, series, all); else toast("Düzen uygulamak için önce bir seri seçin."); }}
      />}
    </div>
  );
}
