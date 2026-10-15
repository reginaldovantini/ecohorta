"use client";

import { motion } from "motion/react";
import { ChevronRight, Droplets } from "lucide-react";
import Link from "next/link";
import { CollectorAlertBanner } from "@/components/collector/collector-alert";
import { CollectorHero } from "@/components/collector/collector-hero";
import { useCollectorCodes, useConnectionState } from "@/components/collector/collector-source";
import { CollectorOfflineCard } from "@/components/collector/collector-offline-card";
import { WaterBalance } from "@/components/collector/water-balance";
import { MyImpactCard } from "@/components/gamification/my-impact-card";
import { MissionCard } from "@/components/missions/mission-card";
import { useMissionBoard, useMissionRunner } from "@/components/missions/mission-runner";
import { RescueCard } from "@/components/missions/rescue-card";
import { CollectorSwitcher } from "@/components/collector/collector-switcher";
import { OriginBadge } from "@/components/ui/real-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar } from "@/components/users/avatar";
import { useProfile } from "@/hooks/use-profile";
import { NoCollectors, semCaptadores } from "@/components/collector/no-collectors";
import { getCollectorAlert } from "@/lib/collector/alerts";
import { fillRatio } from "@/lib/collector/level-state";
import { getLevelProgress } from "@/lib/gamification/levels";
import { getRescuePlan } from "@/lib/missions/rescue";
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
  const profile = useProfile();
  const codes = useCollectorCodes();
  const connection = useConnectionState();

  // Sem captador NENHUM, o esqueleto nunca sairia: a API já respondeu, e a
  // resposta foi "não há". Quem acabou de entrar precisa saber o que fazer.
  if (semCaptadores(connection, codes.length)) return <NoCollectors />;
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
  const plan = getRescuePlan(snapshot);
  const featured = items[0];

  return (
    <motion.div className="space-y-5 pt-5" variants={container} initial="hidden" animate="show">
      <motion.header variants={item} className="flex items-center gap-3">
        <Link href="/perfil" aria-label="Meu perfil" className="rounded-2xl active:scale-95 transition-transform">
          <Avatar avatarId={identity?.avatarId ?? DEFAULT_AVATAR_ID} />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-[1.3rem] font-bold leading-tight tracking-tight text-mist-50 min-[380px]:text-[1.55rem]">
            Olá{identity ? `, ${identity.nickname}` : ""}! <span aria-hidden>🌱</span>
          </h1>
          <p className="truncate text-sm text-mist-400">
            <span className="font-semibold text-sun-300">{level.title}</span> · Nível {level.level}
            {identity && identity.role !== "student" ? ` · ${ROLE_LABEL[identity.role]}` : ""}
          </p>
        </div>
        <OriginBadge origin={snapshot.telemetry.origin} />
      </motion.header>

      <CollectorSwitcher />

      <motion.div variants={item}>
        <CollectorHero snapshot={snapshot} href="/agua" />
      </motion.div>

      {/*
        Captador calado vem antes do alerta de nível: um alerta calculado sobre a
        última medição de ontem seria urgência inventada.
      */}
      {snapshot.telemetry.status === "OFFLINE" && (
        <motion.div variants={item}>
          <CollectorOfflineCard snapshot={snapshot} network={snapshot.rescueNetwork} />
        </motion.div>
      )}

      {snapshot.telemetry.status !== "OFFLINE" &&
        (plan ? <RescueCard snapshot={snapshot} plan={plan} /> : alert && <CollectorAlertBanner alert={alert} />)}

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
            location={snapshot?.info.location ?? collectorCode}
            onConfirm={(mission, scanId) => start(mission, collectorCode, scanId)}
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

        {/*
          A porta para a tela do captador.
          
          Ela perdeu a aba quando o Mural entrou, e o que há lá dentro — sensor,
          calibração, histórico de nível, socorro offline — não pode depender de
          alguém lembrar de tocar no tubo lá em cima. Fica no fim da Início, logo
          depois dos números que ela detalha.
        */}
        <Link
          href="/agua"
          className="flex items-center gap-3 rounded-card bg-white/[0.04] p-4 ring-1 ring-inset ring-white/[0.08] active:scale-[0.99] transition-transform"
        >
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-aqua-400/12 text-aqua-300">
            <Droplets className="size-5" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-display font-semibold text-mist-50">Ver o captador por dentro</span>
            <span className="mt-0.5 block text-xs leading-relaxed text-mist-400">
              Nível medido agora, sensor, calibração e o que fazer quando ele fica sem internet.
            </span>
          </span>
          <ChevronRight className="size-5 shrink-0 text-mist-400" aria-hidden />
        </Link>
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
