"use client";

import { AnimatePresence, motion } from "motion/react";
import { Check, CircleAlert, Droplets, Gauge, Leaf, LoaderCircle, MapPin, Send, Sparkles, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useCollectorSnapshot } from "@/components/collector/collector-source";
import { CollectorTank, tankPropsFromSnapshot } from "@/components/collector/collector-tank";
import { AchievementBadge } from "@/components/gamification/achievement-badge";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/progress-bar";
import { SimulationBadge } from "@/components/ui/simulation-badge";
import { Surface } from "@/components/ui/surface";
import { useProfile } from "@/hooks/use-profile";
import { ACHIEVEMENTS, unlockedAchievements } from "@/lib/gamification/achievements";
import { getLevelProgress } from "@/lib/gamification/levels";
import type { DispenseProgress } from "@/lib/iot/types";
import type { MissionDefinition } from "@/lib/missions/catalog";
import { CANCELLED_COPY, FAILURE_COPY, isTerminal, xpForExecution } from "@/lib/missions/execution";
import { cn } from "@/lib/utils/cn";
import { formatDecimal, formatDuration, formatLiters } from "@/lib/utils/format";
import { MissionArt } from "./mission-art";
import { WateringCan } from "./watering-can";

const STEPS = [
  { title: "Preparando", icon: Send },
  { title: "Liberando", icon: Droplets },
  { title: "Medindo", icon: Gauge },
  { title: "Concluída", icon: Check },
] as const;

/** Etapa atual a partir do estado real reportado pelo dispositivo. */
function stepIndex(progress: DispenseProgress | null) {
  switch (progress?.status) {
    case "EXECUTING":
      return 1;
    case "MEASURING":
      return 2;
    case "COMPLETED":
      return 3;
    case "FAILED":
    case "CANCELLED":
      return progress.startedAt ? 1 : 0;
    default:
      return 0;
  }
}

const RUNNING_COPY = {
  QUEUED: { title: "Preparando sua missão…", detail: (code: string) => `Comando enviado ao captador ${code}.` },
  EXECUTING: { title: "Liberando água…", detail: () => "Válvula aberta. O sensor acompanha a queda do nível." },
  MEASURING: { title: "Medindo o volume…", detail: () => "Válvula fechada. Aguardando a água estabilizar." },
};

interface ExecutionOverlayProps {
  mission: MissionDefinition;
  collectorCode: string;
  progress: DispenseProgress | null;
  xpBefore: number;
  achievementsBefore: string[];
  onCancel: () => void;
  onClose: () => void;
}

export function ExecutionOverlay({
  mission,
  collectorCode,
  progress,
  xpBefore,
  achievementsBefore,
  onCancel,
  onClose,
}: ExecutionOverlayProps) {
  const terminal = isTerminal(progress);
  const failed = progress?.status === "FAILED" || progress?.status === "CANCELLED";

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label={`Execução da missão ${mission.title}`}
      className="fixed inset-0 z-40 overflow-y-auto bg-abyss-950"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
    >
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 bg-[radial-gradient(100%_55%_at_50%_0%,rgb(47_196_111/0.16),transparent_65%)]"
      />
      <div className="relative mx-auto flex min-h-dvh max-w-md flex-col px-5 pb-safe pt-safe">
        <header className="flex items-center gap-3 pt-5">
          <MissionArt art={mission.art} className="size-10 rounded-xl" />
          <div className="min-w-0 flex-1">
            <p className="eyebrow truncate">{terminal ? "Finalizada" : "Em execução"}</p>
            <p className="truncate font-display font-semibold text-mist-50">{mission.title}</p>
          </div>
          {progress?.origin === "simulation" && <SimulationBadge />}
          {terminal && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar"
              className="grid size-10 shrink-0 place-items-center rounded-full bg-white/[0.06] text-mist-300 active:scale-95"
            >
              <X className="size-5" />
            </button>
          )}
        </header>

        <Stepper current={stepIndex(progress)} failed={failed} />

        <AnimatePresence mode="wait">
          {progress?.status === "COMPLETED" ? (
            <ResultPanel
              key="result"
              mission={mission}
              progress={progress}
              xpBefore={xpBefore}
              achievementsBefore={achievementsBefore}
              onClose={onClose}
            />
          ) : failed && progress ? (
            <FailurePanel key="failure" progress={progress} onClose={onClose} />
          ) : (
            <RunningPanel key="running" mission={mission} collectorCode={collectorCode} progress={progress} onCancel={onCancel} />
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

const panelMotion = {
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -14 },
  transition: { duration: 0.3, ease: [0.22, 1, 0.36, 1] as const },
};

function Stepper({ current, failed }: { current: number; failed: boolean }) {
  return (
    <ol className="mt-5 grid grid-cols-4" aria-label="Etapas da missão">
      {STEPS.map((step, index) => {
        const isLast = index === STEPS.length - 1;
        const state =
          failed && index === current
            ? "failed"
            : index < current || (index === current && isLast)
              ? "done"
              : index === current
                ? "active"
                : "pending";
        const Icon = step.icon;
        return (
          <li key={step.title} aria-current={state === "active" ? "step" : undefined} className="relative flex flex-col items-center gap-1.5">
            {index > 0 && (
              <span
                aria-hidden
                className={cn(
                  "absolute right-1/2 top-[18px] h-0.5 w-full transition-colors duration-500",
                  index <= current && !(failed && index === current) ? "bg-leaf-400/70" : "bg-white/10",
                )}
              />
            )}
            <span
              className={cn(
                "relative z-10 grid size-9 place-items-center rounded-full ring-1 ring-inset transition-colors duration-300",
                state === "done" && "bg-leaf-400 text-abyss-950 ring-leaf-400",
                state === "active" && "bg-abyss-800 text-aqua-300 ring-aqua-400 shadow-[0_0_20px_rgb(46_197_240/0.45)]",
                state === "failed" && "bg-alert-400/20 text-alert-400 ring-alert-400/50",
                state === "pending" && "bg-abyss-900 text-mist-500 ring-white/10",
              )}
            >
              {state === "done" ? (
                <Check className="size-4" strokeWidth={3} />
              ) : state === "active" ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : state === "failed" ? (
                <X className="size-4" strokeWidth={3} />
              ) : (
                <Icon className="size-4" />
              )}
            </span>
            <span className={cn("text-[11px] font-semibold", state === "pending" ? "text-mist-500" : "text-mist-100")}>{step.title}</span>
          </li>
        );
      })}
    </ol>
  );
}

function RunningPanel({
  mission,
  collectorCode,
  progress,
  onCancel,
}: {
  mission: MissionDefinition;
  collectorCode: string;
  progress: DispenseProgress | null;
  onCancel: () => void;
}) {
  const snapshot = useCollectorSnapshot(collectorCode);
  const target = progress?.targetLiters ?? mission.liters ?? 0;
  const delivered = progress?.deliveredLiters ?? 0;
  const status = progress?.status === "EXECUTING" || progress?.status === "MEASURING" ? progress.status : "QUEUED";
  const copy = RUNNING_COPY[status];
  const cancellable = status === "QUEUED" || status === "EXECUTING";

  return (
    <motion.div className="flex flex-1 flex-col" {...panelMotion}>
      <div className="flex flex-col items-center pb-2 pt-6" data-testid="execution-stage">
        {snapshot && (
          <div className="h-48">
            <CollectorTank {...tankPropsFromSnapshot(snapshot)} measuring={status === "MEASURING"} />
          </div>
        )}
        <WateringCan fill={target > 0 ? delivered / target : 0} flowing={snapshot?.telemetry.valve === "open"} className="-mt-1 h-20" />
        <p className="mt-2 flex items-center gap-1.5 text-xs text-mist-400">
          <MapPin className="size-3.5" aria-hidden /> Destino: {mission.location}
        </p>
      </div>

      <Surface className="mt-4 space-y-4 p-4">
        <div>
          <p className="font-display text-lg font-semibold text-mist-50">{copy.title}</p>
          <p className="text-sm text-mist-400">{copy.detail(collectorCode)}</p>
        </div>
        <ProgressBar value={target > 0 ? delivered / target : 0} tone="aqua" label="Volume medido" />
        <div className="grid grid-cols-2 divide-x divide-white/[0.06]">
          <div>
            <p className="text-xs text-mist-400">Volume alvo</p>
            <p className="font-display text-2xl font-bold text-mist-50">{formatLiters(target, 1)}</p>
          </div>
          <div className="pl-4">
            <p className="text-xs text-mist-400">Volume medido</p>
            <p className="font-display text-2xl font-bold text-aqua-300">
              <AnimatedNumber value={delivered} format={(value) => formatLiters(Math.max(0, value))} />
            </p>
          </div>
        </div>
      </Surface>

      <div className="mt-auto space-y-3 py-5">
        {cancellable && (
          <Button
            variant="danger"
            className="w-full"
            disabled={progress?.cancelRequested}
            onClick={onCancel}
            data-testid="cancel-mission"
          >
            {progress?.cancelRequested ? "Fechando a válvula…" : "Cancelar missão"}
          </Button>
        )}
        <p className="text-center text-xs text-mist-500">A válvula fecha automaticamente. Mantenha o regador na saída do captador.</p>
      </div>
    </motion.div>
  );
}

function ResultPanel({
  mission,
  progress,
  xpBefore,
  achievementsBefore,
  onClose,
}: {
  mission: MissionDefinition;
  progress: DispenseProgress;
  xpBefore: number;
  achievementsBefore: string[];
  onClose: () => void;
}) {
  const router = useRouter();
  const profile = useProfile();
  const xp = xpForExecution(mission, progress);
  const before = getLevelProgress(xpBefore);
  const after = getLevelProgress(xpBefore + xp);
  const leveledUp = after.level > before.level;
  const duration = progress.startedAt !== null && progress.finishedAt !== null ? progress.finishedAt - progress.startedAt : null;
  const unlocked = unlockedAchievements(profile.history);
  const newAchievements = ACHIEVEMENTS.filter((item) => unlocked.has(item.id) && !achievementsBefore.includes(item.id));

  const leave = (href: "/" | "/agua") => {
    onClose();
    router.push(href);
  };

  return (
    <motion.div className="relative flex flex-1 flex-col" {...panelMotion}>
      <Confetti />
      <div className="flex flex-col items-center pt-8 text-center">
        <p className="eyebrow text-leaf-300">Missão concluída</p>
        <p className="mt-2 text-mist-300">Você reutilizou</p>
        <p className="font-display text-7xl font-bold tracking-tight text-leaf-300">
          <AnimatedNumber value={progress.deliveredLiters} format={(value) => formatDecimal(value)} />
          <span className="ml-1 text-3xl">L</span>
        </p>
        <p className="mt-1 text-sm text-mist-400">de água que seria descartada</p>
      </div>

      <ul className="mt-6 grid gap-2">
        {[
          { icon: <Droplets className="size-5 text-aqua-300" />, text: `${formatLiters(progress.deliveredLiters)} reutilizados` },
          { icon: <Leaf className="size-5 text-leaf-300" />, text: mission.impact },
          { icon: <Sparkles className="size-5 text-sun-300" />, text: `+${xp} XP` },
        ].map((line, index) => (
          <motion.li
            key={line.text}
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.35 + index * 0.12 }}
            className="flex items-center gap-3 rounded-2xl bg-white/[0.04] px-4 py-3 font-semibold text-mist-50"
          >
            {line.icon}
            {line.text}
          </motion.li>
        ))}
      </ul>

      <Surface className="mt-3 grid grid-cols-3 divide-x divide-white/[0.06] py-3 text-center">
        <Metric label="Solicitado" value={formatLiters(progress.targetLiters)} />
        <Metric label="Medido" value={formatLiters(progress.deliveredLiters)} highlight />
        <Metric label="Duração" value={duration !== null ? formatDuration(duration) : "—"} />
      </Surface>

      <Surface className="mt-3 p-4">
        <div className="flex items-center justify-between gap-3 text-xs text-mist-400">
          <span className="font-semibold text-sun-300">{leveledUp ? `Novo nível: ${after.title}!` : `Nível ${after.level} · ${after.title}`}</span>
          <span>
            {after.xp}
            {after.nextLevelXp !== null && ` / ${after.nextLevelXp}`} XP
          </span>
        </div>
        <DelayedProgress from={before.progress} to={leveledUp ? 1 : after.progress} />
      </Surface>

      {newAchievements.length > 0 && (
        <motion.div initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.9, type: "spring" }} className="mt-3 space-y-2">
          <p className="eyebrow text-sun-300">Conquista desbloqueada</p>
          {newAchievements.map((achievement) => (
            <AchievementBadge key={achievement.id} achievement={achievement} unlocked />
          ))}
        </motion.div>
      )}

      <div className="mt-auto grid gap-3 py-6">
        <Button size="lg" variant="leaf" onClick={() => leave("/")}>
          Voltar ao início
        </Button>
        <Button variant="secondary" onClick={() => leave("/agua")}>
          Ver o captador
        </Button>
      </div>
    </motion.div>
  );
}

function DelayedProgress({ from, to }: { from: number; to: number }) {
  const [value, setValue] = useState(from);
  useEffect(() => {
    const id = window.setTimeout(() => setValue(to), 600);
    return () => window.clearTimeout(id);
  }, [to]);
  return <ProgressBar value={value} tone="sun" label="Progresso de XP" className="mt-2" />;
}

function Metric({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="px-2">
      <p className="text-[11px] text-mist-400">{label}</p>
      <p className={cn("mt-0.5 font-display text-sm font-semibold tabular-nums", highlight ? "text-leaf-300" : "text-mist-100")}>{value}</p>
    </div>
  );
}

function FailurePanel({ progress, onClose }: { progress: DispenseProgress; onClose: () => void }) {
  const cancelled = progress.status === "CANCELLED";
  const copy = cancelled ? CANCELLED_COPY : FAILURE_COPY[progress.failure ?? "SENSOR_ERROR"];
  return (
    <motion.div className="flex flex-1 flex-col" {...panelMotion}>
      <div className="flex flex-col items-center pt-12 text-center">
        <span
          className={cn(
            "grid size-16 place-items-center rounded-full ring-1 ring-inset",
            cancelled ? "bg-white/[0.06] text-mist-300 ring-white/10" : "bg-alert-400/15 text-alert-400 ring-alert-400/30",
          )}
        >
          {cancelled ? <X className="size-8" /> : <CircleAlert className="size-8" />}
        </span>
        <h2 className="mt-5 font-display text-2xl font-bold text-mist-50">{copy.title}</h2>
        <p className="mt-2 max-w-xs text-sm leading-relaxed text-mist-300">{copy.message}</p>
        {progress.deliveredLiters > 0.01 && (
          <p className="mt-4 text-sm text-mist-400">
            Medido antes do fechamento: <span className="font-semibold text-mist-100">{formatLiters(progress.deliveredLiters)}</span>
          </p>
        )}
        <p className="mt-4 text-xs text-mist-500">Nenhuma penalidade: você pode tentar outra missão.</p>
      </div>
      <div className="mt-auto py-6">
        <Button size="lg" variant="secondary" className="w-full" onClick={onClose}>
          Voltar às missões
        </Button>
      </div>
    </motion.div>
  );
}

/** Pseudoaleatório determinístico: mantém a renderização pura. */
function seeded(index: number, salt: number) {
  const value = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

const CONFETTI_COLORS = ["var(--color-leaf-400)", "var(--color-aqua-300)", "var(--color-sun-400)", "var(--color-mist-50)"];

function Confetti() {
  const pieces = useMemo(
    () =>
      Array.from({ length: 22 }, (_, index) => ({
        x: (seeded(index, 1) - 0.5) * 320,
        peak: -60 - seeded(index, 2) * 120,
        fall: 180 + seeded(index, 3) * 160,
        rotate: (seeded(index, 4) - 0.5) * 540,
        delay: seeded(index, 5) * 0.15,
        color: CONFETTI_COLORS[index % CONFETTI_COLORS.length],
      })),
    [],
  );

  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-10 flex justify-center">
      {pieces.map((piece, index) => (
        <motion.span
          key={index}
          className="absolute size-2 rounded-[2px]"
          style={{ backgroundColor: piece.color }}
          initial={{ x: 0, y: 0, opacity: 0, rotate: 0, scale: 0.5 }}
          animate={{ x: piece.x, y: [0, piece.peak, piece.fall], opacity: [0, 1, 0], rotate: piece.rotate, scale: 1 }}
          transition={{ duration: 1.7, ease: "easeOut", delay: 0.25 + piece.delay }}
        />
      ))}
    </div>
  );
}
