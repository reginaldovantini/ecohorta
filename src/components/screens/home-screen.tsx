"use client";

import { motion } from "motion/react";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { CollectorAlertBanner } from "@/components/collector/collector-alert";
import { CollectorHero } from "@/components/collector/collector-hero";
import { WaterBalance } from "@/components/collector/water-balance";
import { LevelCard } from "@/components/gamification/level-card";
import { MissionCard } from "@/components/missions/mission-card";
import { useMissionBoard, useMissionRunner } from "@/components/missions/mission-runner";
import { SimulationBadge } from "@/components/ui/simulation-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useDemoProfile } from "@/hooks/use-demo-profile";
import { useHour } from "@/hooks/use-now";
import { getCollectorAlert } from "@/lib/collector/alerts";
import { fillRatio } from "@/lib/collector/level-state";

function greeting(hour: number | null) {
  if (hour === null) return "Olá";
  if (hour >= 5 && hour < 12) return "Bom dia";
  if (hour >= 12 && hour < 18) return "Boa tarde";
  return "Boa noite";
}

const container = { hidden: {}, show: { transition: { staggerChildren: 0.07 } } };
const item = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 300, damping: 30 } },
};

export function HomeScreen() {
  const { collectorCode, snapshot, items, availableCount } = useMissionBoard();
  const { start } = useMissionRunner();
  const profile = useDemoProfile();
  const hour = useHour();

  if (!collectorCode || !snapshot) return <HomeSkeleton />;

  const ratio = fillRatio(snapshot.telemetry.volumeLiters, snapshot.info.capacityLiters);
  const alert = getCollectorAlert({
    collectorCode,
    ratio,
    trend: snapshot.telemetry.trend,
    overflowing: snapshot.telemetry.overflowing,
  });
  const featured = items[0];

  return (
    <motion.div className="space-y-5 pt-6" variants={container} initial="hidden" animate="show">
      <motion.header variants={item} className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-[1.75rem] font-bold leading-tight tracking-tight text-mist-50">
            {greeting(hour)}! <span aria-hidden>🌱</span>
          </h1>
          <p className="mt-0.5 text-sm text-mist-400">
            {availableCount > 0
              ? `${availableCount} ${availableCount === 1 ? "missão disponível" : "missões disponíveis"} agora`
              : "O captador está acumulando água para novas missões"}
          </p>
        </div>
        {snapshot.telemetry.origin === "simulation" && <SimulationBadge className="mt-1.5" />}
      </motion.header>

      <motion.div variants={item}>
        <LevelCard xp={profile.xp} />
      </motion.div>

      <motion.div variants={item}>
        <CollectorHero snapshot={snapshot} href="/agua" />
      </motion.div>

      {alert && <CollectorAlertBanner alert={alert} />}

      {featured && (
        <motion.section variants={item} className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="eyebrow">Missão para agora</h2>
            <Link href="/missoes" className="flex items-center gap-0.5 text-sm font-semibold text-aqua-300">
              Ver todas <ChevronRight className="size-4" aria-hidden />
            </Link>
          </div>
          <MissionCard
            mission={featured.mission}
            availability={featured.availability}
            collectorCode={collectorCode}
            onConfirm={(mission) => start(mission, collectorCode)}
          />
        </motion.section>
      )}

      <motion.section variants={item} className="space-y-3">
        <h2 className="eyebrow">Impacto do captador</h2>
        <WaterBalance totals={snapshot.totals} />
      </motion.section>
    </motion.div>
  );
}

function HomeSkeleton() {
  return (
    <div className="space-y-5 pt-6" aria-busy="true" aria-label="Carregando">
      <Skeleton className="h-9 w-2/3" />
      <Skeleton className="h-24 w-full rounded-card" />
      <Skeleton className="h-72 w-full rounded-card" />
      <Skeleton className="h-40 w-full rounded-card" />
    </div>
  );
}
