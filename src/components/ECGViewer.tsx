"use client";

import { useEffect, useRef, useState } from "react";
import type { DicomECGWaveform, ECGChannel } from "@/lib/types";

interface Props {
  ecg: DicomECGWaveform;
}

type ECGLayout = "12x1" | "3x4" | "single";

export default function ECGViewer({ ecg }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<ECGLayout>("3x4");
  const [selectedLead, setSelectedLead] = useState<number>(1); // Lead II by default
  const [caliperMode, setCaliperMode] = useState(false);
  const [caliperPts, setCaliperPts] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [caliperActive, setCaliperActive] = useState(false);
  const [size, setSize] = useState({ w: 1000, h: 600 });

  // Gain & Speed controls
  const [gainMmPerMv, setGainMmPerMv] = useState<number>(10); // standard: 10 mm/mV
  const [speedMmPerSec, setSpeedMmPerSec] = useState<number>(25); // standard: 25 mm/s

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Render ECG Grid & Signals
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size.w * dpr;
    canvas.height = size.h * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // 1. ECG Pink Paper Background
    ctx.fillStyle = "#120a0d"; // Dark pink/medical theme for dark workstation
    ctx.fillRect(0, 0, size.w, size.h);

    const pxPerMm = 3.78; // standard screen pixel scale for mm
    const smallGridPx = 1 * pxPerMm; // 1mm
    const bigGridPx = 5 * pxPerMm;   // 5mm

    // Small Grid (1mm lines)
    ctx.strokeStyle = "rgba(225, 29, 72, 0.12)"; // subtle pink/red grid
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (let x = 0; x < size.w; x += smallGridPx) {
      ctx.moveTo(x, 0); ctx.lineTo(x, size.h);
    }
    for (let y = 0; y < size.h; y += smallGridPx) {
      ctx.moveTo(0, y); ctx.lineTo(size.w, y);
    }
    ctx.stroke();

    // Big Grid (5mm lines)
    ctx.strokeStyle = "rgba(225, 29, 72, 0.28)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x < size.w; x += bigGridPx) {
      ctx.moveTo(x, 0); ctx.lineTo(x, size.h);
    }
    for (let y = 0; y < size.h; y += bigGridPx) {
      ctx.moveTo(0, y); ctx.lineTo(size.w, y);
    }
    ctx.stroke();

    // 2. Render Leads based on Layout
    const channels = ecg.channels;
    const freq = ecg.samplingFrequency;
    const pxPerSec = speedMmPerSec * pxPerMm;
    const pxPerMv = gainMmPerMv * pxPerMm;

    ctx.strokeStyle = "#38bdf8"; // Medical cyan waveform
    ctx.lineWidth = 1.4;
    ctx.font = "bold 11px ui-monospace, monospace";

    if (layout === "single") {
      // Single full lead view
      const ch = channels[selectedLead] || channels[0];
      if (ch) {
        renderLead(ctx, ch, 0, size.h / 2, size.w, freq, pxPerSec, pxPerMv);
      }
    } else if (layout === "3x4") {
      // Standard 3x4 Diagnostic ECG Layout + Rhythm strip at bottom
      const numCols = 4;
      const numRows = 3;
      const colW = size.w / numCols;
      const rowH = (size.h * 0.78) / numRows;

      // Top 12 leads (2.5 seconds each column)
      // Col 0: I, II, III
      // Col 1: aVR, aVL, aVF
      // Col 2: V1, V2, V3
      // Col 3: V4, V5, V6
      const leadMatrix = [
        [0, 3, 6, 9],  // Row 0: I, aVR, V1, V4
        [1, 4, 7, 10], // Row 1: II, aVL, V2, V5
        [2, 5, 8, 11], // Row 2: III, aVF, V3, V6
      ];

      for (let r = 0; r < numRows; r++) {
        for (let c = 0; c < numCols; c++) {
          const chIdx = leadMatrix[r][c];
          const ch = channels[chIdx];
          if (!ch) continue;

          const startX = c * colW;
          const baselineY = (r + 0.5) * rowH;

          // Draw lead label
          ctx.fillStyle = "#fb7185";
          ctx.fillText(ch.leadName, startX + 8, baselineY - 22);

          // Draw waveform segment for this column (2.5s duration)
          const startSample = Math.floor(c * (freq * 2.5));
          const numSamples = Math.min(ch.samples.length - startSample, Math.floor(freq * 2.5));

          ctx.strokeStyle = "#38bdf8";
          ctx.beginPath();
          for (let s = 0; s < numSamples; s++) {
            const x = startX + (s / freq) * pxPerSec;
            const y = baselineY - ch.samples[startSample + s] * pxPerMv;
            if (s === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
      }

      // Bottom Rhythm Lead (Lead II full 10s)
      const rhythmCh = channels[1] || channels[0];
      if (rhythmCh) {
        const rhythmY = size.h * 0.88;
        ctx.fillStyle = "#fb7185";
        ctx.fillText(`RİTİM (${rhythmCh.leadName})`, 8, rhythmY - 24);
        renderLead(ctx, rhythmCh, 0, rhythmY, size.w, freq, pxPerSec, pxPerMv);
      }
    } else {
      // 12x1 Full Stacks
      const rowH = size.h / 12;
      channels.slice(0, 12).forEach((ch, idx) => {
        const baselineY = (idx + 0.5) * rowH;
        ctx.fillStyle = "#fb7185";
        ctx.fillText(ch.leadName, 8, baselineY - 14);
        renderLead(ctx, ch, 0, baselineY, size.w, freq, pxPerSec, pxPerMv);
      });
    }

    // 3. Draw Caliper if Active
    if (caliperPts) {
      const { x1, y1, x2, y2 } = caliperPts;
      ctx.strokeStyle = "#fbbf24";
      ctx.fillStyle = "#fbbf24";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 2]);

      // Vertical lines
      ctx.beginPath();
      ctx.moveTo(x1, 0); ctx.lineTo(x1, size.h);
      ctx.moveTo(x2, 0); ctx.lineTo(x2, size.h);
      ctx.stroke();

      // Horizontal measurement bar
      const midY = (y1 + y2) / 2;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(x1, midY); ctx.lineTo(x2, midY);
      ctx.stroke();

      // Measurement calculation
      const dtMs = Math.abs(x2 - x1) / pxPerSec * 1000;
      const dVMv = Math.abs(y2 - y1) / pxPerMv;
      const hrBpm = dtMs > 0 ? Math.round(60000 / dtMs) : 0;

      const label = `Δt: ${dtMs.toFixed(0)} ms (${hrBpm} bpm) · ΔV: ${dVMv.toFixed(2)} mV`;
      ctx.font = "bold 12px ui-monospace, monospace";
      ctx.fillStyle = "rgba(15, 23, 42, 0.9)";
      ctx.fillRect(Math.min(x1, x2) + 10, midY - 20, 240, 22);
      ctx.fillStyle = "#fbbf24";
      ctx.fillText(label, Math.min(x1, x2) + 16, midY - 5);
    }
  }, [ecg, layout, selectedLead, gainMmPerMv, speedMmPerSec, size, caliperPts]);

  function renderLead(
    ctx: CanvasRenderingContext2D,
    ch: ECGChannel,
    startX: number,
    baselineY: number,
    maxW: number,
    freq: number,
    pxPerSec: number,
    pxPerMv: number
  ) {
    ctx.strokeStyle = "#38bdf8";
    ctx.beginPath();
    const len = ch.samples.length;
    for (let s = 0; s < len; s++) {
      const x = startX + (s / freq) * pxPerSec;
      if (x > startX + maxW) break;
      const y = baselineY - ch.samples[s] * pxPerMv;
      if (s === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // Pointer events for Caliper
  const handlePointerDown = (e: React.PointerEvent) => {
    if (!caliperMode) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setCaliperPts({ x1: x, y1: y, x2: x, y2: y });
    setCaliperActive(true);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!caliperActive || !caliperPts) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setCaliperPts({ ...caliperPts, x2: e.clientX - r.left, y2: e.clientY - r.top });
  };

  const handlePointerUp = () => {
    setCaliperActive(false);
  };

  return (
    <div className="flex h-full w-full flex-col bg-[#070a0f] p-2 text-slate-200 overflow-hidden">
      {/* ECG Toolbar */}
      <div className="shrink-0 flex flex-wrap items-center justify-between gap-2 border-b border-[#1a2230] pb-2 mb-2 px-1">
        <div className="flex items-center gap-2">
          <span className="rounded bg-pink-500/20 px-2 py-0.5 font-mono text-[10px] font-bold text-pink-300 border border-pink-500/40">
            DICOM 12-LEAD ECG
          </span>
          <h2 className="text-sm font-bold text-slate-100">{ecg.title}</h2>
          <span className="font-mono text-[10px] text-slate-400">
            ({ecg.samplingFrequency} Hz · {ecg.durationSec.toFixed(1)} saniye)
          </span>
        </div>

        {/* Layout & Gain controls */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div className="flex items-center gap-1 bg-[#0c121c] p-1 rounded border border-[#1e2735]">
            <button
              onClick={() => setLayout("3x4")}
              className={`cursor-pointer px-2 py-0.5 rounded font-bold ${layout === "3x4" ? "bg-cyan-500 text-black" : "text-slate-300 hover:text-white"}`}
            >
              3×4 + Ritim
            </button>
            <button
              onClick={() => setLayout("12x1")}
              className={`cursor-pointer px-2 py-0.5 rounded font-bold ${layout === "12x1" ? "bg-cyan-500 text-black" : "text-slate-300 hover:text-white"}`}
            >
              12×1
            </button>
            <button
              onClick={() => setLayout("single")}
              className={`cursor-pointer px-2 py-0.5 rounded font-bold ${layout === "single" ? "bg-cyan-500 text-black" : "text-slate-300 hover:text-white"}`}
            >
              Tek Derivasyon
            </button>
          </div>

          {layout === "single" && (
            <select
              value={selectedLead}
              onChange={(e) => setSelectedLead(Number(e.target.value))}
              className="rounded border border-[#1e2735] bg-[#0c121c] px-2 py-1 text-slate-200"
            >
              {ecg.channels.map((ch, idx) => (
                <option key={idx} value={idx}>
                  Derivasyon {ch.leadName}
                </option>
              ))}
            </select>
          )}

          <select
            value={gainMmPerMv}
            onChange={(e) => setGainMmPerMv(Number(e.target.value))}
            className="rounded border border-[#1e2735] bg-[#0c121c] px-2 py-1 text-slate-200"
          >
            <option value={5}>5 mm/mV</option>
            <option value={10}>10 mm/mV (Std)</option>
            <option value={20}>20 mm/mV</option>
          </select>

          <select
            value={speedMmPerSec}
            onChange={(e) => setSpeedMmPerSec(Number(e.target.value))}
            className="rounded border border-[#1e2735] bg-[#0c121c] px-2 py-1 text-slate-200"
          >
            <option value={25}>25 mm/s (Std)</option>
            <option value={50}>50 mm/s</option>
          </select>

          <button
            onClick={() => {
              setCaliperMode(!caliperMode);
              if (caliperMode) setCaliperPts(null);
            }}
            className={`cursor-pointer rounded px-2.5 py-1 font-bold border ${caliperMode ? "bg-amber-400 text-black border-amber-300" : "bg-[#141b24] text-amber-300 border-amber-400/40"}`}
          >
            {caliperMode ? "📐 Kaliper Açık" : "📐 Kaliper (Ölç)"}
          </button>
        </div>
      </div>

      {/* Waveform Canvas */}
      <div ref={wrapRef} className="flex-1 rounded-lg border border-[#1e2735] bg-black overflow-hidden relative">
        <canvas
          ref={canvasRef}
          style={{ width: size.w, height: size.h, cursor: caliperMode ? "crosshair" : "default" }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        />

        {/* Legend */}
        <div className="absolute bottom-2 right-2 bg-slate-950/80 px-2.5 py-1 rounded border border-[#232e40] text-[10px] font-mono text-slate-400">
          Standart Kalibrasyon: {speedMmPerSec} mm/s, {gainMmPerMv} mm/mV · 1 küçük kare = 0.04s / 0.1mV · 1 büyük kare = 0.2s / 0.5mV
        </div>
      </div>
    </div>
  );
}
