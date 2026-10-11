import { NextRequest, NextResponse } from "next/server";
import { asc, count, eq } from "drizzle-orm";
import { db } from "@/db";
import { reportTemplates } from "@/db/schema";
import { audit } from "@/lib/server/audit";
import { authorize } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

const SEED = [
  { name: "BT Beyin — Normal", modality: "CT", bodyPart: "BEYİN", technique: "Aksiyel planda kontrastsız beyin BT incelemesi değerlendirildi.", findings: "Beyin parankim dansiteleri doğal. Gri-beyaz cevher ayrımı korunmuş. Akut kanama, kitle etkisi veya orta hat şiftine ait bulgu izlenmedi. Ventriküler sistem ve sisternalar doğal genişlikte. Kemik yapılarda patolojik bulgu yok.", impression: "Akut patolojik bulgu saptanmamıştır.", recommendation: "Klinik korelasyon önerilir." },
  { name: "BT Beyin — Hiperdens odak (şablon)", modality: "CT", bodyPart: "BEYİN", technique: "Aksiyel planda kontrastsız beyin BT incelemesi değerlendirildi.", findings: "[KONUM] yerleşimli, yaklaşık [BOYUT] mm boyutunda, ortalama [HU] HU dansitesinde hiperdens odak izlenmektedir. Çevresinde [ödem durumu]. Orta hat şifti: [var/yok]. Ventriküler sistem: [durum].", impression: "[KONUM] hiperdens lezyon — akut kanama ile uyumlu/ayırıcı tanı: [..].", recommendation: "Acil klinik korelasyon ve kontrol görüntüleme önerilir." },
  { name: "BT Toraks — Normal", modality: "CT", bodyPart: "TORAKS", technique: "Aksiyel planda toraks BT incelemesi (akciğer ve mediasten pencereleri) değerlendirildi.", findings: "Her iki akciğer parankiminde aktif infiltrasyon, nodül veya kitle izlenmedi. Plevral effüzyon yok. Mediastende patolojik boyutta lenf nodu saptanmadı. Kalp ve büyük damarlar doğal.", impression: "Akut patolojik bulgu saptanmamıştır.", recommendation: "Klinik korelasyon önerilir." },
  { name: "BT Toraks — Pulmoner nodül (şablon)", modality: "CT", bodyPart: "TORAKS", technique: "Aksiyel planda toraks BT incelemesi değerlendirildi.", findings: "[Sağ/Sol] akciğer [lob/segment]'de, [BOYUT] mm çapında, [solid/subsolid/buzlu cam] [düzgün/spiküle] konturlu nodül izlenmektedir. Plevral retraksiyon: [var/yok]. Mediastinal lenfadenopati: [var/yok].", impression: "[Sağ/Sol] [lob] [BOYUT] mm nodül. Lung-RADS: [..].", recommendation: "Kılavuz doğrultusunda kontrol BT / ileri inceleme önerilir." },
  { name: "Akciğer Grafisi PA — Normal", modality: "CR", bodyPart: "TORAKS", technique: "PA pozisyonda ayakta akciğer grafisi değerlendirildi.", findings: "Her iki akciğer alanı havalanması doğal. Aktif infiltrasyon veya kitle saptanmadı. Kardiyotorasik oran normal sınırlarda. Kostofrenik sinüsler açık. Mediasten orta hatta.", impression: "Akut kardiyopulmoner patoloji saptanmamıştır.", recommendation: "Klinik korelasyon önerilir." },
  { name: "MR Beyin — Normal", modality: "MR", bodyPart: "BEYİN", technique: "Çok sekanslı kontrastsız beyin MR incelemesi değerlendirildi.", findings: "Beyin parankim sinyalleri doğal. Difüzyon kısıtlaması izlenmedi. Ventriküler sistem ve subaraknoid mesafeler doğal. Orta hat yapıları simetrik. Kitle veya kanama ile uyumlu sinyal değişikliği yok.", impression: "Akut patolojik bulgu saptanmamıştır.", recommendation: "Klinik korelasyon önerilir." },
];

export async function GET() {
  const a = await authorize();
  if ("error" in a) return a.error;
  const n = (await db.select({ n: count() }).from(reportTemplates))[0].n;
  if (n === 0) await db.insert(reportTemplates).values(SEED);
  const rows = await db.select().from(reportTemplates).orderBy(asc(reportTemplates.id));
  return NextResponse.json(rows.map(({ createdBy: _c, createdAt: _t, ...r }) => r));
}

export async function POST(req: NextRequest) {
  const a = await authorize(["radyolog", "yonetici"]);
  if ("error" in a) return a.error;
  const b = (await req.json().catch(() => ({}))) as Record<string, string>;
  if (!b.name?.trim()) return NextResponse.json({ error: "Şablon adı gerekli" }, { status: 400 });
  const ins = await db.insert(reportTemplates).values({
    name: b.name.trim().slice(0, 120), modality: b.modality ?? "", bodyPart: b.bodyPart ?? "", technique: b.technique ?? "",
    findings: b.findings ?? "", impression: b.impression ?? "", recommendation: b.recommendation ?? "", createdBy: a.user.id,
  }).returning({ id: reportTemplates.id });
  await audit(a.user, "template.create", "template", ins[0].id, { name: b.name });
  return NextResponse.json({ ok: true, id: ins[0].id });
}

export async function DELETE(req: NextRequest) {
  const a = await authorize(["radyolog", "yonetici"]);
  if ("error" in a) return a.error;
  const id = Number(req.nextUrl.searchParams.get("id"));
  const t = (await db.select().from(reportTemplates).where(eq(reportTemplates.id, id)).limit(1))[0];
  if (!t) return NextResponse.json({ error: "Bulunamadı" }, { status: 404 });
  if (a.user.role !== "yonetici" && t.createdBy !== a.user.id) return NextResponse.json({ error: "Yalnızca kendi şablonunuzu silebilirsiniz" }, { status: 403 });
  await db.delete(reportTemplates).where(eq(reportTemplates.id, id));
  await audit(a.user, "template.delete", "template", id, { name: t.name });
  return NextResponse.json({ ok: true });
}
