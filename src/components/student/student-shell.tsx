"use client";

import { AnimatePresence, motion, MotionConfig } from "motion/react";
import { WifiOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useDemoProfile } from "@/hooks/use-demo-profile";
import { useHydrated } from "@/hooks/use-hydrated";
import { CollectorSourceProvider, useConnectionState } from "@/components/collector/collector-source";
import { MissionRunnerProvider, useMissionBoard } from "@/components/missions/mission-runner";
import { BottomNav } from "@/components/navigation/bottom-nav";
import { SimulationPanelProvider } from "@/components/simulation/simulation-panel";
import { createApiSource } from "@/lib/iot/api-source";

function Navigation() {
  const { availableCount } = useMissionBoard();
  return <BottomNav availableMissions={availableCount} />;
}

/** Sem perfil neste aparelho: leva ao cadastro inicial. */
function OnboardingGuard() {
  const router = useRouter();
  const hydrated = useHydrated();
  const { identity } = useDemoProfile();
  useEffect(() => {
    if (hydrated && identity === null) router.replace("/boas-vindas");
  }, [hydrated, identity, router]);
  return null;
}

function ConnectionBanner() {
  const connection = useConnectionState();
  return (
    <AnimatePresence>
      {connection === "error" && (
        <motion.div
          role="status"
          initial={{ y: -40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -40, opacity: 0 }}
          className="fixed inset-x-0 top-0 z-50 pt-safe"
        >
          <div className="mx-auto mt-2 flex max-w-md items-center gap-2 rounded-2xl border border-ember-400/30 bg-abyss-850/95 px-4 py-2.5 text-sm text-mist-100 shadow-lg mx-3 sm:mx-auto">
            <WifiOff className="size-4 shrink-0 text-ember-400" aria-hidden />
            Sem conexão com a plataforma. Tentando novamente…
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * Casca do app: fonte de dados (somente a API da plataforma), execução de
 * missões e navegação. O captador por trás da API pode ser o ESP32 real ou o
 * dispositivo virtual — a interface identifica pela origem de cada leitura.
 */
export function StudentShell({ children }: { children: ReactNode }) {
  const [source] = useState(() => createApiSource());

  useEffect(() => source.start(), [source]);

  return (
    <MotionConfig reducedMotion="user">
      <CollectorSourceProvider source={source}>
        <SimulationPanelProvider>
          <MissionRunnerProvider>
            <OnboardingGuard />
            <ConnectionBanner />
            <div className="mx-auto min-h-dvh max-w-md px-5 pb-32 pt-safe">{children}</div>
            <Navigation />
          </MissionRunnerProvider>
        </SimulationPanelProvider>
      </CollectorSourceProvider>
    </MotionConfig>
  );
}
