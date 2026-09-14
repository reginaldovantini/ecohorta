import type { Metadata } from "next";
import { WaterScreen } from "@/components/screens/water-screen";

export const metadata: Metadata = { title: "Captador" };

export default function WaterPage() {
  return <WaterScreen />;
}
