"use client";

import { AnimatePresence } from "motion/react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  useCollectorSnapshot,
  useCollectorSource,
  useDispenseProgress,
  usePrimaryCollectorCode,
} from "@/components/collector/collector-source";
import { getMissionAvailability } from "@/lib/missions/availability";
import { MISSION_CATALOG, type MissionDefinition } from "@/lib/missions/catalog";
import { isTerminal, xpForExecution } from "@/lib/missions/execution";
import { demoProfileStore } from "@/lib/student/demo-profile";
import { createId } from "@/lib/utils/id";
import { ExecutionOverlay } from "./execution-overlay";

interface ActiveExecution {
  executionId: string;
  commandId: string;
  mission: MissionDefinition;
  collectorCode: string;
  xpBefore: number;
}

interface MissionRunnerValue {
  isRunning: boolean;
  start: (mission: MissionDefinition, collectorCode: string) => void;
}

const MissionRunnerContext = createContext<MissionRunnerValue | null>(null);

/** Coordena o ciclo aceitar → comando → execução → confirmação → registro. */
export function MissionRunnerProvider({ children }: { children: ReactNode }) {
  const source = useCollectorSource();
  const [active, setActive] = useState<ActiveExecution | null>(null);
  const progress = useDispenseProgress(active?.commandId ?? null);
  const isRunning = active !== null && !isTerminal(progress);

  const start = useCallback(
    (mission: MissionDefinition, collectorCode: string) => {
      if (mission.liters === null) return;
      const execution: ActiveExecution = {
        executionId: createId(),
        commandId: createId(),
        mission,
        collectorCode,
        xpBefore: demoProfileStore.getSnapshot().xp,
      };
      setActive(execution);
      source.dispense({
        commandId: execution.commandId,
        executionId: execution.executionId,
        missionId: mission.id,
        collectorCode,
        targetLiters: mission.liters,
      });
    },
    [source],
  );

  // Registra o resultado medido uma única vez (o store ignora execuções repetidas).
  useEffect(() => {
    if (!active || !isTerminal(progress)) return;
    demoProfileStore.record({
      executionId: active.executionId,
      missionId: active.mission.id,
      commandId: active.commandId,
      collectorCode: active.collectorCode,
      status: progress.status,
      targetLiters: progress.targetLiters,
      deliveredLiters: progress.deliveredLiters,
      xpAwarded: xpForExecution(active.mission, progress),
      startedAt: progress.startedAt ?? progress.queuedAt,
      finishedAt: progress.finishedAt ?? progress.queuedAt,
      origin: progress.origin,
    });
  }, [active, progress]);

  const value = useMemo(() => ({ isRunning, start }), [isRunning, start]);

  return (
    <MissionRunnerContext value={value}>
      {children}
      <AnimatePresence>
        {active && (
          <ExecutionOverlay
            key={active.executionId}
            mission={active.mission}
            collectorCode={active.collectorCode}
            progress={progress}
            xpBefore={active.xpBefore}
            onCancel={() => source.cancel(active.commandId)}
            onClose={() => setActive(null)}
          />
        )}
      </AnimatePresence>
    </MissionRunnerContext>
  );
}

export function useMissionRunner() {
  const value = useContext(MissionRunnerContext);
  if (!value) throw new Error("useMissionRunner precisa estar dentro de <MissionRunnerProvider>.");
  return value;
}

/** Missões do captador principal com disponibilidade calculada a partir da leitura atual. */
export function useMissionBoard() {
  const collectorCode = usePrimaryCollectorCode();
  const snapshot = useCollectorSnapshot(collectorCode);
  const { isRunning } = useMissionRunner();

  return useMemo(() => {
    const items = MISSION_CATALOG.map((mission) => ({
      mission,
      availability: getMissionAvailability(mission, snapshot, isRunning),
    }));
    items.sort(
      (a, b) => Number(b.availability.status === "available") - Number(a.availability.status === "available"),
    );
    const availableCount = items.filter((item) => item.availability.status === "available").length;
    return { collectorCode, snapshot, items, availableCount };
  }, [collectorCode, snapshot, isRunning]);
}
