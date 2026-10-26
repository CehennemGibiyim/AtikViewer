import type { Metadata } from "next";
import GapAnalysis from "@/components/GapAnalysis";

export const metadata: Metadata = {
  title: "ATIKVIEWER — Piyasa Kıyaslaması ve Eksik Analizi",
  description: "Radyoloji görüntüleyici ve yapay zeka platformlarıyla özellik kıyaslaması, eksikler ve yol haritası.",
};

export default function KiyaslamaPage() {
  return <GapAnalysis />;
}
