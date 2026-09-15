"use client";

import { motion } from "motion/react";
import { Droplets } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { CollectorTank, tankPropsFromSnapshot } from "@/components/collector/collector-tank";
import { MissionArt } from "@/components/missions/mission-art";
import { MissionCard } from "@/components/missions/mission-card";
import { useMissionBoard, useMissionRunner } from "@/components/missions/mission-runner";
import { RescueCard } from "@/components/missions/rescue-card";
import { ScreenHeader } from "@/components/student/screen-header";
import { Chip } from "@/components/ui/chip";
import { Skeleton } from "@/components/ui/skeleton";
import { Surface } from "@/components/ui/surface";
import { useNow } from "@/hooks/use-now";
import { useProfile } from "@/hooks/use-profile";
import { availableLiters } from "@/lib/collector/water";
import type { MissionAvailability } from "@/lib/missions/availability";
import { findMission, type MissionDefinition } from "@/lib/missions/catalog";
import { getRescuePlan } from "@/lib/missions/rescue";
import { cn } from "@/lib/utils/cn";
import { formatLiters, formatRelativeTime } from "@/lib/utils/format";

type Tab = "available" | "running" | "done";

const TABS: { id: Tab; label: string }[] = [
  { id: "available", label: "Disponíveis" },
  { id: "running", label: "Em andamento" },
  { id: "done", label: "Concluídas" },
];

interface BoardItem {
  mission: MissionDefinition;
  availability: MissionAvailability;
}

export function MissionsScreen() {
  const { collectorCode, snapshot, items, availableCount } = useMissionBoard();
  const { start } = useMissionRunner();
  const profile = useProfile();
  const now = useNow(30_000);
  const [tab, setTab] = useState<Tab>("available");

  if (!collectorCode || !snapshot) {
    return (
      <div className="space-y-4 pt-6" aria-busy="true" aria-label="Carregando">
        <Skeleton className="h-16 w-2/3" />
        <Skeleton className="h-11 w-full rounded-2xl" />
        <Skeleton className="h-40 w-full rounded-card" />
        <Skeleton className="h-40 w-full rounded-card" />
      </div>
    );
  }

  const plan = getRescuePlan(snapshot);
  const free = availableLiters(snapshot.telemetry.volumeLiters, snapshot.info.reserveLiters);
  const ready = items.filter((entry) => entry.availability.status === "available");
  const onHold = items.filter((entry) => entry.availability.status !== "available");
  const completed = profile.history.filter((record) => record.status === "COMPLETED");
  const dispensing = snapshot.telemetry.valve === "open" || snapshot.telemetry.status === "DISPENSING";

  const renderList = (list: BoardItem[], offset: number) => (
    <ul className="space-y-3">
      {list.map((entry, index) => (
        <motion.li
          key={entry.mission.id}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 30, delay: (offset + index) * 0.05 }}
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
    <div className="space-y-5 pt-6">
      <ScreenHeader
        eyebrow={`EcoCaptador ${collectorCode}`}
        title="Missões"
        subtitle={`${availableCount + (plan ? 1 : 0)} disponíveis · ${formatLiters(free)} livres para uso`}
        isSimulation={snapshot.telemetry.origin === "simulation"}
      />

      <div role="tablist" aria-label="Situação das missões" className="grid grid-cols-3 gap-1 rounded-2xl bg-white/[0.05] p-1">
        {TABS.map((item) => {
          const selected = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setTab(item.id)}
              className={cn(
                "relative h-10 rounded-xl text-[0.8rem] font-semibold transition-colors",
                selected ? "text-abyss-950" : "text-mist-300",
              )}
            >
              {selected && (
                <motion.span
                  layoutId="missions-tab"
                  className="absolute inset-0 rounded-xl bg-leaf-400"
                  transition={{ type: "spring", stiffness: 500, damping: 40 }}
                />
              )}
              <span className="relative">{item.label}</span>
            </button>
          );
        })}
      </div>

      {tab === "available" && (
        <div className="space-y-6">
          {plan && <RescueCard snapshot={snapshot} plan={plan} />}
          {ready.length > 0 && (
            <section className="space-y-3">
              <h2 className="eyebrow text-leaf-300">Prontas para agora</h2>
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
      )}

      {tab === "running" &&
        (dispensing ? (
          <Surface tone="aqua" className="flex items-center gap-4 p-5">
            <div className="h-28 shrink-0">
              <CollectorTank {...tankPropsFromSnapshot(snapshot)} />
            </div>
            <div className="min-w-0">
              <p className="font-display text-lg font-semibold text-mist-50">Liberando água no {collectorCode}</p>
              <p className="mt-1 text-sm text-mist-300">
                Uma missão está em andamento. As outras aguardam a válvula fechar.
              </p>
              <Link href="/agua" className="mt-3 inline-block text-sm font-semibold text-aqua-300">
                Acompanhar o captador
              </Link>
            </div>
          </Surface>
        ) : (
          <EmptyState title="Nenhuma missão em andamento" text="Quando uma liberação começar no captador, ela aparece aqui." />
        ))}

      {tab === "done" &&
        (completed.length === 0 ? (
          <EmptyState title="Nenhuma missão concluída ainda" text="Suas missões concluídas aparecem aqui, com os litros medidos pelo sensor." />
        ) : (
          <ul className="space-y-2">
            {completed.map((record) => {
              const mission = findMission(record.missionId);
              return (
                <li key={record.executionId}>
                  <Surface className="flex items-center gap-3 p-3">
                    {mission ? <MissionArt art={mission.art} className="size-14" /> : <span className="size-14 rounded-2xl bg-white/[0.05]" />}
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-mist-50">{mission?.title ?? record.missionId}</p>
                      <p className="flex items-center gap-1 text-xs text-mist-400">
                        <Droplets className="size-3.5 text-aqua-300" aria-hidden />
                        {formatLiters(record.deliveredLiters)} medidos
                        {now !== null && ` · ${formatRelativeTime(record.finishedAt, now)}`}
                      </p>
                    </div>
                    <Chip tone="sun">+{record.xpAwarded} XP</Chip>
                  </Surface>
                </li>
              );
            })}
          </ul>
        ))}
    </div>
  );
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <Surface className="p-6 text-center">
      <p className="font-display font-semibold text-mist-50">{title}</p>
      <p className="mt-1 text-sm text-mist-400">{text}</p>
    </Surface>
  );
}
