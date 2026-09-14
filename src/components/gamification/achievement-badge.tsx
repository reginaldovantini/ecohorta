import { Droplets, Lock, ShieldCheck, Siren, Sprout, Target, type LucideIcon } from "lucide-react";
import type { AchievementDefinition, AchievementIcon } from "@/lib/gamification/achievements";
import { cn } from "@/lib/utils/cn";

const ICONS: Record<AchievementIcon, LucideIcon> = {
  droplets: Droplets,
  sprout: Sprout,
  siren: Siren,
  shield: ShieldCheck,
  target: Target,
};

export function AchievementBadge({ achievement, unlocked, className }: { achievement: AchievementDefinition; unlocked: boolean; className?: string }) {
  const Icon = unlocked ? ICONS[achievement.icon] : Lock;
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-2xl border p-3",
        unlocked ? "border-sun-400/30 bg-sun-400/10" : "border-white/[0.06] bg-white/[0.03]",
        className,
      )}
    >
      <span
        className={cn(
          "grid size-10 shrink-0 place-items-center rounded-xl",
          unlocked ? "bg-linear-to-br from-sun-300 to-sun-500 text-abyss-950" : "bg-white/[0.05] text-mist-500",
        )}
      >
        <Icon className="size-5" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className={cn("truncate text-sm font-semibold", unlocked ? "text-mist-50" : "text-mist-400")}>{achievement.title}</p>
        <p className="text-xs leading-snug text-mist-400">{achievement.description}</p>
      </div>
    </div>
  );
}
