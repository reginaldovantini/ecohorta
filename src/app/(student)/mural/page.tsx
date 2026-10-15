import type { Metadata } from "next";
import { WallScreen } from "@/components/screens/wall-screen";

export const metadata: Metadata = { title: "Mural" };

export default function WallPage() {
  return <WallScreen />;
}
