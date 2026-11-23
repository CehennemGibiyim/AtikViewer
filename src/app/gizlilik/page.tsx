import Link from "next/link";

export const metadata = { title: "ATIKVIEWER — Aydınlatma metni (KVKK)" };

const items: [string, string][] = [
  ["Veri sorumlusu", "[KURUM ADI / ADRES / VERBİS NO] — bu alanı kurumunuza göre doldurun."],
  ["İşlenen veriler", "Kimlik (ad, hasta no), yaş/cinsiyet, tıbbi görüntüler ve DICOM üst verisi, radyoloji raporları, hekim/kullanıcı hesap bilgileri, işlem (denetim) kayıtları."],
  ["İşleme amaçları", "Radyolojik görüntülerin değerlendirilmesi, raporlanması, hekim onayı, kalite/güvenlik denetimi ve yasal saklama yükümlülükleri."],
  ["Hukuki sebep", "Sağlık hizmetlerinin yürütülmesi (KVKK m.6/3 — sağlık verileri, sır saklama yükümlülüğü altındaki kişilerce), hukuki yükümlülük. Açık rıza gereken ek işlemler için ayrıca rıza alınmalıdır."],
  ["Aktarım", "Veriler varsayılan olarak yurt dışına aktarılmaz. İsteğe bağlı LLM taslak izlenim özelliği açıkken, yalnızca hekimin doğruladığı bulgu metinleri (hasta adı/kimliği OLMADAN) yapılandırılan servise gönderilir."],
  ["Güvenlik önlemleri", "Hasta adı/kimliği, anahtar kesit, klinik bilgi ve saklanan DICOM dosyaları AES-256-GCM ile şifrelenir; rol tabanlı erişim; parola ile yeniden doğrulamalı onay; hash zincirli, değiştirilemez denetim kaydı; giriş denemesi sınırlama."],
  ["Saklama", "Onaylı raporlar mevzuattaki süre boyunca saklanır. Taslaklar için yönetici tanımlı süre (Yönetim → Güvenlik) sonunda silinebilir."],
  ["Haklarınız", "KVKK m.11 uyarınca bilgi talep etme, düzeltme, silme ve itiraz haklarınızı veri sorumlusuna başvurarak kullanabilirsiniz."],
];

export default function GizlilikPage() {
  return (
    <div className="h-screen w-screen overflow-y-auto bg-[#070a0f] text-slate-200">
      <main className="mx-auto max-w-3xl px-5 py-10">
        <Link href="/" className="text-xs text-cyan-400 hover:underline">← Geri</Link>
        <h1 className="mt-3 text-2xl font-black text-slate-100">Kişisel verilerin korunması — aydınlatma metni (şablon)</h1>
        <p className="mt-2 rounded-lg border border-amber-400/40 bg-amber-400/5 p-3 text-xs text-amber-200">Bu metin bir <b>şablondur</b> ve hukuki danışmanlık yerine geçmez. Yayımlamadan önce kurumunuzun veri sorumlusu bilgileri ve hukuk müşaviri onayıyla tamamlanmalıdır.</p>
        <div className="mt-6 space-y-4">
          {items.map(([k, v]) => (
            <section key={k} className="rounded-xl border border-[#1e2735] bg-[#0b0f16] p-4">
              <h2 className="text-sm font-bold text-cyan-300">{k}</h2>
              <p className="mt-1 text-[13px] leading-relaxed text-slate-300">{v}</p>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}
