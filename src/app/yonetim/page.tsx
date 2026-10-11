import AdminPanel from "@/components/AdminPanel";
import { getCurrentUser } from "@/lib/server/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "ATIKVIEWER — Yönetim" };

export default async function YonetimPage() {
  return <AdminPanel user={await getCurrentUser()} />;
}
