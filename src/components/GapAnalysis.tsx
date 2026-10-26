"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  CATEGORIES,
  COMPETITORS,
  GAP_ITEMS,
  ROADMAP,
  SOURCES,
  type CategoryId,
  type CompetitorType,
  type GapEffort,
  type GapItem,
  type GapPriority,
  type GapStatus,
} from "@/lib/gapAnalysis";

const STATUS_META: Record<GapStatus, { label: string; cls: string; score: number }> = {
  var: { label: "VAR", cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40", score: 1 },
  kismi: { label: "KISMİ", cls: "bg-amber-500/15 text-amber-300 border-amber-500/40", score: 0.5 },
  yok: { label: "YOK", cls: "bg-rose-500/15 text-rose-300 border-rose-500/40", score: 0 },
};

const PRIORITY_META: Record<GapPriority, { label: string; cls: string }> = {
  P0: { label: "P0 · Kritik", cls: "bg-rose-500/20 text-rose-200 border-rose-500/50" },
  P1: { label: "P1 · Yüksek", cls: "bg-orange-500/15 text-orange-200 border-orange-500/40" },
  P2: { label: "P2 · Orta", cls: "bg-sky-500/15 text-sky-200 border-sky-500/40" },
  P3: { label: "P3 · Düşük", cls: "bg-slate-500/15 text-slate-300 border-slate-500/40" },
};

const EFFORT_LABEL: Record<GapEffort, string> = {
  S: "Küçük (≤ 2 gün)",
  M: "Orta (1–2 hafta)",
  L: "Büyük (≥ 1 ay)",
};

const TYPE_STYLE: Record<CompetitorType, string> = {
  viewer: "border-cyan-400/40 text-cyan-300 bg-cyan-400/5",
  ai: "border-amber-400/40 text-amber-300 bg-amber-400/5",
  report: "border-violet-400/40 text-violet-300 bg-violet-400/5",
};

const TYPE_LABEL: Record<CompetitorType, string> = {
  viewer: "Görüntüleyici",
  ai: "AI platformu",
  report: "Raporlama",
};

const NAME_TYPE: Record<string, CompetitorType> = Object.fromEntries(COMPETITORS.map((c) => [c.name, c.type]));

function coverage(items: GapItem[]): number {
  if (items.length === 0) return 0;
  return Math.round((items.reduce((s, i) => s + STATUS_META[i.status].score, 0) / items.length) * 100);
}

function barColor(pct: number): string {
  if (pct >= 70) return "from-emerald-400 to-teal-400";
  if (pct >= 40) return "from-amber-400 to-orange-400";
  return "from-rose-400 to-orange-500";
}

export default function GapAnalysis() {
  const [category, setCategory] = useState<CategoryId | "all">("all");
  const [status, setStatus] = useState<GapStatus | "all">("all");
  const [priority, setPriority] = useState<GapPriority | "all">("all");
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState(false);

  const itemById = useMemo(() => new Map(GAP_ITEMS.map((i) => [i.id, i])), []);

  const overall = useMemo(() => coverage(GAP_ITEMS), []);
  const counts = useMemo(
    () => ({
      var: GAP_ITEMS.filter((i) => i.status === "var").length,
      kismi: GAP_ITEMS.filter((i) => i.status === "kismi").length,
      yok: GAP_ITEMS.filter((i) => i.status === "yok").length,
      p0open: GAP_ITEMS.filter((i) => i.priority === "P0" && i.status !== "var").length,
    }),
    []
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return GAP_ITEMS.filter((i) => {
      if (category !== "all" && i.category !== category) return false;
      if (status !== "all" && i.status !== status) return false;
      if (priority !== "all" && i.priority !== priority) return false;
      if (q) {
        const hay = `${i.title} ${i.ours} ${i.action} ${i.market.join(" ")}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [category, status, priority, query]);

  const copyMarkdown = async () => {
    const lines: string[] = [
      "# ATIKVIEWER — Piyasa Kıyaslaması ve Eksik Analizi",
      "",
      `Genel kapsama: %${overall} (var ${counts.var} · kısmi ${counts.kismi} · yok ${counts.yok})`,
      "",
      "| Özellik | Durum | Öncelik | Efor | Piyasada | Aksiyon |",
      "| --- | --- | --- | --- | --- | --- |",
      ...GAP_ITEMS.map(
        (i) =>
          `| ${i.title} | ${STATUS_META[i.status].label} | ${i.priority} | ${i.effort} | ${i.market.join(", ")} | ${i.action} |`
      ),
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* pano erişimi yoksa sessiz geç */
    }
  };

  return (
    <div className="h-screen w-screen overflow-y-auto bg-[#070a0f] text-slate-200">
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-[#1a2230] bg-[#0b0f16]/95 px-5 py-3 backdrop-blur">
        <Link
          href="/"
          className="rounded-md border border-cyan-400/40 bg-cyan-500/10 px-3 py-1.5 text-xs font-bold text-cyan-300 hover:bg-cyan-500/20"
        >
          ← Görüntüleyiciye dön
        </Link>
        <h1 className="font-mono text-sm font-black tracking-[0.15em] text-slate-100">
          ATIK<span className="text-cyan-400">VIEWER</span> · PİYASA KIYASLAMASI
        </h1>
        <button
          onClick={copyMarkdown}
          className="ml-auto rounded-md border border-[#2d3b4e] bg-[#141b24] px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-[#1a2330]"
        >
          {copied ? "✓ Kopyalandı" : "Markdown olarak kopyala"}
        </button>
      </header>

      <main className="mx-auto max-w-7xl px-5 py-6">
        {/* Dürüstlük notu */}
        <section className="rounded-xl border border-amber-400/40 bg-amber-400/5 p-4">
          <h2 className="text-sm font-black tracking-wide text-amber-300">⚠ Kodla kapatılamayanlar ve açık kalan sınırlar</h2>
          <ul className="mt-2 grid gap-1.5 text-[12.5px] leading-relaxed text-slate-300 md:grid-cols-2">
            <li>
              <b className="text-amber-200">Yapay zeka klinik olarak doğrulanmadı.</b> BT beyin (kanama adayı) ve BT toraks (nodül adayı)
              için <b>kural tabanlı</b> (derin öğrenme olmayan) motor gerçek pikselden ölçüm yapar. Duyarlılık/özgüllük bilinmiyor;
              MR ve direkt grafide dedektör yok (örnek MR/CR vakaları açıkça DEMO etiketli).
            </li>
            <li>
              <b className="text-amber-200">Düzenleyici yol sizin sürecinizdir.</b> Tıbbi cihaz yazılımı sınıflandırması (MDR/TİTCK),
              ISO 13485/62304/14971 ve klinik performans çalışması koda dönüştürülemez; Yönetim → Uyum sekmesi yalnızca takip içindir.
            </li>
            <li>
              <b className="text-rose-300">Oturum açma kaldırıldı.</b> Adresi bilen herkes hasta verilerini görebilir ve rapor
              onaylayabilir. Onay kimlik doğrulamaz; SHA-256 mühür yalnızca içerik değişikliğini saptar. Gerçek hasta
              verisinde kullanılacaksa erişimi ağ düzeyinde kısıtlayın.
            </li>
            <li>
              <b className="text-amber-200">Gerçek hastane ortamında doğrulanmadı.</b> PACS (DICOMweb) sahte bir sunucuyla, codec&apos;ler
              pydicom test dosyalarıyla denendi; 1000+ kesitlik çalışmalarda performans, çok kullanıcılı yük ve gerçek PACS uyumu test edilmedi.
            </li>
          </ul>
        </section>

        {/* Skor kartları */}
        <section className="mt-6 grid gap-3 md:grid-cols-4">
          <div className="rounded-xl border border-[#1e2735] bg-[#0b1018] p-4 md:col-span-1">
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Genel kapsama</div>
            <div className="mt-1 text-4xl font-black text-slate-100">%{overall}</div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#13202b]">
              <div className={`h-full bg-gradient-to-r ${barColor(overall)}`} style={{ width: `${overall}%` }} />
            </div>
            <div className="mt-2 text-[11px] text-slate-400">
              Var = 1, Kısmi = 0,5, Yok = 0 puan. {GAP_ITEMS.length} özellik üzerinden.
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 md:col-span-2">
            {(["var", "kismi", "yok"] as const).map((s) => (
              <div key={s} className={`rounded-xl border p-4 ${STATUS_META[s].cls}`}>
                <div className="text-[10px] font-bold uppercase tracking-widest opacity-80">{STATUS_META[s].label}</div>
                <div className="mt-1 text-3xl font-black">{counts[s]}</div>
              </div>
            ))}
          </div>
          <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4">
            <div className="text-[10px] font-bold uppercase tracking-widest text-rose-300">Açık P0 madde</div>
            <div className="mt-1 text-3xl font-black text-rose-200">{counts.p0open}</div>
            <div className="mt-1 text-[11px] text-rose-200/80">Klinik kullanımdan önce kapanması gerekenler</div>
          </div>
        </section>

        {/* Kategori çubukları */}
        <section className="mt-6 rounded-xl border border-[#1e2735] bg-[#0b1018] p-4">
          <h2 className="text-sm font-black tracking-wide text-slate-100">Kategori bazlı kapsama</h2>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {CATEGORIES.map((c) => {
              const items = GAP_ITEMS.filter((i) => i.category === c.id);
              const pct = coverage(items);
              return (
                <button
                  key={c.id}
                  onClick={() => setCategory(category === c.id ? "all" : c.id)}
                  className={`rounded-lg border p-3 text-left transition-colors ${
                    category === c.id ? "border-cyan-400/60 bg-cyan-400/10" : "border-[#1e2735] bg-[#0e141d] hover:border-[#2c394d]"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-100">
                      {c.icon} {c.title}
                    </span>
                    <span className="font-mono text-xs font-bold text-slate-300">%{pct}</span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#13202b]">
                    <div className={`h-full bg-gradient-to-r ${barColor(pct)}`} style={{ width: `${pct}%` }} />
                  </div>
                  <div className="mt-1 text-[10.5px] text-slate-500">
                    {c.blurb} · {items.length} madde
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* Özellik tablosu */}
        <section className="mt-6">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="mr-2 text-sm font-black tracking-wide text-slate-100">
              Özellik karşılaştırması <span className="font-mono text-slate-500">({filtered.length})</span>
            </h2>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ara: MPR, PACS, e-imza…"
              className="w-56 rounded-md border border-[#1e2735] bg-[#0e141d] px-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 focus:border-cyan-400/50 focus:outline-none"
            />
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as GapStatus | "all")}
              className="rounded-md border border-[#1e2735] bg-[#0e141d] px-2 py-1.5 text-xs text-slate-200 focus:outline-none"
            >
              <option value="all">Tüm durumlar</option>
              <option value="yok">Yok</option>
              <option value="kismi">Kısmi</option>
              <option value="var">Var</option>
            </select>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as GapPriority | "all")}
              className="rounded-md border border-[#1e2735] bg-[#0e141d] px-2 py-1.5 text-xs text-slate-200 focus:outline-none"
            >
              <option value="all">Tüm öncelikler</option>
              <option value="P0">P0</option>
              <option value="P1">P1</option>
              <option value="P2">P2</option>
              <option value="P3">P3</option>
            </select>
            {(category !== "all" || status !== "all" || priority !== "all" || query) && (
              <button
                onClick={() => {
                  setCategory("all");
                  setStatus("all");
                  setPriority("all");
                  setQuery("");
                }}
                className="text-xs text-cyan-400 hover:underline"
              >
                Filtreleri temizle
              </button>
            )}
          </div>

          <div className="mt-3 flex flex-col gap-2">
            {filtered.length === 0 && (
              <p className="rounded-lg border border-[#1e2735] bg-[#0b1018] p-6 text-center text-xs text-slate-500">
                Bu filtrelerle eşleşen madde yok.
              </p>
            )}
            {filtered.map((i) => {
              const cat = CATEGORIES.find((c) => c.id === i.category);
              return (
                <article key={i.id} className="rounded-lg border border-[#1e2735] bg-[#0b1018] p-3.5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                        {cat?.icon} {cat?.title}
                      </div>
                      <h3 className="mt-0.5 text-[13px] font-bold text-slate-100">{i.title}</h3>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={`rounded border px-2 py-0.5 font-mono text-[10px] font-black ${STATUS_META[i.status].cls}`}>
                        {STATUS_META[i.status].label}
                      </span>
                      <span className={`rounded border px-2 py-0.5 font-mono text-[10px] font-bold ${PRIORITY_META[i.priority].cls}`}>
                        {PRIORITY_META[i.priority].label}
                      </span>
                      <span className="rounded border border-[#2d3b4e] px-2 py-0.5 font-mono text-[10px] text-slate-400">
                        {EFFORT_LABEL[i.effort]}
                      </span>
                    </div>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] font-semibold text-slate-500">Piyasada:</span>
                    {i.market.map((m) => (
                      <span
                        key={m}
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${TYPE_STYLE[NAME_TYPE[m] ?? "viewer"]}`}
                      >
                        {m}
                      </span>
                    ))}
                  </div>

                  <div className="mt-2.5 grid gap-2 text-[11.5px] leading-relaxed md:grid-cols-2">
                    <div className="rounded-md border border-[#1a2332] bg-[#080c12] p-2.5">
                      <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Bizde şu an</div>
                      <p className="mt-0.5 text-slate-300">{i.ours}</p>
                    </div>
                    <div className="rounded-md border border-cyan-500/20 bg-cyan-500/5 p-2.5">
                      <div className="text-[10px] font-bold uppercase tracking-widest text-cyan-400">Önerilen aksiyon</div>
                      <p className="mt-0.5 text-slate-300">{i.action}</p>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        {/* Yol haritası */}
        <section className="mt-8">
          <h2 className="text-sm font-black tracking-wide text-slate-100">Önerilen yol haritası</h2>
          <p className="mt-1 text-[11.5px] text-slate-500">
            Sıralama mantığı: önce güven ve gerçeklik, sonra okuma konforu, sonra gerçek yapay zeka, en son entegrasyon ve
            düzenleyici yol.
          </p>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            {ROADMAP.map((p) => (
              <div key={p.id} className="rounded-xl border border-[#1e2735] bg-[#0b1018] p-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-[13px] font-bold text-slate-100">{p.title}</h3>
                  <span className="rounded border border-cyan-400/40 px-2 py-0.5 font-mono text-[10px] text-cyan-300">
                    {p.timeframe}
                  </span>
                </div>
                <p className="mt-1 text-[11.5px] text-slate-400">{p.goal}</p>
                <ul className="mt-2 flex flex-col gap-1">
                  {p.itemIds.map((id) => {
                    const it = itemById.get(id);
                    if (!it) return null;
                    return (
                      <li key={id} className="flex items-center gap-2 text-[11.5px] text-slate-300">
                        <span className={`rounded border px-1.5 py-0.5 font-mono text-[9px] font-black ${STATUS_META[it.status].cls}`}>
                          {STATUS_META[it.status].label}
                        </span>
                        <span className="min-w-0 flex-1 truncate" title={it.title}>
                          {it.title}
                        </span>
                        <span className="font-mono text-[10px] text-slate-500">{it.priority}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </section>

        {/* Rakip profilleri */}
        <section className="mt-8">
          <h2 className="text-sm font-black tracking-wide text-slate-100">Rakip profilleri ve ne öğrenebiliriz</h2>
          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {COMPETITORS.map((c) => (
              <div key={c.name} className="rounded-xl border border-[#1e2735] bg-[#0b1018] p-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-[13px] font-bold text-slate-100">{c.name}</h3>
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${TYPE_STYLE[c.type]}`}>
                    {TYPE_LABEL[c.type]}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-slate-500">{c.focus}</p>
                <ul className="mt-2 list-disc space-y-0.5 pl-4 text-[11.5px] text-slate-300">
                  {c.strengths.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
                <p className="mt-2 rounded-md border border-cyan-500/20 bg-cyan-500/5 p-2 text-[11px] text-cyan-200">
                  <b>Bizim için ders:</b> {c.learn}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Kaynaklar */}
        <section className="mt-8 mb-10 rounded-xl border border-[#1e2735] bg-[#0b1018] p-4">
          <h2 className="text-sm font-black tracking-wide text-slate-100">Kaynaklar ve notlar</h2>
          <p className="mt-1 text-[11.5px] leading-relaxed text-slate-500">
            Piyasa bilgileri üretici sitelerinden ve üçüncü taraf derlemelerden alınmıştır; rakamlar ve kapsamlar
            üretici iddiasıdır, sürüme ve bölgeye göre değişebilir. Bu sayfa hukuki veya regülasyon danışmanlığı yerine
            geçmez.
          </p>
          <ul className="mt-2 grid gap-1 md:grid-cols-2">
            {SOURCES.map((s) => (
              <li key={s.url} className="truncate text-[11.5px]">
                <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline">
                  {s.title}
                </a>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
