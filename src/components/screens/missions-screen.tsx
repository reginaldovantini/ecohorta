"use client";

import { motion } from "motion/react";
import { MissionCard } from "@/components/missions/mission-card";
import { useMissionBoard, useMissionRunner } from "@/components/missions/mission-runner";
import { ScreenHeader } from "@/components/student/screen-header";
import { Skeleton } from "@/components/ui/skeleton";
import { availableLiters } from "@/lib/collector/water";
import type { MissionAvailability } from "@/lib/missions/availability";
import type { MissionDefinition } from "@/lib/missions/catalog";
import { formatLiters } from "@/lib/utils/format";

interface BoardItem {
  mission: MissionDefinition;
  availability: MissionAvailability;
}

export function MissionsScreen() {
  const { collectorCode, snapshot, items, availableCount } = useMissionBoard();
  const { start } = useMissionRunner();

  if (!collectorCode || !snapshot) {
    return (
      <div className="space-y-4 pt-6" aria-busy="true" aria-label="Carregando">
        <Skeleton className="h-16 w-2/3" />
        <Skeleton className="h-40 w-full rounded-card" />
        <Skeleton className="h-40 w-full rounded-card" />
      </div>
    );
  }

  const free = availableLiters(snapshot.telemetry.volumeLiters, snapshot.info.reserveLiters);
  const ready = items.filter((entry) => entry.availability.status === "available");
  const onHold = items.filter((entry) => entry.availability.status !== "available");

  const renderList = (list: BoardItem[], offset: number) => (
    <ul className="space-y-3">
      {list.map((entry, index) => (
        <motion.li
          key={entry.mission.id}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 30, delay: (offset + index) * 0.06 }}
        >
          <MissionCard
            mission={entry.mission}
            availability={entry.availability}
            collectorCode={collectorCode}
            onConfirm={(mission) => start(mission, collectorCode)}
          />
        </motion.li>
      ))}
    </ul>
  );

  return (
    <div className="space-y-6 pt-6">
      <ScreenHeader
        eyebrow={`EcoCaptador ${collectorCode}`}
        title="Missões"
        subtitle={`${availableCount} disponíveis agora · ${formatLiters(free)} livres para uso`}
        isSimulation={snapshot.telemetry.origin === "simulation"}
      />

      {ready.length > 0 && (
        <section className="space-y-3">
          <h2 className="eyebrow text-leaf-300">Disponíveis agora</h2>
          {renderList(ready, 0)}
        </section>
      )}

      {onHold.length > 0 && (
        <section className="space-y-3">
          <h2 className="eyebrow">Em espera</h2>
          {renderList(onHold, ready.length)}
        </section>
      )}
    </div>
  );
}
