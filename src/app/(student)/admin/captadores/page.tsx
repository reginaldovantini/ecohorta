import type { Metadata } from "next";
import { CollectorsAdminScreen } from "@/components/admin/collectors-admin-screen";

export const metadata: Metadata = { title: "Captadores" };

export default function CollectorsAdminPage() {
  return <CollectorsAdminScreen />;
}
