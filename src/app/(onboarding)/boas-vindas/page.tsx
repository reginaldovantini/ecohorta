import type { Metadata } from "next";
import { OnboardingFlow } from "@/components/onboarding/onboarding-flow";

export const metadata: Metadata = { title: "Boas-vindas" };

export default function WelcomePage() {
  return <OnboardingFlow />;
}
