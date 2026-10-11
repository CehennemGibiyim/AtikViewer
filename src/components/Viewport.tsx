"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Annotation, Finding, SeriesData, ToolName } from "@/lib/types";
import { angleAt, annotationSummary, dist, ellipseTest, lineAngle, pointInPolygon, regionStats, type Pt } from "@/lib/geometry";
import { fmtConfShort } from "@/lib/format";

const SEV_COLOR: Record<string, string> = { kritik: "#ff3b5c", yuksek: "#ff9f1c", orta: "#ffd60a", dusuk: "#4cc9f0", normal: "#2ee6a8" };
const SEV_RGB: Record<string, [number, number, number]> = { kritik: [255, 59, 92], yuksek: [255, 159, 28], orta: [255, 214, 10], dusuk: [76, 201, 240], normal: [46, 230, 168] };

export interface ScanState {
  active: boolean;
  sliceProgress: number;
  scannedSlices: number;
  totalSlices: number;
  phaseLabel: string;
}

export interface OverlayData {
  masks: Map<string, Map<number, Uint8Array>>;
  opacity: number;
}

type Rot = 0 | 90 | 180 | 270;
type Draft = { mode: "drag"; tool: ToolName; a: Pt; b: Pt } | { mode: "multi"; tool: ToolName; pts: Pt[]; cursor: Pt } | null;
const DRAG_TOOLS: ToolName[] = ["length", "rect", "ellipse", "arrow", "calib"];
const MULTI_NEED: Partial<Record<ToolName, number>> = { angle: 3, cobb: 4 };

interface ViewportProps {
  series: SeriesData | null;
  slice: number;
  wl: number;
  ww: number;
  invert: boolean;
  zoom: number;
  pan: { x: number; y: number };
  tool: ToolName;
  rotation: Rot;
  flipH: boolean;
  flipV: boolean;
  pxMm: number;
  scan?: ScanState | null;
  findings?: Finding[];
  revealedIds?: Set<string>;
  activeFindingId?: string | null;
  overlay?: OverlayData | null;
  showDicomOverlays?: boolean;
  annotations?: Annotation[];
  readOnly?: boolean;
  label?: string;
  onSlice: (s: number) => void;
  onWL: (wl: number, ww: number) => void;
  onZoom: (z: number) => void;
  onPan: (p: { x: number; y: number }) => void;
  onAddAnnotation?: (a: Omit<Annotation, "id">) => void;
  onCalibrate?: (pxLength: number) => void;
  onHover?: (v: number | null) => void;
}

const EMPTY_FINDINGS: Finding[] = [];
const EMPTY_SET = new Set<string>();
const EMPTY_ANN: Annotation[] = [];

export default function Viewport(props: ViewportProps) {
  const {
    series, slice: requestedSlice, wl, ww, invert, zoom, pan, tool, rotation, flipH, flipV, pxMm, scan = null,
    findings = EMPTY_FINDINGS, revealedIds = EMPTY_SET, activeFindingId = null, overlay = null,
    showDicomOverlays = true, annotations = EMPTY_ANN, readOnly = false, label,
    onSlice, onWL, onZoom, onPan, onAddAnnotation, onCalibrate, onHover,
  } = props;

  const slice = series ? Math.max(0, Math.min(requestedSlice, series.slices.length - 1)) : 0;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<{ key: string; canvas: HTMLCanvasElement | null }>({ key: "", canvas: null });
  const ovRef = useRef<{ key: string; canvas: HTMLCanvasElement | null }>({ key: "", canvas: null });
  const dragRef = useRef<{ button: number; sx: number; sy: number; wl: number; ww: number; zoom: number; pan: { x: number; y: number } } | null>(null);
  const [draft, setDraft] = useState<Draft>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [renderTick, setTick] = useState(0);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const dims = useCallback(() => {
    if (!series) return { dispW: 1, dispH: 1 };
    const r = rotation === 90 || rotation === 270;
    return { dispW: r ? series.height : series.width, dispH: r ? series.width : series.height };
  }, [series, rotation]);

  const getTransform = useCallback(() => {
    const { dispW, dispH } = dims();
    const scale = Math.min(size.w / dispW, size.h / dispH) * 0.92 * zoom;
    return { scale, ox: size.w / 2 - (dispW / 2) * scale + pan.x, oy: size.h / 2 - (dispH / 2) * scale + pan.y, dispW, dispH };
  }, [dims, size, zoom, pan]);

  // Görüntü koordinatı -> Ekran koordinatı
  const imgToDisp = useCallback((p: Pt): Pt => {
    if (!series) return p;
    const { dispW, dispH } = dims();
    let q: Pt;
    if (rotation === 90) q = { x: series.height - p.y, y: p.x };
    else if (rotation === 180) q = { x: series.width - p.x, y: series.height - p.y };
    else if (rotation === 270) q = { x: p.y, y: series.width - p.x };
    else q = p;
    return { x: flipH ? dispW - q.x : q.x, y: flipV ? dispH - q.y : q.y };
  }, [series, rotation, flipH, flipV, dims]);

  const dispToImg = useCallback((d: Pt): Pt => {
    if (!series) return d;
    const { dispW, dispH } = dims();
    const x = flipH ? dispW - d.x : d.x;
    const y = flipV ? dispH - d.y : d.y;
    if (rotation === 90) return { x: y, y: series.height - x };
    if (rotation === 180) return { x: series.width - x, y: series.height - y };
    if (rotation === 270) return { x: series.width - y, y: x };
    return { x, y };
  }, [series, rotation, flipH, flipV, dims]);

  const canvasToImg = useCallback((cx: number, cy: number): Pt => {
    const { scale, ox, oy } = getTransform();
    return dispToImg({ x: (cx - ox) / scale, y: (cy - oy) / scale });
  }, [getTransform, dispToImg]);

  // ───────── Çizim Döngüsü ─────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size.w * dpr;
    canvas.height = size.h * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#07090c";
    ctx.fillRect(0, 0, size.w, size.h);
    if (!series) return;

    const W = series.width;
    const H = series.height;
    const sliceIdx = Math.min(slice, series.slices.length - 1);
    const sl = series.slices[sliceIdx];

    // 1. Taban katmanı: True Color RGBA veya Monokrom Grayscale LUT
    const isColor = series.isColor && series.rgbaSlices && series.rgbaSlices[sliceIdx];
    const key = `${series.id}|${slice}|${Math.round(wl)}|${Math.round(ww)}|${invert}|${isColor ? "color" : "mono"}`;

    if (baseRef.current.key !== key) {
      const c = baseRef.current.canvas ?? document.createElement("canvas");
      c.width = W; c.height = H;
      const octx = c.getContext("2d")!;
      const img = octx.createImageData(W, H);
      const u32 = new Uint32Array(img.data.buffer);

      if (isColor) {
        // True Color direct RGBA copy
        const srcRgba = series.rgbaSlices![sliceIdx];
        u32.set(srcRgba);
      } else {
        // Monochromatic WL/WW Window LUT
        const lo = wl - ww / 2;
        const k = 255 / Math.max(1, ww);
        for (let i = 0; i < sl.length; i++) {
          let g = (sl[i] - lo) * k;
          g = g < 0 ? 0 : g > 255 ? 255 : g;
          if (invert) g = 255 - g;
          const gi = g | 0;
          u32[i] = 0xff000000 | (gi << 16) | (gi << 8) | gi;
        }
      }

      octx.putImageData(img, 0, 0);
      baseRef.current = { key, canvas: c };
    }

    // 2. AI Maske Örtüsü
    let ovCanvas: HTMLCanvasElement | null = null;
    if (overlay && overlay.opacity > 0) {
      const vis = findings.filter((f) => revealedIds.has(f.id) && overlay.masks.get(f.id)?.get(slice));
      if (vis.length) {
        const okey = `${series.id}|${slice}|${vis.map((f) => f.id).join(",")}|${overlay.opacity}`;
        if (ovRef.current.key !== okey) {
          const c = ovRef.current.canvas ?? document.createElement("canvas");
          c.width = W; c.height = H;
          const octx = c.getContext("2d")!;
          const img = octx.createImageData(W, H);
          const u32 = new Uint32Array(img.data.buffer);
          const a = Math.round(overlay.opacity * 255);
          for (const f of vis) {
            const [r, g, b] = SEV_RGB[f.severity] ?? SEV_RGB.dusuk;
            const col = (a << 24) | (b << 16) | (g << 8) | r;
            const mk = overlay.masks.get(f.id)!.get(slice)!;
            for (let i = 0; i < mk.length; i++) if (mk[i]) u32[i] = col;
          }
          octx.putImageData(img, 0, 0);
          ovRef.current = { key: okey, canvas: c };
        }
        ovCanvas = ovRef.current.canvas;
      }
    }

    const { scale, ox, oy, dispW, dispH } = getTransform();
    const drawLayer = (cv: HTMLCanvasElement) => {
      ctx.save();
      ctx.imageSmoothingEnabled = scale < 3;
      ctx.translate(ox, oy);
      ctx.scale(scale, scale);
      ctx.translate(dispW / 2, dispH / 2);
      ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
      ctx.rotate((rotation * Math.PI) / 180);
      ctx.drawImage(cv, -W / 2, -H / 2, W, H);
      ctx.restore();
    };

    drawLayer(baseRef.current.canvas!);
    if (ovCanvas) drawLayer(ovCanvas);

    const toC = (p: Pt) => {
      const d = imgToDisp(p);
      return { x: ox + d.x * scale, y: oy + d.y * scale };
    };
    const now = performance.now();

    // 3. DICOM Overlays (6000..601E)
    if (showDicomOverlays && series.overlays && series.overlays.length > 0) {
      for (const ov of series.overlays) {
        if (ov.visible === false) continue;
        ctx.save();
        ctx.fillStyle = ov.type === "R" ? "rgba(239, 68, 68, 0.85)" : "rgba(34, 197, 94, 0.85)"; // Red for ROI, Green for Graphics
        const ox0 = ov.originX - 1;
        const oy0 = ov.originY - 1;
        const oRows = ov.rows;
        const oCols = ov.cols;

        for (let r = 0; r < oRows; r++) {
          for (let c = 0; c < oCols; c++) {
            if (ov.data[r * oCols + c]) {
              const pt = toC({ x: ox0 + c, y: oy0 + r });
              ctx.fillRect(pt.x, pt.y, Math.max(1, scale), Math.max(1, scale));
            }
          }
        }
        ctx.restore();
      }
    }

    // 4. DICOM GSPS Presentation States
    if (series.gsps && series.gsps.length > 0) {
      for (const gs of series.gsps) {
        ctx.save();
        ctx.strokeStyle = "#a855f7";
        ctx.fillStyle = "#a855f7";
        ctx.lineWidth = 1.8;

        for (const gr of gs.graphics) {
          if (gr.type === "ELLIPSE" && gr.data.length >= 4) {
            const [cx0, cy0, rx0, ry0] = gr.data;
            const cPt = toC({ x: cx0, y: cy0 });
            ctx.beginPath();
            ctx.ellipse(cPt.x, cPt.y, rx0 * scale, ry0 * scale, 0, 0, Math.PI * 2);
            ctx.stroke();
          } else if (gr.type === "POLYLINE" && gr.data.length >= 4) {
            ctx.beginPath();
            for (let i = 0; i < gr.data.length; i += 2) {
              const pt = toC({ x: gr.data[i], y: gr.data[i + 1] });
              if (i === 0) ctx.moveTo(pt.x, pt.y);
              else ctx.lineTo(pt.x, pt.y);
            }
            ctx.stroke();
          }
        }

        for (const tx of gs.texts) {
          if (tx.anchorPoint) {
            const pt = toC(tx.anchorPoint);
            ctx.font = "bold 11px ui-monospace, monospace";
            ctx.fillText(tx.text, pt.x, pt.y);
          }
        }
        ctx.restore();
      }
    }

    // 5. AI Bulgu Kutuları
    for (const f of findings) {
      if (!revealedIds.has(f.id) || slice < f.sliceStart || slice > f.sliceEnd) continue;
      const box = f.sliceBoxes?.[slice] ?? f.bbox;
      if (!box) continue;
      const col = SEV_COLOR[f.severity] ?? "#4cc9f0";
      const p1 = toC({ x: box.x * W, y: box.y * H });
      const p2 = toC({ x: (box.x + box.w) * W, y: (box.y + box.h) * H });
      const x = Math.min(p1.x, p2.x), y = Math.min(p1.y, p2.y), bw = Math.abs(p2.x - p1.x), bh = Math.abs(p2.y - p1.y);
      const active = f.id === activeFindingId || slice === f.sliceIndex;
      ctx.save();
      ctx.strokeStyle = col;
      ctx.globalAlpha = active ? 1 : 0.6 + 0.3 * (0.55 + 0.45 * Math.sin(now / 280));
      ctx.lineWidth = active ? 2.5 : 1.5;
      ctx.setLineDash(active ? [] : [6, 4]);
      ctx.strokeRect(x, y, bw, bh);
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.95;
      ctx.font = "bold 11px ui-monospace, monospace";
      const txt = `[Kesit ${f.keySliceNumber}] ${f.label}${fmtConfShort(f) ? ` · ${fmtConfShort(f)}` : ""}`;
      const tw = ctx.measureText(txt).width;
      ctx.fillStyle = "rgba(5,8,12,0.9)";
      ctx.fillRect(x, y - 20, tw + 14, 18);
      ctx.strokeStyle = col; ctx.lineWidth = 1;
      ctx.strokeRect(x, y - 20, tw + 14, 18);
      ctx.fillStyle = col;
      ctx.fillText(txt, x + 7, y - 7);
      ctx.restore();
    }

    // 6. Kullanıcı Ölçümleri (Uzunluk, Açı, Cobb, ROI, Ok vb.)
    ctx.save();
    ctx.font = "600 11px ui-monospace, monospace";
    ctx.lineWidth = 1.5;
    const dot = (p: { x: number; y: number }) => { ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill(); };
    const text = (s: string, p: { x: number; y: number }) => {
      const w = ctx.measureText(s).width;
      ctx.save(); ctx.fillStyle = "rgba(5,8,12,0.75)"; ctx.fillRect(p.x + 5, p.y - 14, w + 6, 14); ctx.restore();
      ctx.fillText(s, p.x + 8, p.y - 3);
    };

    const drawAnn = (a: { kind: Annotation["kind"]; points: Pt[]; text?: string; stats?: Annotation["stats"] }, temp: boolean) => {
      const P = a.points.map(toC);
      const color = a.kind === "length" || a.kind === "calib" ? "#ffd60a" : a.kind === "angle" || a.kind === "cobb" ? "#ff66c4" : a.kind === "arrow" ? "#7dd3fc" : "#b388ff";
      ctx.strokeStyle = color; ctx.fillStyle = color;
      ctx.setLineDash(temp || a.kind === "calib" ? [5, 3] : []);
      ctx.beginPath();
      if (a.kind === "length" || a.kind === "calib" || a.kind === "arrow") { ctx.moveTo(P[0].x, P[0].y); if (P[1]) ctx.lineTo(P[1].x, P[1].y); }
      else if (a.kind === "angle") { ctx.moveTo(P[0].x, P[0].y); if (P[1]) ctx.lineTo(P[1].x, P[1].y); if (P[2]) ctx.lineTo(P[2].x, P[2].y); }
      else if (a.kind === "cobb") { ctx.moveTo(P[0].x, P[0].y); if (P[1]) ctx.lineTo(P[1].x, P[1].y); if (P[2]) { ctx.moveTo(P[2].x, P[2].y); if (P[3]) ctx.lineTo(P[3].x, P[3].y); } }
      else if (a.kind === "rect" && P[1]) {
        const c1 = toC({ x: a.points[0].x, y: a.points[0].y }), c2 = toC({ x: a.points[1].x, y: a.points[1].y });
        const q = [c1, toC({ x: a.points[1].x, y: a.points[0].y }), c2, toC({ x: a.points[0].x, y: a.points[1].y })];
        ctx.moveTo(q[0].x, q[0].y); q.slice(1).forEach((s) => ctx.lineTo(s.x, s.y)); ctx.closePath();
      } else if (a.kind === "ellipse" && P[1]) {
        const cx = (a.points[0].x + a.points[1].x) / 2, cy = (a.points[0].y + a.points[1].y) / 2;
        const rx = Math.abs(a.points[1].x - a.points[0].x) / 2, ry = Math.abs(a.points[1].y - a.points[0].y) / 2;
        for (let t = 0; t <= 48; t++) {
          const s = toC({ x: cx + rx * Math.cos((t / 48) * Math.PI * 2), y: cy + ry * Math.sin((t / 48) * Math.PI * 2) });
          if (t === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
        }
      } else if (a.kind === "polygon") {
        P.forEach((s, i) => (i === 0 ? ctx.moveTo(s.x, s.y) : ctx.lineTo(s.x, s.y)));
        if (!temp) ctx.closePath();
      }
      ctx.stroke();
      ctx.setLineDash([]);
      if (a.kind !== "rect" && a.kind !== "ellipse") P.forEach(dot);
      if (a.kind === "arrow" && P[1]) {
        const ang = Math.atan2(P[1].y - P[0].y, P[1].x - P[0].x);
        ctx.beginPath(); ctx.moveTo(P[1].x, P[1].y);
        ctx.lineTo(P[1].x - 10 * Math.cos(ang - Math.PI / 6), P[1].y - 10 * Math.sin(ang - Math.PI / 6));
        ctx.lineTo(P[1].x - 10 * Math.cos(ang + Math.PI / 6), P[1].y - 10 * Math.sin(ang + Math.PI / 6));
        ctx.closePath(); ctx.fill();
      }
      if (!temp) {
        const full = a as Annotation;
        const anchor = a.kind === "angle" ? P[1] : a.kind === "arrow" ? P[1] : a.kind === "length" ? { x: (P[0].x + P[1].x) / 2, y: (P[0].y + P[1].y) / 2 } : P[P.length - 1];
        const s = annotationSummary(full, pxMm, series.unit);
        if (s && anchor) text(s, anchor);
      }
    };

    for (const a of annotations) if (a.slice === slice) drawAnn(a, false);
    if (draft?.mode === "drag") drawAnn({ kind: draft.tool as Annotation["kind"], points: [draft.a, draft.b] }, true);
    if (draft?.mode === "multi") drawAnn({ kind: draft.tool as Annotation["kind"], points: [...draft.pts, draft.cursor] }, true);
    ctx.restore();

    // 7. AI Tarama Çizgisi
    if (scan?.active) {
      const lineY = oy + dispH * scale * scan.sliceProgress;
      const grad = ctx.createLinearGradient(0, oy, 0, lineY);
      grad.addColorStop(0, "rgba(46,230,168,0.02)");
      grad.addColorStop(1, "rgba(46,230,168,0.14)");
      ctx.save();
      ctx.fillStyle = grad;
      ctx.fillRect(ox, oy, dispW * scale, Math.max(0, lineY - oy));
      ctx.strokeStyle = "rgba(46,230,168,0.95)"; ctx.shadowColor = "#2ee6a8"; ctx.shadowBlur = 14; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(ox, lineY); ctx.lineTo(ox + dispW * scale, lineY); ctx.stroke();
      ctx.restore();
    }
  }, [series, slice, wl, ww, invert, size, getTransform, imgToDisp, findings, revealedIds, activeFindingId, overlay, showDicomOverlays, annotations, draft, scan, rotation, flipH, flipV, pxMm, renderTick]);

  // Nabız animasyonu
  const animate = !!scan?.active || (!!series && findings.some((f) => f.bbox && revealedIds.has(f.id) && slice >= f.sliceStart && slice <= f.sliceEnd));
  useEffect(() => {
    if (!animate) return;
    let raf = 0;
    let last = 0;
    const loop = (now: number) => {
      // 20 fps nabız yeterlidir; her görüntü panelini 60 fps React render'a zorlamayın.
      if (now - last >= 50) { last = now; setTick((t) => (t + 1) % 1e6); }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [animate]);

  // Esc iptal / Enter çokgeni bitir
  const finishPolygon = useCallback((pts: Pt[]) => {
    if (!series || pts.length < 3) { setDraft(null); return; }
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const st = regionStats(series, slice, { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }, (x, y) => pointInPolygon(x, y, pts));
    if (st) onAddAnnotation?.({ kind: "polygon", slice, points: pts, stats: st });
    setDraft(null);
  }, [series, slice, onAddAnnotation]);

  useEffect(() => {
    if (!draft) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDraft(null);
      if (e.key === "Enter" && draft.mode === "multi" && draft.tool === "polygon") finishPolygon(draft.pts);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [draft, finishPolygon]);

  useEffect(() => setDraft(null), [slice, series, tool]);

  // ───────── Etkileşimler ─────────
  const local = (e: React.PointerEvent | React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { cx: e.clientX - r.left, cy: e.clientY - r.top };
  };
  const annTool = !readOnly && (DRAG_TOOLS.includes(tool) || tool === "angle" || tool === "cobb" || tool === "polygon");

  const onDown = (e: React.PointerEvent) => {
    if (!series) return;
    const { cx, cy } = local(e);
    const p = canvasToImg(cx, cy);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (e.button === 0 && annTool) {
      if (DRAG_TOOLS.includes(tool)) setDraft({ mode: "drag", tool, a: p, b: p });
      else {
        const need = MULTI_NEED[tool];
        const prev = draft?.mode === "multi" && draft.tool === tool ? draft.pts : [];
        if (tool === "polygon" && prev.length >= 3 && dist(toScreen(prev[0]), { x: cx, y: cy }) < 9) { finishPolygon(prev); return; }
        const pts = [...prev, p];
        if (need && pts.length === need) {
          if (tool === "angle") onAddAnnotation?.({ kind: "angle", slice, points: pts });
          else onAddAnnotation?.({ kind: "cobb", slice, points: pts });
          setDraft(null);
        } else setDraft({ mode: "multi", tool, pts, cursor: p });
      }
      return;
    }
    dragRef.current = { button: e.button, sx: cx, sy: cy, wl, ww, zoom, pan: { ...pan } };
  };

  const toScreen = (p: Pt) => {
    const { scale, ox, oy } = getTransform();
    const d = imgToDisp(p);
    return { x: ox + d.x * scale, y: oy + d.y * scale };
  };

  const onMove = (e: React.PointerEvent) => {
    if (!series) return;
    const { cx, cy } = local(e);
    const p = canvasToImg(cx, cy);
    const inside = p.x >= 0 && p.y >= 0 && p.x < series.width && p.y < series.height;
    onHover?.(inside ? series.slices[slice][Math.floor(p.y) * series.width + Math.floor(p.x)] : null);
    if (draft?.mode === "multi") setDraft({ ...draft, cursor: p });
    else if (draft?.mode === "drag") setDraft({ ...draft, b: p });
    const d = dragRef.current;
    if (!d) return;
    const dx = cx - d.sx, dy = cy - d.sy;
    const eff: ToolName = d.button === 1 ? "pan" : d.button === 2 ? "zoom" : tool;
    if (eff === "wl" && !series.isColor) onWL(d.wl + dy * (series.unit === "HU" ? 2 : 4), Math.max(1, d.ww + dx * (series.unit === "HU" ? 4 : 6)));
    else if (eff === "pan") onPan({ x: d.pan.x + dx, y: d.pan.y + dy });
    else if (eff === "zoom") onZoom(Math.min(12, Math.max(0.15, d.zoom * Math.exp(-dy / 180))));
  };

  const onUp = () => {
    dragRef.current = null;
    if (!series || draft?.mode !== "drag") return;
    const { a, b, tool: t } = draft;
    setDraft(null);
    if (dist(a, b) < 2) return;
    if (t === "length") onAddAnnotation?.({ kind: "length", slice, points: [a, b] });
    else if (t === "calib") onCalibrate?.(dist(a, b));
    else if (t === "arrow") onAddAnnotation?.({ kind: "arrow", slice, points: [a, b], text: window.prompt("Ok notu (isteğe bağlı)", "") ?? "" });
    else if (t === "rect") {
      const st = regionStats(series, slice, { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) }, () => true);
      if (st) onAddAnnotation?.({ kind: "rect", slice, points: [a, b], stats: st });
    } else if (t === "ellipse") {
      const cxx = (a.x + b.x) / 2, cyy = (a.y + b.y) / 2;
      const st = regionStats(series, slice, { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) }, ellipseTest(cxx, cyy, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2));
      if (st) onAddAnnotation?.({ kind: "ellipse", slice, points: [a, b], stats: st });
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    if (!series) return;
    if (e.ctrlKey || e.metaKey) onZoom(Math.min(12, Math.max(0.15, zoom * (e.deltaY > 0 ? 0.9 : 1.1))));
    else onSlice(Math.max(0, Math.min(series.slices.length - 1, slice + (e.deltaY > 0 ? 1 : -1))));
  };

  const current = findings.filter((f) => revealedIds.has(f.id) && slice >= f.sliceStart && slice <= f.sliceEnd && f.category !== "Sistem");

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden bg-[#07090c]" style={{ touchAction: "none" }}>
      <canvas
        ref={canvasRef}
        style={{ width: size.w, height: size.h, cursor: tool === "pan" ? "grab" : "crosshair" }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={() => onHover?.(null)}
        onDoubleClick={() => { if (draft?.mode === "multi" && draft.tool === "polygon") finishPolygon(draft.pts.slice(0, -1).length >= 3 ? draft.pts.slice(0, -1) : draft.pts); }}
        onWheel={onWheel}
        onContextMenu={(e) => e.preventDefault()}
      />
      {label && <div className="pointer-events-none absolute left-2 top-2 rounded bg-black/60 px-2 py-0.5 font-mono text-[10px] text-violet-200">{label}</div>}
      {current.length > 0 && (
        <div className="pointer-events-none absolute left-1/2 top-12 flex -translate-x-1/2 flex-col items-center gap-1">
          {current.map((cf) => (
            <div key={cf.id} className="flex items-center gap-2 rounded-full px-3 py-1 text-xs font-bold shadow-lg backdrop-blur-md" style={{ background: "rgba(11,15,22,0.9)", border: `1.5px solid ${SEV_COLOR[cf.severity] ?? "#22d3ee"}`, color: SEV_COLOR[cf.severity] ?? "#22d3ee" }}>
              🔍 KESİT {cf.keySliceNumber}{slice === cf.sliceIndex ? " (en belirgin)" : ""}: {cf.label}
            </div>
          ))}
        </div>
      )}
      {draft?.mode === "multi" && (
        <div className="pointer-events-none absolute bottom-8 left-1/2 -translate-x-1/2 rounded bg-black/70 px-3 py-1 text-[11px] text-slate-200">
          {draft.tool === "polygon" ? "Çokgen: noktalara tıklayın · çift tık/Enter: bitir · Esc: iptal" : `${draft.pts.length}/${MULTI_NEED[draft.tool]} nokta · Esc: iptal`}
        </div>
      )}
    </div>
  );
}
