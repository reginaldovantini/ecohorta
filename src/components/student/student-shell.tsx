"use client";

import { MotionConfig } from "motion/react";
import { useState, type ReactNode } from "react";
import { CollectorSourceProvider } from "@/components/collector/collector-source";
import { MissionRunnerProvider, useMissionBoard } from "@/components/missions/mission-runner";
import { BottomNav } from "@/components/navigation/bottom-nav";
import { createPreviewSource } from "@/lib/iot/preview-source";

function Navigation() {
  const { availableCount } = useMissionBoard();
  return <BottomNav availableMissions={availableCount} />;
}

/** Casca do app do estudante: fonte de dados, execução de missões e navegação inferior. */
export function StudentShell({ children }: { children: ReactNode }) {
  const [source] = useState(createPreviewSource);

  return (
    <MotionConfig reducedMotion="user">
      <CollectorSourceProvider source={source}>
        <MissionRunnerProvider>
          <div className="mx-auto min-h-dvh max-w-md px-5 pb-32 pt-safe">{children}</div>
          <Navigation />
        </MissionRunnerProvider>
      </CollectorSourceProvider>
    </MotionConfig>
  );
}
