import type { Metadata } from "next";
import { PartnershipScreen } from "@/components/partnership/partnership-screen";

export const metadata: Metadata = {
  title: "Seja parceiro",
  description:
    "Construa um captador de água do ar-condicionado na sua escola e transforme o desperdício em missões de sustentabilidade com metodologia STEM.",
};

/** Pública: fala com professores que ainda não têm conta na plataforma. */
export default function PartnershipPage() {
  return <PartnershipScreen />;
}
