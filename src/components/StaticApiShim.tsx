"use client";

/**
 * GitHub Pages (statik demo) yalnızca dosya sunar; /api/* uçları yoktur.
 * Bu modül, o istekleri ağa gitmeden hemen 503 JSON ile yanıtlar; böylece arayüz
 * (görüntüleme, MPR, AI inceleme, ölçüm) tarayıcıda çalışır, sunucu özellikleri
 * (çalışma listesi, kayıtlı rapor, PACS) sessizce devre dışı kalır.
 * Yalnızca scripts/prepare-pages.sh tarafından Pages derlemesine eklenir.
 */
if (typeof window !== "undefined" && !(window as unknown as { __apiShim?: boolean }).__apiShim) {
  (window as unknown as { __apiShim?: boolean }).__apiShim = true;
  const orig = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (/^\/api\//.test(url)) {
      return Promise.resolve(
        new Response(JSON.stringify({ error: "Statik demo: sunucu özellikleri kapalı" }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }
    return orig(input, init);
  };
}

export default function StaticApiShim() {
  return null;
}
