#!/usr/bin/env bash
# GitHub Pages için statik demo hazırlığı (yalnızca CI'da, geçici çalışma kopyasında çalıştırılır).
# Sunucu/veritabanı gerektiren kısımları çıkarır; görüntüleyici tarayıcıda çalışır.
set -euo pipefail
rm -rf src/app/api src/app/yonetim src/proxy.ts
mkdir -p src/app/yonetim
cat > src/app/page.tsx <<'TSX'
import Workstation from "@/components/Workstation";
import StaticApiShim from "@/components/StaticApiShim";

// Statik demo: kimlik/veritabanı yok, sabit operatör profili.
const user = { id: 1, username: "demo", fullName: "Demo Radyolog", title: "Uzm. Dr.", regNo: "", role: "yonetici" as const };

export default function Home() {
  return (
    <>
      <StaticApiShim />
      <Workstation user={user} />
    </>
  );
}
TSX
cat > src/app/yonetim/page.tsx <<'TSX'
import Link from "next/link";

export default function Yonetim() {
  return (
    <main style={{ maxWidth: 560, margin: "15vh auto", padding: 24, color: "#cbd5e1", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ color: "#22d3ee", fontSize: 22 }}>Yönetim paneli</h1>
      <p style={{ marginTop: 12, lineHeight: 1.6 }}>
        Kullanıcılar, denetim kaydı, AI performansı ve ayarlar sunucu ve veritabanı gerektirir; bu statik demoda kapalıdır.
        Tam sürüm için Docker Compose veya Render ile dağıtın (README).
      </p>
      <Link href="/" style={{ display: "inline-block", marginTop: 16, color: "#22d3ee" }}>← Görüntüleyiciye dön</Link>
    </main>
  );
}
TSX
