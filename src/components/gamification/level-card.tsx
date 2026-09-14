"use client";

import { AnimatedNumber } from "@/components/ui/animated-number";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Surface } from "@/components/ui/surface";
import { getLevelProgress, LEVELS } from "@/lib/gamification/levels";
import { cn } from "@/lib/utils/cn";

export function LevelBadge({ level, size = "md" }: { level: number; size?: "md" | "lg" }) {
  return (
    <span
      className={cn(
        "relative grid shrink-0 place-items-center rounded-2xl bg-linear-to-br from-sun-300 via-sun-400 to-sun-500 font-display font-bold text-abyss-950 shadow-[0_8px_24px_-8px_rgb(245_197_66/0.6),inset_0_1px_0_rgb(255_255_255/0.5)]",
        size === "lg" ? "size-20 rounded-3xl text-3xl" : "size-12 text-lg",
      )}
      aria-label={`Nível ${level}`}
    >
      {String(level).padStart(2, "0")}
    </span>
  );
}

export function LevelCard({ xp }: { xp: number }) {
  const progress = getLevelProgress(xp);
  const nextTitle = LEVELS[progress.level]?.title;

  return (
    <Surface className="flex items-center gap-4 p-4">
      <LevelBadge level={progress.level} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="eyebrow text-sun-300">Nível {String(progress.level).padStart(2, "0")}</p>
          <p className="text-xs text-mist-400">
            <AnimatedNumber value={xp} format={(value) => String(Math.round(value))} className="font-semibold text-mist-100" />
            {progress.nextLevelXp !== null && ` / ${progress.nextLevelXp}`} XP
          </p>
        </div>
        <p className="truncate font-display text-base font-semibold text-mist-50">{progress.title}</p>
        <ProgressBar value={progress.progress} tone="sun" label="Progresso de XP" className="mt-2 h-2" />
        {nextTitle && progress.nextLevelXp !== null && (
          <p className="mt-1.5 text-[11px] text-mist-500">
            Faltam {progress.nextLevelXp - progress.xp} XP para {nextTitle}
          </p>
        )}
      </div>
    </Surface>
  );
}
