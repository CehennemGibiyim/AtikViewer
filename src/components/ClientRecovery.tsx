"use client";

import { useEffect, useState } from "react";

const BUILD = "2026.10.11-image-review-r5";
const STALE = /ChunkLoadError|Loading chunk|dynamically imported module|Failed to fetch.*_next|MIME type.*module/i;

/** Yayın sırasında açık kalan önizleme eski JS parçasında kalırsa tek seferlik temiz navigasyon yapar. */
export default function ClientRecovery() {
  const [stale, setStale] = useState(false);
  useEffect(() => {
    const previous = sessionStorage.getItem("atik-build");
    sessionStorage.setItem("atik-build", BUILD);
    if (previous && previous !== BUILD) {
      const u = new URL(window.location.href);
      if (u.searchParams.get("fresh") !== BUILD) {
        u.searchParams.set("fresh", BUILD);
        window.location.replace(u.toString());
        return;
      }
    }
    const onError = (event: ErrorEvent | PromiseRejectionEvent) => {
      const reason = event instanceof ErrorEvent ? event.message : String(event.reason?.message ?? event.reason ?? "");
      if (STALE.test(reason)) setStale(true);
    };
    window.addEventListener("error", onError as EventListener);
    window.addEventListener("unhandledrejection", onError as EventListener);
    return () => {
      window.removeEventListener("error", onError as EventListener);
      window.removeEventListener("unhandledrejection", onError as EventListener);
    };
  }, []);

  if (!stale) return null;
  return (
    <div className="fixed inset-x-0 top-0 z-[100] flex items-center justify-center gap-3 bg-amber-400 px-4 py-2 text-xs font-bold text-slate-950 shadow-xl">
      Eski arayüz paketi algılandı. Düğmelerin çalışması için güncelleyin.
      <a href={`/?fresh=${BUILD}`} className="rounded bg-slate-950 px-3 py-1.5 text-white">Şimdi yenile</a>
    </div>
  );
}

export const APP_BUILD = BUILD;
