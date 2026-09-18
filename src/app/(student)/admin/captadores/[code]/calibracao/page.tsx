import type { Metadata } from "next";
import { CalibrationScreen } from "@/components/admin/calibration-screen";

export const metadata: Metadata = { title: "Calibração de volume" };

export default async function CalibrationPage(props: PageProps<"/admin/captadores/[code]/calibracao">) {
  const { code } = await props.params;
  return <CalibrationScreen code={code} />;
}
