"use client";

import { useEffect, useState } from "react";
import type { HangingProtocolCellConfig, HangingProtocolRule, Layout } from "@/lib/types";
import {
  exportProtocolsJson,
  getAllProtocols,
  importProtocolsJson,
  isHangingProtocol,
  loadUserProtocols,
  saveUserProtocols,
  SYSTEM_HANGING_PROTOCOLS,
} from "@/lib/hangingProtocols";

interface Props {
  open: boolean;
  onClose: () => void;
  onApplyProtocol: (protocol: HangingProtocolRule) => void;
}

const LAYOUTS: Layout[] = ["1x1", "1x2", "2x1", "2x2", "1x3", "3x1", "2x3", "3x2"];

const DEFAULT_CELL: HangingProtocolCellConfig = {
  cellIndex: 0,
  seriesMatcher: { sequenceIndex: 0 },
  windowPreset: "Beyin",
  syncSlice: true,
};

export default function HangingProtocolEditorModal({ open, onClose, onApplyProtocol }: Props) {
  const [protocols, setProtocols] = useState<HangingProtocolRule[]>(() => getAllProtocols());
  const [selectedId, setSelectedId] = useState<string>(protocols[0]?.id || "sys-ct-head");
  const [editingRule, setEditingRule] = useState<HangingProtocolRule | null>(null);
  const [importJson, setImportJson] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (!open) return;
    const all = getAllProtocols();
    setProtocols(all);
    setSelectedId((id) => all.some((r) => r.id === id) ? id : all[0]?.id ?? "");
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [open, onClose]);

  if (!open) return null;

  const currentRule = protocols.find((p) => p.id === selectedId) || protocols[0];
  const isEditing = editingRule !== null;
  const activeRule = editingRule || currentRule;

  const startCreate = () => {
    const newId = `custom-${Date.now()}`;
    const newRule: HangingProtocolRule = {
      id: newId,
      name: "Yeni Özel Asma Protokolü",
      description: "Özel kural açıklaması",
      isSystem: false,
      match: {
        modalities: ["CT"],
        bodyParts: ["HEAD"],
        seriesDescriptionRegex: "",
      },
      layout: "1x2",
      cells: [
        { cellIndex: 0, seriesMatcher: { sequenceIndex: 0 }, windowPreset: "Beyin", syncSlice: true },
        { cellIndex: 1, seriesMatcher: { sequenceIndex: 0 }, windowPreset: "Kemik", syncSlice: true },
      ],
    };
    setEditingRule(newRule);
  };

  const startEdit = (rule: HangingProtocolRule) => {
    setEditingRule(JSON.parse(JSON.stringify(rule)));
  };

  const handleSave = () => {
    if (!editingRule) return;
    if (!isHangingProtocol(editingRule)) {
      setMsg("Protokol kaydedilemedi: ad, regex, düzen ve panel değerlerini kontrol edin.");
      return;
    }
    const userRules = loadUserProtocols();
    const existingIdx = userRules.findIndex((r) => r.id === editingRule.id);

    let updated: HangingProtocolRule[];
    if (existingIdx >= 0) {
      updated = [...userRules];
      updated[existingIdx] = { ...editingRule, isSystem: false };
    } else {
      updated = [...userRules, { ...editingRule, isSystem: false }];
    }

    const persistent = saveUserProtocols(updated);
    const refreshed = getAllProtocols();
    setProtocols(refreshed);
    setSelectedId(editingRule.id);
    setEditingRule(null);
    setMsg(persistent ? "✓ Protokol kaydedildi." : "✓ Bu sekmede kaydedildi; tarayıcı kalıcı depolamayı engelliyor.");
    setTimeout(() => setMsg(""), 3000);
  };

  const handleDelete = (id: string) => {
    if (!window.confirm("Bu özel protokolü silmek istediğinize emin misiniz?")) return;
    const userRules = loadUserProtocols().filter((r) => r.id !== id);
    saveUserProtocols(userRules);
    const refreshed = getAllProtocols();
    setProtocols(refreshed);
    setSelectedId(refreshed[0]?.id || "");
    if (editingRule?.id === id) setEditingRule(null);
  };

  const handleExport = () => {
    const json = exportProtocolsJson(loadUserProtocols());
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "atik_hanging_protocols.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };

  const handleImportSubmit = () => {
    try {
      const imported = importProtocolsJson(importJson);
      const current = loadUserProtocols();
      const merged = Array.from(new Map([...current, ...imported].map((rule) => [rule.id, rule])).values());
      saveUserProtocols(merged);
      const refreshed = getAllProtocols();
      setProtocols(refreshed);
      setShowImport(false);
      setImportJson("");
      setMsg(`✓ ${imported.length} protokol başarıyla içe aktarıldı!`);
      setTimeout(() => setMsg(""), 3000);
    } catch (err) {
      setMsg(`İçe aktarma hatası: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="hanging-editor-title" className="flex h-full max-h-[90dvh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-[#232e40] bg-[#0b0f16] shadow-2xl text-slate-200">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1a2230] px-4 py-3 bg-[#0d121c]">
          <div className="flex items-center gap-2">
            <span className="rounded bg-violet-500/20 px-2 py-0.5 font-mono text-[10px] font-bold text-violet-300 border border-violet-500/40">
              HANGING PROTOCOLS ENGINE
            </span>
            <h2 id="hanging-editor-title" className="text-sm font-bold text-slate-100">Kullanıcı Tanımlı Asma Protokolü Editörü</h2>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {msg && <span role="status" className="text-xs font-bold text-emerald-400 mr-2">{msg}</span>}
            <button type="button"
              onClick={startCreate}
              className="cursor-pointer rounded bg-cyan-500 px-3 py-1.5 text-xs font-bold text-slate-950 hover:bg-cyan-400"
            >
              ＋ Yeni Protokol Ekle
            </button>
            <button type="button"
              onClick={() => setShowImport(!showImport)}
              className="cursor-pointer rounded border border-[#2d3b4e] bg-[#141b24] px-2.5 py-1.5 text-xs font-semibold text-slate-200 hover:bg-[#1f2937]"
            >
              İçe Aktar (JSON)
            </button>
            <button type="button"
              onClick={handleExport}
              className="cursor-pointer rounded border border-[#2d3b4e] bg-[#141b24] px-2.5 py-1.5 text-xs font-semibold text-slate-200 hover:bg-[#1f2937]"
            >
              Dışa Aktar (JSON)
            </button>
            <button type="button"
              aria-label="Protokol penceresini kapat"
              onClick={onClose}
              className="cursor-pointer rounded border border-[#2d3b4e] bg-[#141b24] p-1.5 text-xs text-slate-400 hover:text-white ml-2"
            >
              ✕
            </button>
          </div>
        </div>

        {/* JSON Import Section */}
        {showImport && (
          <div className="border-b border-[#1a2230] bg-[#080d14] p-3 text-xs">
            <div className="font-bold text-slate-300 mb-1">JSON Formatında Asma Protokolü Yapıştırın:</div>
            <textarea
              rows={4}
              value={importJson}
              onChange={(e) => setImportJson(e.target.value)}
              placeholder='[ { "name": "Özel Protokol", "match": { ... }, "layout": "1x2", "cells": [...] } ]'
              className="w-full rounded border border-[#1e2735] bg-[#0e141d] p-2 font-mono text-xs text-slate-200"
            />
            <div className="mt-2 flex justify-end gap-2">
              <button type="button"
                onClick={() => setShowImport(false)}
                className="cursor-pointer rounded border border-[#2d3b4e] px-3 py-1 text-slate-400"
              >
                İptal
              </button>
              <button type="button"
                onClick={handleImportSubmit}
                className="cursor-pointer rounded bg-emerald-500 px-3 py-1 font-bold text-black"
              >
                İçe Aktarımı Tamamla
              </button>
            </div>
          </div>
        )}

        {/* Content Body */}
        <div className="flex flex-1 min-h-0">
          {/* Left: Protocols List */}
          <div className="w-44 shrink-0 border-r sm:w-64 border-[#1a2230] bg-[#080c12] p-2 overflow-y-auto">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 px-2 py-1">
              Sistem Protokolleri ({SYSTEM_HANGING_PROTOCOLS.length})
            </div>
            {protocols
              .filter((p) => p.isSystem)
              .map((p) => (
                <button type="button"
                  key={p.id}
                  onClick={() => {
                    setSelectedId(p.id);
                    setEditingRule(null);
                  }}
                  className={`w-full text-left p-2 rounded-lg mb-1 border cursor-pointer transition-all ${
                    selectedId === p.id && !isEditing
                      ? "border-cyan-400/60 bg-cyan-400/10 text-cyan-200"
                      : "border-transparent bg-[#0c121c] text-slate-300 hover:border-[#1e2735]"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs">{p.name}</span>
                    <span className="font-mono text-[9px] bg-[#162234] px-1.5 py-0.5 rounded text-cyan-300">
                      {p.layout}
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-400 truncate mt-0.5">{p.description}</div>
                </button>
              ))}

            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 px-2 py-1 mt-3">
              Özel Protokoller ({protocols.filter((p) => !p.isSystem).length})
            </div>
            {protocols.filter((p) => !p.isSystem).length === 0 && (
              <div className="px-2 py-2 text-[11px] text-slate-500 italic">Henüz özel protokol eklenmedi.</div>
            )}
            {protocols
              .filter((p) => !p.isSystem)
              .map((p) => (
                <div
                  key={p.id}
                  className={`flex items-center justify-between p-2 rounded-lg mb-1 border cursor-pointer transition-all ${
                    selectedId === p.id || editingRule?.id === p.id
                      ? "border-violet-400/60 bg-violet-400/10 text-violet-200"
                      : "border-transparent bg-[#0c121c] text-slate-300 hover:border-[#1e2735]"
                  }`}
                  onClick={() => {
                    setSelectedId(p.id);
                    setEditingRule(null);
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-xs truncate">{p.name}</span>
                      <span className="font-mono text-[9px] bg-violet-950 px-1.5 py-0.5 rounded text-violet-300 ml-1">
                        {p.layout}
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-400 truncate mt-0.5">{p.description}</div>
                  </div>

                  <button type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(p.id);
                    }}
                    className="ml-2 text-slate-500 hover:text-rose-400 p-1"
                    title="Sil"
                  >
                    ✕
                  </button>
                </div>
              ))}
          </div>

          {/* Right: Protocol Details & Editor */}
          <div className="flex-1 p-4 overflow-y-auto bg-[#0b0f16]">
            {activeRule && (
              <div className="space-y-4">
                {/* Header info / edit */}
                <div className="rounded-xl border border-[#1e2735] bg-[#0e141d] p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-bold text-slate-100">{activeRule.name}</h3>
                      <span
                        className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                          activeRule.isSystem
                            ? "bg-slate-700/40 text-slate-300"
                            : "bg-violet-500/20 text-violet-300 border border-violet-500/40"
                        }`}
                      >
                        {activeRule.isSystem ? "Sistem Protokolü" : "Özel Protokol"}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      {!isEditing && !activeRule.isSystem && (
                        <button type="button"
                          onClick={() => startEdit(activeRule)}
                          className="cursor-pointer rounded bg-cyan-500/20 px-3 py-1 text-xs font-bold text-cyan-200 border border-cyan-500/40 hover:bg-cyan-500/30"
                        >
                          ✎ Düzenle
                        </button>
                      )}
                      {!isEditing && (
                        <button type="button"
                          onClick={() => {
                            onApplyProtocol(activeRule);
                            onClose();
                          }}
                          className="cursor-pointer rounded bg-emerald-500 px-4 py-1 text-xs font-bold text-black hover:bg-emerald-400"
                        >
                          ▶ Şimdi Uygula
                        </button>
                      )}
                    </div>
                  </div>

                  {isEditing ? (
                    <div className="space-y-2 mt-3">
                      <div>
                        <label className="text-[11px] font-semibold text-slate-400">Protokol Adı:</label>
                        <input
                          type="text"
                          value={editingRule.name}
                          onChange={(e) => setEditingRule({ ...editingRule, name: e.target.value })}
                          className="w-full mt-1 rounded border border-[#1e2735] bg-[#080c12] px-2.5 py-1.5 text-xs text-white"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] font-semibold text-slate-400">Açıklama:</label>
                        <input
                          type="text"
                          value={editingRule.description}
                          onChange={(e) => setEditingRule({ ...editingRule, description: e.target.value })}
                          className="w-full mt-1 rounded border border-[#1e2735] bg-[#080c12] px-2.5 py-1.5 text-xs text-white"
                        />
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-400">{activeRule.description}</p>
                  )}
                </div>

                {/* Match Criteria */}
                <div className="rounded-xl border border-[#1e2735] bg-[#0e141d] p-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                    Otomatik Eşleşme Kriterleri
                  </h4>

                  {isEditing ? (
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <label className="font-semibold text-slate-400">Modaliteler (virgülle ayırın):</label>
                        <input
                          type="text"
                          value={(editingRule.match.modalities || []).join(", ")}
                          onChange={(e) =>
                            setEditingRule({
                              ...editingRule,
                              match: {
                                ...editingRule.match,
                                modalities: e.target.value.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean),
                              },
                            })
                          }
                          placeholder="Örn: CT, MR, CR"
                          className="w-full mt-1 rounded border border-[#1e2735] bg-[#080c12] p-1.5 text-white"
                        />
                      </div>

                      <div>
                        <label className="font-semibold text-slate-400">Vücut Bölgeleri:</label>
                        <input
                          type="text"
                          value={(editingRule.match.bodyParts || []).join(", ")}
                          onChange={(e) =>
                            setEditingRule({
                              ...editingRule,
                              match: {
                                ...editingRule.match,
                                bodyParts: e.target.value.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean),
                              },
                            })
                          }
                          placeholder="Örn: HEAD, CHEST, ABDOMEN"
                          className="w-full mt-1 rounded border border-[#1e2735] bg-[#080c12] p-1.5 text-white"
                        />
                      </div>

                      <div className="col-span-2">
                        <label className="font-semibold text-slate-400">Seri Açıklaması Regex / Arama:</label>
                        <input
                          type="text"
                          value={editingRule.match.seriesDescriptionRegex || ""}
                          onChange={(e) =>
                            setEditingRule({
                              ...editingRule,
                              match: { ...editingRule.match, seriesDescriptionRegex: e.target.value },
                            })
                          }
                          placeholder="Örn: HEAD|BRAIN|AXIAL"
                          className="w-full mt-1 rounded border border-[#1e2735] bg-[#080c12] p-1.5 text-white"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2 text-xs font-mono text-slate-300">
                      <div>
                        <span className="text-slate-500">Modaliteler: </span>
                        {(activeRule.match.modalities || ["Tümü"]).join(", ")}
                      </div>
                      <div>
                        <span className="text-slate-500">Vücut Bölgeleri: </span>
                        {(activeRule.match.bodyParts || ["Tümü"]).join(", ")}
                      </div>
                      <div className="col-span-2">
                        <span className="text-slate-500">Seri Eşleşme Deseni: </span>
                        {activeRule.match.seriesDescriptionRegex || "—"}
                      </div>
                    </div>
                  )}
                </div>

                {/* Layout Grid & Cells Configuration */}
                <div className="rounded-xl border border-[#1e2735] bg-[#0e141d] p-3">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                      Izgara ve Panel Hücre Yapılandırması
                    </h4>

                    {isEditing && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-slate-400">Düzen:</span>
                        <select
                          value={editingRule.layout}
                          onChange={(e) => {
                            const newLayout = e.target.value as Layout;
                            const [rows, columns] = newLayout.split("x").map(Number);
                            const count = rows * columns;
                            const cells = Array.from({ length: count }, (_, index) =>
                              editingRule.cells.find((c) => c.cellIndex === index) ?? { ...DEFAULT_CELL, cellIndex: index, seriesMatcher: { sequenceIndex: editingRule.match.modalities?.includes("MR") ? index : 0 } }
                            );
                            setEditingRule({ ...editingRule, layout: newLayout, cells });
                          }}
                          className="rounded border border-[#1e2735] bg-[#080c12] px-2 py-1 text-xs text-cyan-300 font-bold"
                        >
                          {LAYOUTS.map((l) => (
                            <option key={l} value={l}>
                              {l}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>

                  {/* Visual Cell Grid preview */}
                  <div className="space-y-2">
                    {activeRule.cells.map((cell, idx) => (
                      <div key={idx} className="p-2.5 rounded-lg border border-[#1e2735] bg-[#080c12] text-xs">
                        <div className="flex items-center justify-between mb-1.5 font-bold">
                          <span className="text-cyan-300">Panel {idx + 1} (Hücre {cell.cellIndex})</span>
                          <span className="text-slate-400 font-mono text-[11px]">
                            {cell.windowPreset ? `Pencere: ${cell.windowPreset}` : "Varsayılan Pencere"}
                          </span>
                        </div>

                        {isEditing ? (
                          <div className="grid grid-cols-2 gap-2 text-xs mt-2">
                            <div>
                              <label className="text-[10px] text-slate-500 font-semibold">Pencere Ön Ayarı:</label>
                              <select
                                value={cell.windowPreset || ""}
                                onChange={(e) => {
                                  const updatedCells = [...editingRule.cells];
                                  updatedCells[idx] = { ...updatedCells[idx], windowPreset: e.target.value };
                                  setEditingRule({ ...editingRule, cells: updatedCells });
                                }}
                                className="w-full mt-0.5 rounded border border-[#1e2735] bg-[#0c121c] p-1 text-slate-200"
                              >
                                <option value="">Varsayılan</option>
                                <option value="Beyin">Beyin (40/80)</option>
                                <option value="Kemik">Kemik (500/2000)</option>
                                <option value="Akciğer">Akciğer (-600/1500)</option>
                                <option value="Mediasten">Mediasten (40/400)</option>
                                <option value="Yumuşak doku">Yumuşak doku (50/350)</option>
                                <option value="Karaciğer">Karaciğer (60/160)</option>
                              </select>
                            </div>

                            <div className="flex items-center gap-2 mt-4">
                              <label className="flex items-center gap-1.5 cursor-pointer text-slate-300">
                                <input
                                  type="checkbox"
                                  checked={cell.syncSlice !== false}
                                  onChange={(e) => {
                                    const updatedCells = [...editingRule.cells];
                                    updatedCells[idx] = { ...updatedCells[idx], syncSlice: e.target.checked };
                                    setEditingRule({ ...editingRule, cells: updatedCells });
                                  }}
                                  className="accent-cyan-400"
                                />
                                Kesit Konum Senkronu
                              </label>
                            </div>
                          </div>
                        ) : (
                          <div className="text-[11px] text-slate-400 flex items-center justify-between">
                            <span>
                              Eşleşen Seri: {cell.seriesMatcher?.descriptionRegex || `Sıra #${(cell.seriesMatcher?.sequenceIndex ?? 0) + 1}`}
                            </span>
                            <span>{cell.syncSlice ? "✓ Konum Senkronu Etkin" : "— Bağımsız Kaydırma"}</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Edit Action buttons */}
                {isEditing && (
                  <div className="flex justify-end gap-2 pt-2">
                    <button type="button"
                      onClick={() => setEditingRule(null)}
                      className="cursor-pointer rounded border border-[#2d3b4e] px-4 py-2 text-xs font-bold text-slate-300 hover:bg-[#1f2937]"
                    >
                      İptal
                    </button>
                    <button type="button"
                      onClick={handleSave}
                      className="cursor-pointer rounded bg-cyan-500 px-5 py-2 text-xs font-bold text-black hover:bg-cyan-400"
                    >
                      ✓ Değişiklikleri Kaydet
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
