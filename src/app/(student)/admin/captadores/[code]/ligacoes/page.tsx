import type { Metadata } from "next";
import { WiringScreen } from "@/components/admin/wiring-screen";

export const metadata: Metadata = { title: "Ligações" };

export default async function WiringPage(props: PageProps<"/admin/captadores/[code]/ligacoes">) {
  const { code } = await props.params;
  return <WiringScreen code={code} />;
}
