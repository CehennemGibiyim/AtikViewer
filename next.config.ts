import type { NextConfig } from "next";

// GitHub Pages (statik demo) derlemesi: GITHUB_PAGES=true ile açılır. Ayrıntı: scripts/prepare-pages.sh
const pages = process.env.GITHUB_PAGES === "true";
const basePath = pages ? (process.env.NEXT_PUBLIC_BASE_PATH ?? "") : "";

const nextConfig: NextConfig = {
  ...(pages ? { output: "export" as const, basePath, trailingSlash: true, images: { unoptimized: true } } : {}),
  // statik dışa aktarımda başlıklar desteklenmez
  ...(pages ? {} : { async headers() {
    return [
      {
        source: "/",
        headers: [{ key: "Cache-Control", value: "no-store, no-cache, must-revalidate" }],
      },
      {
        source: "/yonetim",
        headers: [{ key: "Cache-Control", value: "no-store, no-cache, must-revalidate" }],
      },
      {
        source: "/kiyaslama",
        headers: [{ key: "Cache-Control", value: "no-store, no-cache, must-revalidate" }],
      },
      {
        // Görüntü çözücüleri (JPEG 2000 / HTJ2K / JPEG-LS WASM) uygulama kısıtlı bir iframe içinde
        // (sandbox, allow-same-origin olmadan → köken "null") açıldığında da yüklenebilmeli.
        // Bu dosyalar herkese açık statik kütüphanelerdir; hasta verisi içermez.
        source: "/codecs/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Cross-Origin-Resource-Policy", value: "cross-origin" },
          { key: "Cache-Control", value: "public, max-age=86400" },
        ],
      },
    ];
  } }),
};

export default nextConfig;
