"use client";

import { useCallback, useEffect, useState } from "react";
import type { NotificationRow } from "@/lib/types";

export default function NotificationsBell() {
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/notifications");
      if (r.ok) setItems((await r.json()) as NotificationRow[]);
    } catch {
      /* çevrimdışı */
    }
  }, []);
  useEffect(() => {
    void (async () => { await load(); })();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, [load]);

  const unacked = items.filter((n) => !n.ackAt).length;
  const ack = async (id: number) => {
    await fetch("/api/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    void load();
  };

  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)} title="Kritik bulgu bildirimleri" className={`relative cursor-pointer rounded-md px-2 py-1.5 text-sm ${unacked ? "text-rose-300" : "text-slate-400 hover:text-slate-200"}`}>
        🔔
        {unacked > 0 && <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-rose-500 px-1 text-center text-[9px] font-black text-white">{unacked}</span>}
      </button>
      {open && (
        <div className="absolute right-0 top-9 z-40 w-96 overflow-hidden rounded-xl border border-[#232e40] bg-[#0b0f16] shadow-2xl">
          <div className="border-b border-[#1a2230] px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">Kritik bulgu bildirimleri</div>
          <div className="max-h-80 overflow-y-auto">
            {items.length === 0 && <p className="p-4 text-center text-xs text-slate-500">Bildirim yok.</p>}
            {items.map((n) => (
              <div key={n.id} className="border-b border-[#141b26] p-3 text-[11px]">
                <div className="flex items-center justify-between">
                  <span className={`rounded px-1.5 py-0.5 font-mono text-[9px] font-black ${n.severity === "kritik" ? "bg-rose-500/20 text-rose-300" : "bg-orange-500/20 text-orange-300"}`}>{n.severity.toUpperCase()}</span>
                  <span className="font-mono text-[9.5px] text-slate-500">{new Date(n.createdAt).toLocaleString("tr-TR")}</span>
                </div>
                <p className="mt-1 text-slate-200">{n.message}</p>
                {n.ackAt ? (
                  <p className="mt-1 text-[10px] text-emerald-300">✓ {n.ackByName} tarafından alındı · {new Date(n.ackAt).toLocaleTimeString("tr-TR")}</p>
                ) : (
                  <button onClick={() => void ack(n.id)} className="mt-1.5 cursor-pointer rounded bg-cyan-500 px-2.5 py-1 text-[10.5px] font-bold text-slate-950 hover:bg-cyan-400">Alındı olarak işaretle</button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
