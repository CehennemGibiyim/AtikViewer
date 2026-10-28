"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { UserInfo } from "@/lib/types";

type Tab = "profile" | "audit" | "ai" | "security" | "integration" | "compliance";
interface AuditRow { id: number; ts: string; username: string; action: string; entityType: string; entityId: string; details: string; hash: string }
interface PerfRow { engine: string; category: string; shown: number; approved: number; rejected: number; edited: number; pending: number; manualAdded: number; ppv: number | null }
interface Status { keySource: string; plaintext: { studies: number; reports: number }; totals: Record<string, number>; retentionDraftDays: number }
interface Settings { retentionDraftDays: number; criticalWebhookUrl: string; pacsBaseUrl: string; compliance: string; env: { llm: boolean; his: boolean; pacsAuth: boolean; keySource: string } }

const COMPLIANCE = [
  { id: "intended", t: "Amaçlanan kullanım (intended use) belgesi", h: "Hangi modalite/endikasyon, hangi kullanıcı, karar desteği düzeyi." },
  { id: "class", t: "Tıbbi cihaz yazılımı sınıflandırması (AB MDR / TİTCK)", h: "Tanıyı etkileyen bilgi sağlayan yazılım genellikle düzenlemeye tabidir." },
  { id: "qms", t: "Kalite yönetim sistemi (ISO 13485)", h: "" },
  { id: "lifecycle", t: "Yazılım yaşam döngüsü (IEC 62304) ve sürüm yönetimi", h: "" },
  { id: "risk", t: "Risk yönetimi dosyası (ISO 14971)", h: "Otomasyon yanlılığı, yanlış negatif, veri bozulması." },
  { id: "clinical", t: "Klinik değerlendirme / performans çalışması", h: "Gölge mod + kendi verinizde duyarlılık/özgüllük (AI Performans sekmesi veri toplar)." },
  { id: "usability", t: "Kullanılabilirlik mühendisliği (IEC 62366)", h: "" },
  { id: "cyber", t: "Siber güvenlik: sızma testi, yedekleme, felaket kurtarma", h: "" },
  { id: "kvkk", t: "KVKK: VERBİS kaydı, aydınlatma metni, etki analizi", h: "/gizlilik şablonunu kurumunuza göre doldurun." },
  { id: "nes", t: "Nitelikli elektronik imza (NES) sağlayıcı entegrasyonu", h: "Mevcut onay parola ile yeniden doğrulamadır; NES değildir." },
  { id: "pacs", t: "PACS/HBYS bağlantı testleri (kurum ortamında)", h: "" },
  { id: "pms", t: "Satış sonrası gözetim ve olay bildirimi", h: "" },
];

async function api<T>(url: string, init?: RequestInit): Promise<{ ok: boolean; data: T }> {
  const r = await fetch(url, init);
  return { ok: r.ok, data: (await r.json().catch(() => ({}))) as T };
}
const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const card = "rounded-xl border border-[#1e2735] bg-[#0b1018] p-4";
const input = "rounded-lg border border-[#1e2735] bg-[#0e141d] px-2.5 py-1.5 text-xs text-slate-100 focus:border-cyan-400/50 focus:outline-none";
const btn = "cursor-pointer rounded-lg px-3 py-1.5 text-xs font-bold";

export default function AdminPanel({ user }: { user: UserInfo }) {
  const [tab, setTab] = useState<Tab>("profile");
  const [msg, setMsg] = useState("");
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 4000); };

  // hekim profili (rapor imzasında görünecek ad)
  const [prof, setProf] = useState({ fullName: user.fullName, title: user.title, regNo: user.regNo });
  const loadProfile = useCallback(async () => {
    const r = await api<{ user: UserInfo }>("/api/profile");
    if (r.ok && r.data.user) setProf({ fullName: r.data.user.fullName, title: r.data.user.title, regNo: r.data.user.regNo });
  }, []);
  // denetim
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [aq, setAq] = useState("");
  const [chain, setChain] = useState<{ ok: boolean; count: number; brokenAtId?: number; reason?: string } | null>(null);
  const loadAudit = useCallback(async () => { const r = await api<AuditRow[]>(`/api/audit?limit=300&q=${encodeURIComponent(aq)}`); if (r.ok) setAudit(r.data); }, [aq]);
  // AI
  const [perf, setPerf] = useState<{ rows: PerfRow[]; note: string } | null>(null);
  // güvenlik / ayarlar
  const [status, setStatus] = useState<Status | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [comp, setComp] = useState<Record<string, string>>({});
  const loadSettings = useCallback(async () => {
    const [s, st] = await Promise.all([api<Settings>("/api/settings"), api<Status>("/api/admin/status")]);
    if (s.ok) { setSettings(s.data); try { setComp(JSON.parse(s.data.compliance || "{}")); } catch { setComp({}); } }
    if (st.ok) setStatus(st.data);
  }, []);

  useEffect(() => {
    void (async () => {
      if (tab === "profile") await loadProfile();
      if (tab === "audit") await loadAudit();
      if (tab === "ai") { const r = await api<{ rows: PerfRow[]; note: string }>("/api/ai/performance"); if (r.ok) setPerf(r.data); }
      if (["security", "integration", "compliance"].includes(tab)) await loadSettings();
    })();
  }, [tab, loadProfile, loadAudit, loadSettings]);

  const saveSettings = async (patch: Record<string, unknown>) => {
    const r = await api<{ error?: string }>("/api/settings", json("PUT", patch));
    flash(r.ok ? "Kaydedildi" : r.data.error ?? "Hata");
    void loadSettings();
  };
  const saveProfile = async () => {
    const r = await api<{ error?: string }>("/api/profile", json("PATCH", prof));
    flash(r.ok ? "Profil kaydedildi" : r.data.error ?? "Hata");
    void loadProfile();
  };

  // Denetim kaydını (ekrandaki filtreli/sınırlı liste) CSV olarak indir
  const exportAuditCsv = () => {
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const head = ["#", "Zaman", "Kullanıcı", "İşlem", "Kayıt", "Ayrıntı", "Hash"];
    const rows = audit.map((a) => [
      String(a.id),
      new Date(a.ts).toLocaleString("tr-TR"),
      a.username,
      a.action,
      `${a.entityType}${a.entityId ? `#${a.entityId}` : ""}`,
      a.details,
      a.hash,
    ].map(esc).join(","));
    const csv = "\ufeff" + [head.map(esc).join(","), ...rows].join("\r\n");
    const el = document.createElement("a");
    el.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    el.download = `denetim-kaydi-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(el);
    el.click();
    el.remove();
    setTimeout(() => URL.revokeObjectURL(el.href), 3000);
    flash(`CSV indirildi (${audit.length} kayıt${aq ? ", filtreli" : ""}). Tüm geçmiş için arama kutusunu boş bırakıp yenileyin.`);
  };

  const tabs: [Tab, string][] = [["profile", "Hekim profili"], ["audit", "Denetim kaydı"], ["ai", "AI performans"], ["security", "Güvenlik & saklama"], ["integration", "Entegrasyon"], ["compliance", "Uyum"]];

  return (
    <div className="h-screen w-screen overflow-y-auto bg-[#070a0f] text-slate-200">
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-[#1a2230] bg-[#0b0f16]/95 px-5 py-3 backdrop-blur print:hidden">
        <Link href="/" className="rounded-md border border-cyan-400/40 bg-cyan-500/10 px-3 py-1.5 text-xs font-bold text-cyan-300 hover:bg-cyan-500/20">← Görüntüleyici</Link>
        <h1 className="font-mono text-sm font-black tracking-[0.15em] text-slate-100">ATIK<span className="text-cyan-400">VIEWER</span> · YÖNETİM</h1>
        <span className="ml-auto text-xs text-slate-400">{user.fullName}</span>
      </header>
      <main className="mx-auto max-w-6xl px-5 py-6">
        <div className="flex flex-wrap gap-1.5 print:hidden">
          {tabs.map(([id, l]) => <button key={id} onClick={() => setTab(id)} className={`${btn} ${tab === id ? "bg-cyan-400/15 text-cyan-300 ring-1 ring-cyan-400/40" : "text-slate-400 hover:text-slate-200"}`}>{l}</button>)}
        </div>
        {msg && <div className="mt-3 rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-3 py-2 text-xs font-semibold text-cyan-200">{msg}</div>}

        {tab === "profile" && (
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className={card}>
              <h2 className="text-sm font-bold text-slate-100">Rapor imzası — hekim bilgileri</h2>
              <p className="mt-2 text-xs leading-relaxed text-slate-400">
                Bu bilgiler onaylanan raporların imza satırına yazılır. Uygulamada <b>oturum açma kapalıdır</b>;
                bu alanlar kimlik doğrulamaz, yalnızca rapora basılacak adı belirler.
              </p>
              <div className="mt-3 grid gap-2">
                <label className="text-[11px] font-semibold text-slate-400">Ad soyad
                  <input value={prof.fullName} onChange={(e) => setProf({ ...prof, fullName: e.target.value })} className={`${input} mt-1 w-full`} placeholder="Ayşe Kaya" />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-[11px] font-semibold text-slate-400">Unvan
                    <input value={prof.title} onChange={(e) => setProf({ ...prof, title: e.target.value })} className={`${input} mt-1 w-full`} placeholder="Uzm. Dr." />
                  </label>
                  <label className="text-[11px] font-semibold text-slate-400">Sicil / diploma no
                    <input value={prof.regNo} onChange={(e) => setProf({ ...prof, regNo: e.target.value })} className={`${input} mt-1 w-full`} placeholder="148291" />
                  </label>
                </div>
              </div>
              <button className={`${btn} mt-3 bg-cyan-500 text-slate-950`} onClick={() => void saveProfile()}>Kaydet</button>
              <div className="mt-3 rounded-lg border border-[#232e40] bg-[#0e141d] p-2.5 text-xs">
                <div className="text-[10px] uppercase tracking-widest text-slate-500">Rapordaki görünüm</div>
                <div className="mt-1 font-semibold text-slate-100">{prof.title} {prof.fullName || "(ad girilmedi)"}</div>
                <div className="text-slate-400">Sicil/diploma: {prof.regNo || "—"}</div>
              </div>
            </div>
            <div className={card}>
              <h2 className="text-sm font-bold text-rose-300">⚠ Oturum açma kapalı</h2>
              <ul className="mt-2 list-disc space-y-1.5 pl-4 text-xs leading-relaxed text-slate-300">
                <li>Uygulamanın adresine erişebilen <b>herkes</b> hasta verilerini görebilir, görüntü yükleyebilir ve rapor onaylayabilir.</li>
                <li>Raporlardaki onay <b>kimlik doğrulamaz</b>; yalnızca yukarıdaki adı yazar ve içeriği SHA-256 ile mühürler.</li>
                <li>Denetim kaydı tutulmaya devam eder, ancak tüm işlemler tek bir operatöre atfedilir — kişi bazlı sorumluluk izi yoktur.</li>
                <li>Gerçek hasta verisiyle kullanılacaksa erişimi ağ düzeyinde kısıtlayın (VPN, güvenlik duvarı veya ters vekilde kimlik doğrulama).</li>
              </ul>
              <p className="mt-3 text-[11px] text-slate-500">Kullanıcı hesapları, roller ve parola ile giriş bu sürümde kaldırılmıştır.</p>
            </div>
          </div>
        )}

        {tab === "audit" && (
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2 print:hidden">
              <input value={aq} onChange={(e) => setAq(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void loadAudit()} placeholder="Ara: kullanıcı, işlem, kayıt…" className={`${input} w-72`} />
              <button className={`${btn} bg-cyan-500 text-slate-950`} onClick={() => void loadAudit()}>Ara</button>
              <button className={`${btn} border border-emerald-400/40 text-emerald-300 hover:bg-emerald-400/10`} onClick={async () => { const r = await api<{ ok: boolean; count: number; brokenAtId?: number; reason?: string }>("/api/audit?verify=1"); setChain(r.data); }}>🔗 Hash zincirini doğrula</button>
              <button className={`${btn} border border-slate-400/40 text-slate-200 hover:bg-slate-400/10`} title="Ekrandaki filtreli listeyi CSV olarak indir" onClick={exportAuditCsv}>⬇ CSV</button>
              <button className={`${btn} border border-slate-400/40 text-slate-200 hover:bg-slate-400/10`} title="Yazdırma penceresinden 'PDF olarak kaydet' seçin" onClick={() => { document.body.classList.add("print-audit"); window.addEventListener("afterprint", () => document.body.classList.remove("print-audit"), { once: true }); window.print(); }}>🖨 PDF</button>
            </div>
            {chain && <div className={`rounded-lg border px-3 py-2 text-xs font-semibold ${chain.ok ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-rose-500/50 bg-rose-500/10 text-rose-300"}`}>{chain.ok ? `✓ Zincir bütün: ${chain.count} kayıt, değişiklik/silme yok.` : `✗ Zincir bozuk (kayıt #${chain.brokenAtId}): ${chain.reason}`}</div>}
            <div className={`${card} audit-print max-h-[60vh] overflow-auto p-0`}>
              <table className="w-full text-[11px]">
                <thead className="sticky top-0 bg-[#0b1018] text-left text-slate-500"><tr>{["#", "Zaman", "Kullanıcı", "İşlem", "Kayıt", "Ayrıntı", "Hash"].map((h) => <th key={h} className="border-b border-[#1a2230] px-3 py-2 font-semibold">{h}</th>)}</tr></thead>
                <tbody>
                  {audit.map((a) => (
                    <tr key={a.id} className="hover:bg-[#101722]">
                      <td className="border-b border-[#141b26] px-3 py-1.5 font-mono text-slate-500">{a.id}</td>
                      <td className="whitespace-nowrap border-b border-[#141b26] px-3 py-1.5 text-slate-400">{new Date(a.ts).toLocaleString("tr-TR")}</td>
                      <td className="border-b border-[#141b26] px-3 py-1.5 text-slate-200">{a.username}</td>
                      <td className={`border-b border-[#141b26] px-3 py-1.5 font-mono font-bold ${/denied|failed|delete|purge/.test(a.action) ? "text-rose-300" : /approve/.test(a.action) ? "text-emerald-300" : "text-cyan-300"}`}>{a.action}</td>
                      <td className="border-b border-[#141b26] px-3 py-1.5 text-slate-400">{a.entityType}{a.entityId ? `#${a.entityId}` : ""}</td>
                      <td className="max-w-[260px] truncate border-b border-[#141b26] px-3 py-1.5 font-mono text-[10px] text-slate-500" title={a.details}>{a.details}</td>
                      <td className="border-b border-[#141b26] px-3 py-1.5 font-mono text-[10px] text-slate-600">{a.hash}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === "ai" && (
          <div className="mt-4 space-y-3">
            <div className="rounded-lg border border-amber-400/30 bg-amber-400/5 p-3 text-xs text-amber-200">{perf?.note ?? "Yükleniyor…"}</div>
            <div className={`${card} overflow-x-auto p-0`}>
              <table className="w-full text-[11.5px]">
                <thead className="text-left text-slate-500"><tr>{["Motor", "Kategori", "Gösterilen", "Onaylanan", "Reddedilen", "Düzenlenen", "Bekleyen", "Kesinlik (PPV)", "AI'nın kaçırdığı (hekim ekledi)"].map((h) => <th key={h} className="border-b border-[#1a2230] px-3 py-2 font-semibold">{h}</th>)}</tr></thead>
                <tbody>
                  {(perf?.rows ?? []).length === 0 && <tr><td colSpan={9} className="px-3 py-6 text-center text-slate-500">Henüz hekim geri bildirimi yok. Raporlarda bulguları Onayla/Reddet olarak işaretledikçe dolar.</td></tr>}
                  {(perf?.rows ?? []).map((r) => (
                    <tr key={`${r.engine}${r.category}`} className="hover:bg-[#101722]">
                      <td className="border-b border-[#141b26] px-3 py-2 font-mono text-cyan-300">{r.engine}</td><td className="border-b border-[#141b26] px-3 py-2">{r.category}</td>
                      <td className="border-b border-[#141b26] px-3 py-2">{r.shown}</td><td className="border-b border-[#141b26] px-3 py-2 text-emerald-300">{r.approved}</td><td className="border-b border-[#141b26] px-3 py-2 text-rose-300">{r.rejected}</td><td className="border-b border-[#141b26] px-3 py-2 text-amber-300">{r.edited}</td><td className="border-b border-[#141b26] px-3 py-2">{r.pending}</td>
                      <td className="border-b border-[#141b26] px-3 py-2 font-bold">{r.ppv === null ? "—" : `%${Math.round(r.ppv * 100)}`}</td><td className="border-b border-[#141b26] px-3 py-2">{r.manualAdded}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === "security" && status && settings && (
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className={card}>
              <h2 className="text-sm font-bold text-slate-100">Şifreleme (hareketsiz veri)</h2>
              <p className="mt-2 text-xs leading-relaxed text-slate-300">Hasta adı/kimliği, klinik bilgi, anahtar kesit görüntüleri ve sunucuda saklanan DICOM dosyaları <b>AES-256-GCM</b> ile şifrelenir. Anahtar kaynağı: <b className={status.keySource === "env" ? "text-emerald-300" : "text-amber-300"}>{status.keySource === "env" ? "ortam değişkeni (DATA_ENCRYPTION_KEY)" : "sunucu dosyası (.data/enc.key)"}</b>.</p>
              {status.keySource !== "env" && <p className="mt-2 rounded border border-amber-400/30 bg-amber-400/5 p-2 text-[11px] text-amber-200">Üretimde anahtarı veritabanı/diskten ayrı bir KMS veya gizli yönetim servisinde tutup <code>DATA_ENCRYPTION_KEY</code> (base64, 32 bayt) olarak verin. Anahtar kaybolursa veri geri alınamaz.</p>}
              <div className="mt-3 text-xs text-slate-300">Düz metin kalan kayıt: <b className={status.plaintext.studies + status.plaintext.reports ? "text-rose-300" : "text-emerald-300"}>{status.plaintext.studies} çalışma · {status.plaintext.reports} rapor</b></div>
              <button disabled={status.plaintext.studies + status.plaintext.reports === 0} className={`${btn} mt-3 bg-cyan-500 text-slate-950 disabled:opacity-40`} onClick={async () => { const r = await api<{ studies: number; reports: number; error?: string }>("/api/admin/encrypt-legacy", { method: "POST" }); flash(r.ok ? `Şifrelendi: ${r.data.studies} çalışma, ${r.data.reports} rapor` : r.data.error ?? "Hata"); void loadSettings(); }}>Mevcut kayıtları şifrele</button>
            </div>
            <div className={card}>
              <h2 className="text-sm font-bold text-slate-100">Saklama politikası</h2>
              <p className="mt-2 text-xs text-slate-300">Onaylanmamış taslak raporlar bu süreden sonra silinir (0 = otomatik silme kapalı). Onaylı raporlar silinmez.</p>
              <div className="mt-3 flex items-center gap-2">
                <input type="number" min={0} defaultValue={settings.retentionDraftDays} id="ret" className={`${input} w-24`} />
                <span className="text-xs text-slate-400">gün</span>
                <button className={`${btn} bg-cyan-500 text-slate-950`} onClick={() => void saveSettings({ retentionDraftDays: Number((document.getElementById("ret") as HTMLInputElement).value) })}>Kaydet</button>
                <button className={`${btn} border border-rose-400/40 text-rose-300 hover:bg-rose-400/10`} onClick={async () => { if (!window.confirm("Süresi dolan taslaklar kalıcı olarak silinecek. Devam?")) return; const r = await api<{ deleted: number; error?: string }>("/api/admin/purge-drafts", { method: "POST" }); flash(r.ok ? `${r.data.deleted} taslak silindi` : r.data.error ?? "Hata"); }}>Süresi dolanları sil</button>
              </div>
              <h2 className="mt-5 text-sm font-bold text-slate-100">Kayıt sayıları</h2>
              <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">{Object.entries(status.totals).map(([k, v]) => <div key={k} className="rounded border border-[#1e2735] bg-[#0e141d] p-2"><div className="text-lg font-black text-cyan-300">{v}</div><div className="text-slate-500">{k}</div></div>)}</div>
              <Link href="/gizlilik" className="mt-4 inline-block text-xs text-cyan-400 hover:underline">KVKK aydınlatma metni şablonu →</Link>
            </div>
          </div>
        )}

        {tab === "integration" && settings && (
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className={card}>
              <h2 className="text-sm font-bold text-slate-100">PACS — DICOMweb (QIDO-RS / WADO-RS)</h2>
              <input id="pacs" defaultValue={settings.pacsBaseUrl} placeholder="https://pacs.kurum.local/dicom-web" className={`${input} mt-3 w-full`} />
              <p className="mt-2 text-[11px] text-slate-500">Kimlik başlığı: <code>PACS_AUTH_HEADER</code> ortam değişkeni — {settings.env.pacsAuth ? <b className="text-emerald-300">tanımlı</b> : <b className="text-amber-300">tanımlı değil</b>}. Orthanc/dcm4chee uyumludur. C-FIND/C-MOVE (DIMSE) bu sürümde yoktur.</p>
              <button className={`${btn} mt-3 bg-cyan-500 text-slate-950`} onClick={() => void saveSettings({ pacsBaseUrl: (document.getElementById("pacs") as HTMLInputElement).value })}>Kaydet</button>
            </div>
            <div className={card}>
              <h2 className="text-sm font-bold text-slate-100">Kritik bulgu bildirimi (webhook)</h2>
              <input id="hook" defaultValue={settings.criticalWebhookUrl} placeholder="https://… (POST JSON)" className={`${input} mt-3 w-full`} />
              <p className="mt-2 text-[11px] text-slate-500">Kritik/yüksek aday bulguda uygulama içi bildirim + bu adrese POST. E-posta/SMS/çağrı cihazı sağlayıcıları, webhook&apos;u dinleyen bir köprü ile bağlanır. Alındı bilgisi denetim kaydına yazılır.</p>
              <button className={`${btn} mt-3 bg-cyan-500 text-slate-950`} onClick={() => void saveSettings({ criticalWebhookUrl: (document.getElementById("hook") as HTMLInputElement).value })}>Kaydet</button>
            </div>
            <div className={card}>
              <h2 className="text-sm font-bold text-slate-100">HBYS / RIS istem alımı</h2>
              <p className="mt-2 text-xs text-slate-300">Durum: {settings.env.his ? <b className="text-emerald-300">etkin (HIS_API_KEY tanımlı)</b> : <b className="text-amber-300">kapalı — HIS_API_KEY tanımlayın</b>}</p>
              <pre className="mt-2 overflow-x-auto rounded bg-[#080c12] p-2 text-[10.5px] text-slate-300">{`POST /api/his/orders\nx-api-key: <HIS_API_KEY>\n{"patientName":"…","patientId":"…","accessionNumber":"A123",\n "modality":"CT","bodyPart":"BEYİN","description":"Beyin BT"}`}</pre>
              <p className="mt-2 text-[11px] text-slate-500">HL7 v2 (MLLP) alıcısı yoktur; Mirth gibi bir arabirim motoruyla bu uca köprülenir. Rapor çıktısı: <code>/api/reports/&#123;id&#125;/fhir</code> (FHIR R4 DiagnosticReport).</p>
            </div>
            <div className={card}>
              <h2 className="text-sm font-bold text-slate-100">Üretken yapay zeka (taslak izlenim)</h2>
              <p className="mt-2 text-xs text-slate-300">Durum: {settings.env.llm ? <b className="text-emerald-300">etkin (LLM_API_URL + LLM_API_KEY)</b> : <b className="text-amber-300">yapılandırılmadı — kural tabanlı yedek kullanılır</b>}</p>
              <p className="mt-2 text-[11px] text-slate-500">OpenAI uyumlu uç nokta. Yalnızca hekimin doğruladığı bulgu metinleri gönderilir; hasta adı/kimliği gönderilmez. Çıktı her zaman &quot;taslak&quot; etiketlidir. KVKK açısından yurt dışı aktarımı değerlendirin.</p>
            </div>
          </div>
        )}

        {tab === "compliance" && settings && (
          <div className="mt-4 space-y-2">
            <div className="rounded-lg border border-amber-400/30 bg-amber-400/5 p-3 text-xs leading-relaxed text-amber-200">Aşağıdakiler <b>kodla tamamlanamayan</b>, kurum/üretici tarafından yürütülmesi gereken süreçlerdir. Bu liste yalnızca takip içindir; hukuki/regülasyon danışmanlığı değildir. Bulgu gösteren yapay zeka yazılımı çoğu yargı alanında tıbbi cihaz yazılımı sayılır.</div>
            {COMPLIANCE.map((c) => (
              <div key={c.id} className={`${card} flex items-center gap-3 py-3`}>
                <div className="min-w-0 flex-1"><div className="text-[12.5px] font-bold text-slate-100">{c.t}</div>{c.h && <div className="text-[11px] text-slate-500">{c.h}</div>}</div>
                <select value={comp[c.id] ?? "yapilmadi"} onChange={(e) => { const n = { ...comp, [c.id]: e.target.value }; setComp(n); void saveSettings({ compliance: JSON.stringify(n) }); }} className={input}>
                  <option value="yapilmadi">Yapılmadı</option><option value="devam">Devam ediyor</option><option value="tamam">Tamamlandı</option>
                </select>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
