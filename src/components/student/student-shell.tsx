"use client";

import { MotionConfig } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";
import { CollectorSourceProvider } from "@/components/collector/collector-source";
import { MissionRunnerProvider, useMissionBoard } from "@/components/missions/mission-runner";
import { BottomNav } from "@/components/navigation/bottom-nav";
import { SimulationPanelProvider } from "@/components/simulation/simulation-panel";
import { createSimulationSource } from "@/lib/iot/simulation-source";

function Navigation() {
  const { availableCount } = useMissionBoard();
  return <BottomNav availableMissions={availableCount} />;
}

/**
 * Casca do app do estudante: fonte de dados, execução de missões e navegação.
 * Hoje a fonte é o dispositivo virtual (SIMULAÇÃO); nos Dias 6–9 entra a fonte
 * Supabase alimentada pelo ESP32, com o mesmo contrato `CollectorDataSource`.
 */
export function StudentShell({ children }: { children: ReactNode }) {
  const [runtime] = useState(createSimulationSource);

  useEffect(() => runtime.start(), [runtime]);

  return (
    <MotionConfig reducedMotion="user">
      <CollectorSourceProvider source={runtime.source}>
        <SimulationPanelProvider controls={runtime.controls}>
          <MissionRunnerProvider>
            <div className="mx-auto min-h-dvh max-w-md px-5 pb-32 pt-safe">{children}</div>
            <Navigation />
          </MissionRunnerProvider>
        </SimulationPanelProvider>
      </CollectorSourceProvider>
    </MotionConfig>
  );
}
