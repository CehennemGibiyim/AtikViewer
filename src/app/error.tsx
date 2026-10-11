"use client";

import { useEffect } from "react";

/** Yakalanamayan bir hatada sessiz/tıklanmayan menü yerine anlaşılır kurtarma ekranı. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error("Uygulama hatası", error); }, [error]);
  return (
    <div className="flex h-dvh items-center justify-center bg-[#070a0f] p-6 text-slate-200">
      <section role="alert" className="w-full max-w-lg rounded-xl border border-amber-400/30 bg-[#0b1018] p-6">
        <h1 className="text-lg font-bold text-cyan-200">Arayüz yeniden yüklenmeli</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-400">Bir görüntüleme hatası oluştu. Hasta kayıtlarını veya raporları silmeden tekrar deneyebilirsiniz.</p>
        <div className="mt-5 flex flex-wrap gap-2">
          <button type="button" onClick={reset} className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950">Tekrar dene</button>
          <a href="/" className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200">Görüntüleyiciyi yeniden aç</a>
        </div>
      </section>
    </div>
  );
}
