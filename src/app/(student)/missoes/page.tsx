import type { Metadata } from "next";
import { MissionsScreen } from "@/components/screens/missions-screen";

export const metadata: Metadata = { title: "Missões" };

export default function MissionsPage() {
  return <MissionsScreen />;
}
