"use client";

import { CircleAlert, Droplets, History, LogOut, Sparkles, Target } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AchievementBadge } from "@/components/gamification/achievement-badge";
import { LevelBadge } from "@/components/gamification/level-badge";
import { ACHIEVEMENTS, unlockedAchievements } from "@/lib/gamification/achievements";
import { ScreenHeader } from "@/components/student/screen-header";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Surface } from "@/components/ui/surface";
import { Avatar } from "@/components/users/avatar";
import { useNow } from "@/hooks/use-now";
import { useProfile } from "@/hooks/use-profile";
import { getLevelProgress, LEVELS } from "@/lib/gamification/levels";
import { findMission } from "@/lib/missions/catalog";
import { profileStore, summarizeProfile } from "@/lib/student/profile-store";
import { DEFAULT_AVATAR_ID } from "@/lib/users/avatars";
import { describeIdentity } from "@/lib/users/display";
import { ROLE_LABEL } from "@/lib/users/types";
import { cn } from "@/lib/utils/cn";
import { formatDecimal, formatLiters, formatRelativeTime } from "@/lib/utils/format";

export function ProfileScreen() {
  const router = useRouter();
  const profile = useProfile();
  const now = useNow(30_000);
  const level = getLevelProgress(profile.xp);
  const summary = summarizeProfile(profile);
  const nextTitle = LEVELS[level.level]?.title;
  const { identity } = profile;
  const unlocked = unlockedAchievements(profile.history);

  const stats = [
    { label: "Litros reutilizados", value: formatDecimal(summary.litersReused, 1), unit: " L", icon: Droplets, tone: "text-leaf-300" },
    { label: "Missões concluídas", value: String(summary.missionsCompleted), unit: "", icon: Target, tone: "text-aqua-300" },
    { label: "XP total", value: String(summary.xp), unit: "", icon: Sparkles, tone: "text-sun-300" },
  ];

  return (
    <div className="space-y-6 pt-6">
      <ScreenHeader
        eyebrow={profile.role ? ROLE_LABEL[profile.role] : "Perfil"}
        title="Meu impacto"
        subtitle={profile.schoolName ?? "Carregando…"}
        isSimulation={profile.history.some((record) => record.origin === "simulation")}
      />

      <Surface tone="aqua" className="flex flex-col items-center px-5 py-6 text-center">
        <div className="relative">
          <Avatar avatarId={identity?.avatarId ?? DEFAULT_AVATAR_ID} size="lg" />
          <LevelBadge level={level.level} size="sm" className="absolute -bottom-2 -right-3 ring-2 ring-abyss-800" />
        </div>
        <p className="mt-4 font-display text-2xl font-bold text-mist-50">{identity?.nickname ?? "Sem perfil"}</p>
        {identity && <p className="mt-0.5 text-sm text-mist-300">{describeIdentity(identity)}</p>}
        <p className="eyebrow mt-5 text-sun-300">
          Nível {String(level.level).padStart(2, "0")} · {level.title}
        </p>
        <ProgressBar value={level.progress} tone="sun" label="Progresso de XP" className="mt-3 w-full" />
        <p className="mt-2 text-xs text-mist-400">
          {level.nextLevelXp !== null && nextTitle
            ? `${level.xp} / ${level.nextLevelXp} XP · próximo nível: ${nextTitle}`
            : `${level.xp} XP · nível máximo`}
        </p>
      </Surface>

      <div className="grid grid-cols-3 gap-3">
        {stats.map(({ label, value, unit, icon: Icon, tone }) => (
          <Surface key={label} className="px-2 py-4 text-center">
            <Icon className={cn("mx-auto size-5", tone)} aria-hidden />
            <p className="mt-2 font-display text-xl font-bold tabular-nums text-mist-50">
              {value}
              <span className="text-xs text-mist-300">{unit}</span>
            </p>
            <p className="mt-0.5 text-[11px] leading-tight text-mist-400">{label}</p>
          </Surface>
        ))}
      </div>

      <section className="space-y-3">
        <h2 className="eyebrow">
          Conquistas · {unlocked.size}/{ACHIEVEMENTS.length}
        </h2>
        <div className="grid gap-2">
          {ACHIEVEMENTS.map((achievement) => (
            <AchievementBadge key={achievement.id} achievement={achievement} unlocked={unlocked.has(achievement.id)} />
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="eyebrow flex items-center gap-2">
          <History className="size-3.5" aria-hidden /> Histórico de ações
        </h2>

        {profile.history.length === 0 ? (
          <Surface className="p-6 text-center">
            <p className="font-display font-semibold text-mist-50">Nenhuma ação ainda</p>
            <p className="mt-1 text-sm text-mist-400">
              Sua primeira missão aparece aqui, com os litros medidos pelo sensor.
            </p>
            <Link
              href="/missoes"
              className="mt-4 inline-flex h-10 items-center rounded-xl bg-white/[0.07] px-4 text-sm font-semibold text-mist-50 ring-1 ring-inset ring-white/10"
            >
              Ver missões
            </Link>
          </Surface>
        ) : (
          <ul className="space-y-2">
            {profile.history.map((record) => {
              const mission = findMission(record.missionId);
              const completed = record.status === "COMPLETED";
              return (
                <li key={record.executionId}>
                  <Surface className="flex items-center gap-3 p-3.5">
                    <span
                      className={cn(
                        "grid size-10 shrink-0 place-items-center rounded-xl",
                        completed ? "bg-leaf-400/15 text-leaf-300" : "bg-white/[0.06] text-mist-400",
                      )}
                    >
                      {completed ? <Droplets className="size-5" /> : <CircleAlert className="size-5" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-mist-50">{mission?.title ?? record.missionId}</p>
                      <p className="text-xs text-mist-400">
                        {record.deliveredLiters > 0.01
                          ? `${formatLiters(record.deliveredLiters)} reutilizados`
                          : "Nenhuma água liberada"}
                        {!completed && " · não concluída"}
                        {now !== null && ` · ${formatRelativeTime(record.finishedAt, now)}`}
                      </p>
                    </div>
                    {record.xpAwarded > 0 && <Chip tone="sun">+{record.xpAwarded} XP</Chip>}
                  </Surface>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="grid gap-2">
        <Button
          variant="ghost"
          icon={<LogOut className="size-4" />}
          onClick={() => void profileStore.signOut().then(() => router.replace("/entrar"))}
        >
          Sair
        </Button>
      </div>
    </div>
  );
}
