"use client";

import { Droplets, Sparkles, Target, Trophy, Users } from "lucide-react";
import { useMissionBoard } from "@/components/missions/mission-runner";
import { ScreenHeader } from "@/components/student/screen-header";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Skeleton } from "@/components/ui/skeleton";
import { Surface } from "@/components/ui/surface";
import { Avatar } from "@/components/users/avatar";
import { useProfile } from "@/hooks/use-profile";
import { reuseRate } from "@/lib/collector/water";
import { summarizeProfile } from "@/lib/student/profile-store";
import { DEFAULT_AVATAR_ID } from "@/lib/users/avatars";
import { describeIdentity } from "@/lib/users/display";
import { formatDecimal, formatPercent } from "@/lib/utils/format";

/**
 * Ranking com impacto coletivo em primeiro lugar. As listas individual e por
 * turma só aparecem com contas reais — nenhum participante é inventado.
 */
export function RankingScreen() {
  const { collectorCode, snapshot } = useMissionBoard();
  const profile = useProfile();

  if (!collectorCode || !snapshot) {
    return (
      <div className="space-y-4 pt-6" aria-busy="true" aria-label="Carregando">
        <Skeleton className="h-16 w-2/3" />
        <Skeleton className="h-52 w-full rounded-card" />
        <Skeleton className="h-36 w-full rounded-card" />
      </div>
    );
  }

  const { totals } = snapshot;
  const rate = reuseRate(totals);
  const mine = summarizeProfile(profile);
  // O balanço do captador simulado pode ser reiniciado pelo professor: só mostra a fatia quando é coerente.
  const share =
    mine.litersReused > 0.01 && mine.litersReused <= totals.reusedLiters ? mine.litersReused / totals.reusedLiters : null;
  const { identity } = profile;

  return (
    <div className="space-y-6 pt-6">
      <ScreenHeader
        eyebrow="Impacto coletivo"
        title="Ranking"
        subtitle={profile.schoolName ?? "Carregando…"}
        isSimulation={snapshot.telemetry.origin === "simulation"}
        isReal={snapshot.telemetry.origin === "device"}
      />

      <section className="space-y-3">
        <h2 className="eyebrow text-leaf-300">Nosso impacto</h2>
        <Surface tone="leaf" className="p-5">
          <p className="text-sm text-mist-300">Água reutilizada no captador {collectorCode}</p>
          <p className="mt-1 font-display text-5xl font-bold tracking-tight text-leaf-300">
            <AnimatedNumber value={totals.reusedLiters} format={(value) => formatDecimal(value, 1)} />
            <span className="ml-1 text-2xl">L</span>
          </p>
          <div className="mt-4 grid grid-cols-3 divide-x divide-white/[0.08] text-center">
            <Metric label="Captado" value={`${formatDecimal(totals.capturedLiters, 1)} L`} />
            <Metric label="Aproveitamento" value={rate === null ? "—" : formatPercent(rate)} />
            <Metric label="Descartado*" value={`${formatDecimal(totals.discardedEstimatedLiters, 1)} L`} />
          </div>
          <ProgressBar value={rate ?? 0} tone="leaf" label="Taxa de aproveitamento" className="mt-4 h-2" />
          <p className="mt-2 text-[11px] text-mist-500">* Estimado: o sensor não mede a água que sai pelo dreno.</p>
        </Surface>
      </section>

      <section className="space-y-3">
        <h2 className="eyebrow">Sua contribuição</h2>
        <Surface className="p-4">
          <div className="flex items-center gap-3">
            <Avatar avatarId={identity?.avatarId ?? DEFAULT_AVATAR_ID} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-display font-semibold text-mist-50">{identity?.nickname ?? "Você"}</p>
              {identity && <p className="truncate text-xs text-mist-400">{describeIdentity(identity)}</p>}
            </div>
          </div>
          <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
            <Stat icon={<Droplets className="size-4 text-leaf-300" />} label="reutilizados" value={`${formatDecimal(mine.litersReused, 1)} L`} />
            <Stat icon={<Target className="size-4 text-aqua-300" />} label="missões" value={String(mine.missionsCompleted)} />
            <Stat icon={<Sparkles className="size-4 text-sun-300" />} label="XP" value={String(mine.xp)} />
          </dl>
          {share !== null && (
            <p className="mt-4 rounded-2xl bg-leaf-400/10 px-3 py-2.5 text-sm text-mist-100">
              Você reutilizou <strong className="text-leaf-300">{formatPercent(share)}</strong> da água reaproveitada deste captador.
            </p>
          )}
        </Surface>
      </section>

      <section className="space-y-3">
        <h2 className="eyebrow">Rankings</h2>
        <div className="grid grid-cols-2 gap-3">
          <Surface className="p-4">
            <Trophy className="size-6 text-sun-300" aria-hidden />
            <p className="mt-3 font-display font-semibold text-mist-50">Individual</p>
            <p className="mt-1 text-xs leading-relaxed text-mist-400">Por apelido, com XP e litros reutilizados.</p>
          </Surface>
          <Surface className="p-4">
            <Users className="size-6 text-aqua-300" aria-hidden />
            <p className="mt-3 font-display font-semibold text-mist-50">Por turma</p>
            <p className="mt-1 text-xs leading-relaxed text-mist-400">Soma do impacto de cada turma.</p>
          </Surface>
        </div>
        <p className="text-center text-xs leading-relaxed text-mist-500">
          As listas aparecem quando a escola ativar as contas oficiais. Nunca exibem nome completo ou data de nascimento.
        </p>
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-1">
      <p className="text-[11px] font-medium text-mist-400">{label}</p>
      <p className="mt-1 font-display text-sm font-semibold text-mist-50">{value}</p>
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white/[0.04] px-2 py-3">
      <dt className="sr-only">{label}</dt>
      <dd className="flex items-center justify-center gap-1.5 font-display text-base font-bold text-mist-50">
        {icon}
        {value}
      </dd>
      <dd className="text-[11px] text-mist-400">{label}</dd>
    </div>
  );
}
