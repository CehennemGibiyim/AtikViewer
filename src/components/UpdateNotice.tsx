"use client";

import { useEffect, useState } from "react";
import { APP_VERSION, GITHUB_REPO, RELEASES_PAGE } from "@/lib/version";

const DISMISS_KEY = "atikviewer.guncelleme.gizlenen";

type Release = {
  tag_name?: string;
  html_url?: string;
  assets?: { name?: string; browser_download_url?: string }[];
};

type UpdateInfo = { version: string; page: string; download: string | null };

function parseVersion(v: string): number[] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function isNewer(latest: string, current: string): boolean {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return false;
}

/**
 * Açılışta kendi sürüm kütüphanemizi (GitHub Releases) yoklar ve daha yeni bir sürüm
 * varsa kurulum dosyasının indirme bağlantısını gösterir. Ağ yoksa/çevrimdışıysa sessizce
 * hiçbir şey yapmaz; görüntüleyicinin açılışını bekletmez veya engellemez.
 */
export default function UpdateNotice() {
  const [release, setRelease] = useState<UpdateInfo | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    (async () => {
      try {
        const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
          headers: { Accept: "application/vnd.github+json" },
          cache: "no-store",
          signal: controller.signal,
        });
        if (!res.ok) return;

        const data = (await res.json()) as Release;
        const tag = data.tag_name ?? "";
        if (!isNewer(tag, APP_VERSION)) return;

        try {
          if (window.localStorage.getItem(DISMISS_KEY) === tag) return;
        } catch {
          /* localStorage kapalıysa bildirim yine gösterilir */
        }

        const setup = (data.assets ?? []).find(
          (a) => /setup\.exe$/i.test(a.name ?? "") && typeof a.browser_download_url === "string"
        );

        setRelease({
          version: tag.replace(/^v/i, ""),
          page: data.html_url ?? RELEASES_PAGE,
          download: setup?.browser_download_url ?? null,
        });
      } catch {
        /* Çevrimdışı veya API'ye ulaşılamıyor: güncelleme kontrolü atlanır. */
      } finally {
        clearTimeout(timer);
      }
    })();

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, []);

  if (!release) return null;

  const dismiss = () => {
    try {
      window.localStorage.setItem(DISMISS_KEY, `v${release.version}`);
    } catch {
      /* yoksay */
    }
    setRelease(null);
  };

  return (
    <div
      role="status"
      className="fixed bottom-4 right-4 z-[60] w-[23rem] max-w-[calc(100vw-2rem)] rounded-xl border border-emerald-500/40 bg-[#0b1220]/95 p-4 text-sm text-slate-200 shadow-2xl backdrop-blur"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-emerald-300">Yeni sürüm v{release.version} hazır</p>
          <p className="mt-1 leading-relaxed text-slate-400">
            Kurulu sürüm v{APP_VERSION}. Güncellemeyi kendi sürüm kütüphanemizden indirebilirsiniz.
          </p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Güncelleme bildirimini kapat"
          className="rounded px-1 text-lg leading-none text-slate-500 hover:text-slate-200"
        >
          ×
        </button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <a
          href={release.download ?? release.page}
          target="_blank"
          rel="noreferrer"
          className="rounded-lg bg-emerald-600 px-3 py-1.5 font-medium text-white hover:bg-emerald-500"
        >
          {release.download ? "Kurulum dosyasını indir" : "Sürümü aç"}
        </a>
        <a
          href={release.page}
          target="_blank"
          rel="noreferrer"
          className="rounded-lg border border-slate-700 px-3 py-1.5 text-slate-300 hover:border-slate-500"
        >
          Sürüm notları
        </a>
      </div>
    </div>
  );
}
