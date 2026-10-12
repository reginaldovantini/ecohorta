import type { Metadata } from "next";
import { InstallScreen } from "@/components/install/install-screen";

export const metadata: Metadata = {
  title: "Instalar no celular",
  description: "Instale a EcoHorta no seu celular e abra as missões direto da tela inicial.",
};

/** Pública e fora do login: o QR colado no captador aponta para cá. */
export default function InstallPage() {
  return <InstallScreen />;
}
