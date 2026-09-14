"use client";

import { motion } from "motion/react";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { CollectorAlertBanner } from "@/components/collector/collector-alert";
import { CollectorHero } from "@/components/collector/collector-hero";
import { WaterBalance } from "@/components/collector/water-balance";
import { MyImpactCard } from "@/components/gamification/my-impact-card";
import { MissionCard } from "@/components/missions/mission-card";
import { useMissionBoard, useMissionRunner } from "@/components/missions/mission-runner";
import { SimulationBadge } from "@/components/ui/simulation-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar } from "@/components/users/avatar";
import { useDemoProfile } from "@/hooks/use-demo-profile";
import { getCollectorAlert } from "@/lib/collector/alerts";
import { fillRatio } from "@/lib/collector/level-state";
import { getLevelProgress } from "@/lib/gamification/levels";
import { DEFAULT_AVATAR_ID } from "@/lib/users/avatars";
import { ROLE_LABEL } from "@/lib/users/types";

const container = { hidden: {}, show: { transition: { staggerChildren: 0.07 } } };
const item = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 300, damping: 30 } },
};

export function HomeScreen() {
  const { collectorCode, snapshot, items, availableCount } = useMissionBoard();
  const { start } = useMissionRunner();
  const profile = useDemoProfile();

  if (!collectorCode || !snapshot) return <HomeSkeleton />;

  const { identity } = profile;
  const level = getLevelProgress(profile.xp);
  const ratio = fillRatio(snapshot.telemetry.volumeLiters, snapshot.info.capacityLiters);
  const alert = getCollectorAlert({
    collectorCode,
    ratio,
    trend: snapshot.telemetry.trend,
    overflowing: snapshot.telemetry.overflowing,
  });
  const featured = items[0];

  return (
    <motion.div className="space-y-5 pt-5" variants={container} initial="hidden" animate="show">
      <motion.header variants={item} className="flex items-center gap-3">
        <Link href="/perfil" aria-label="Meu perfil" className="rounded-2xl active:scale-95 transition-transform">
          <Avatar avatarId={identity?.avatarId ?? DEFAULT_AVATAR_ID} />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-[1.55rem] font-bold leading-tight tracking-tight text-mist-50">
            Olá{identity ? `, ${identity.nickname}` : ""}! <span aria-hidden>🌱</span>
          </h1>
          <p className="truncate text-sm text-mist-400">
            <span className="font-semibold text-sun-300">{level.title}</span> · Nível {level.level}
            {identity && identity.role !== "student" ? ` · ${ROLE_LABEL[identity.role]}` : ""}
          </p>
        </div>
        {snapshot.telemetry.origin === "simulation" && <SimulationBadge />}
      </motion.header>

      <motion.div variants={item}>
        <CollectorHero snapshot={snapshot} href="/agua" />
      </motion.div>

      {alert && <CollectorAlertBanner alert={alert} />}

      {featured && (
        <motion.section variants={item} className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-semibold text-mist-50">
              {availableCount > 0
                ? `${availableCount} ${availableCount === 1 ? "missão disponível" : "missões disponíveis"}`
                : "Missões em espera"}
            </h2>
            <Link href="/missoes" className="flex items-center gap-0.5 text-sm font-semibold text-leaf-300">
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
        <h2 className="eyebrow">Meu impacto</h2>
        <MyImpactCard profile={profile} />
      </motion.section>

      <motion.section variants={item} className="space-y-3">
        <h2 className="eyebrow">Impacto do captador {collectorCode}</h2>
        <WaterBalance totals={snapshot.totals} />
      </motion.section>
    </motion.div>
  );
}

function HomeSkeleton() {
  return (
    <div className="space-y-5 pt-5" aria-busy="true" aria-label="Carregando">
      <div className="flex items-center gap-3">
        <Skeleton className="size-12 rounded-2xl" />
        <Skeleton className="h-9 flex-1" />
      </div>
      <Skeleton className="h-72 w-full rounded-card" />
      <Skeleton className="h-40 w-full rounded-card" />
      <Skeleton className="h-28 w-full rounded-card" />
    </div>
  );
}
