import type { Metadata } from "next";
import { ProfileScreen } from "@/components/screens/profile-screen";

export const metadata: Metadata = { title: "Perfil" };

export default function ProfilePage() {
  return <ProfileScreen />;
}
