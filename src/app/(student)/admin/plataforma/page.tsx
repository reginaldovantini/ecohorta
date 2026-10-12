import type { Metadata } from "next";
import { PlatformScreen } from "@/components/admin/platform-screen";

export const metadata: Metadata = { title: "Plataforma" };

/** Mesa de controle da administração da plataforma: escolas e quem as administra. */
export default function PlatformPage() {
  return <PlatformScreen />;
}
