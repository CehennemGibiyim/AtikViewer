import type { Metadata } from "next";
import type { ReactNode } from "react";
import ClientRecovery from "@/components/ClientRecovery";
import "./globals.css";

export const metadata: Metadata = {
  title: "ATIKVIEWER — Vision AI Radyoloji İstasyonu",
  description:
    "DICOM görüntüleme, kesit kesit AI analizi ve yapısal radyoloji raporu üretimi. Araştırma amaçlıdır.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="tr">
      <body className="bg-[#070a0f] text-slate-200 antialiased"><ClientRecovery />{children}</body>
    </html>
  );
}
