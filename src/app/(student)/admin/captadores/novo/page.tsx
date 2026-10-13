import type { Metadata } from "next";
import { CollectorRegistrationScreen } from "@/components/admin/collector-registration-screen";

export const metadata: Metadata = { title: "Cadastrar captador" };

export default function NewCollectorPage() {
  return <CollectorRegistrationScreen />;
}
