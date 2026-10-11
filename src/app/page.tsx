import Workstation from "@/components/Workstation";
import { getCurrentUser } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  // Giriş ekranı yok: uygulama doğrudan açılır.
  return <Workstation user={await getCurrentUser()} />;
}
