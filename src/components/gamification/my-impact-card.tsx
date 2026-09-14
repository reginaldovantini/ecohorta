"use client";

import { Droplets, Sparkles, Target } from "lucide-react";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Surface } from "@/components/ui/surface";
import { getLevelProgress, LEVELS } from "@/lib/gamification/levels";
import { summarizeProfile, type DemoProfile } from "@/lib/student/demo-profile";
import { formatDecimal } from "@/lib/utils/format";
import { LevelBadge } from "./level-badge";

/** Meu impacto: progresso de nível e o que as ações do usuário já geraram. */
export function MyImpactCard({ profile }: { profile: DemoProfile }) {
  const level = getLevelProgress(profile.xp);
  const summary = summarizeProfile(profile);
  const nextTitle = LEVELS[level.level]?.title;

  const stats = [
    { label: "reutilizados", value: summary.litersReused, format: (v: number) => `${formatDecimal(v, 1)} L`, icon: Droplets, tone: "text-leaf-300" },
    { label: "missões", value: summary.missionsCompleted, format: (v: number) => String(Math.round(v)), icon: Target, tone: "text-aqua-300" },
    { label: "XP total", value: summary.xp, format: (v: number) => String(Math.round(v)), icon: Sparkles, tone: "text-sun-300" },
  ];

  return (
    <Surface className="p-4">
      <div className="flex items-center gap-3.5">
        <LevelBadge level={level.level} />
        <div className="min-w-0 flex-1">
          <p className="eyebrow truncate text-sun-300">
            Nível {String(level.level).padStart(2, "0")} · {level.title}
          </p>
          <ProgressBar value={level.progress} tone="sun" label="Progresso de XP" className="mt-2 h-2" />
          <p className="mt-1.5 truncate text-[11px] text-mist-400">
            {level.nextLevelXp !== null && nextTitle
              ? `${level.xp} / ${level.nextLevelXp} XP · faltam ${level.nextLevelXp - level.xp} para ${nextTitle}`
              : `${level.xp} XP · nível máximo`}
          </p>
        </div>
      </div>
      <dl className="mt-4 grid grid-cols-3 divide-x divide-white/[0.06] border-t border-white/[0.06] pt-3 text-center">
        {stats.map(({ label, value, format, icon: Icon, tone }) => (
          <div key={label} className="px-1">
            <dt className="sr-only">{label}</dt>
            <dd className="flex items-center justify-center gap-1.5 font-display text-lg font-bold text-mist-50">
              <Icon className={`size-4 ${tone}`} aria-hidden />
              <AnimatedNumber value={value} format={format} />
            </dd>
            <dd className="text-[11px] text-mist-400">{label}</dd>
          </div>
        ))}
      </dl>
    </Surface>
  );
}
