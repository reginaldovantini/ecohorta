import type { Metadata } from "next";
import { CollectorSetupScreen } from "@/components/admin/collector-setup-screen";

export const metadata: Metadata = { title: "Construção do captador" };

/** Administração → Captadores → Construção: do tubo montado ao captador calibrado. */
export default async function CollectorSetupPage({ params }: PageProps<"/admin/captadores/[code]/construcao">) {
  const { code } = await params;
  return <CollectorSetupScreen code={decodeURIComponent(code)} />;
}
