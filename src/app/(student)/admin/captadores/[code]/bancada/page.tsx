import type { Metadata } from "next";
import { BenchScreen } from "@/components/admin/bench-screen";

export const metadata: Metadata = { title: "Bancada" };

export default async function BenchPage(props: PageProps<"/admin/captadores/[code]/bancada">) {
  const { code } = await props.params;
  return <BenchScreen code={code} />;
}
