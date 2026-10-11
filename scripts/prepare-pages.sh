#!/usr/bin/env bash
# GitHub Pages için statik demo hazırlığı (yalnızca CI'da, geçici çalışma kopyasında çalıştırılır).
# Sunucu/veritabanı gerektiren kısımları çıkarır; görüntüleyici tarayıcıda çalışır.
set -euo pipefail
rm -rf src/app/api src/app/yonetim src/proxy.ts
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
