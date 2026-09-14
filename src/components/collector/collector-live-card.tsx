"use client";

import { AnimatedNumber } from "@/components/ui/animated-number";
import { StatusPill } from "@/components/ui/status-pill";
import { Surface } from "@/components/ui/surface";
import { useNow } from "@/hooks/use-now";
import { getLevelState } from "@/lib/collector/level-state";
import type { CollectorSnapshot } from "@/lib/iot/types";
import { cn } from "@/lib/utils/cn";
import { formatDecimal, formatLiters, formatPercent, formatRelativeTime } from "@/lib/utils/format";
import { collectorSurfaceTone, TrendLabel } from "./collector-hero";
import { CollectorTank, tankPropsFromSnapshot } from "./collector-tank";

function Annotation({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div>
      <dt className="eyebrow">{label}</dt>
      <dd className={cn("mt-0.5 text-sm font-semibold text-mist-100", className)}>{value}</dd>
    </div>
  );
}

/**
 * Visão "ao vivo" do captador: o tubo em tamanho grande com cada parte
 * física anotada ao lado (sensor, dreno, volume, válvula), na mesma altura.
 */
export function CollectorLiveCard({ snapshot }: { snapshot: CollectorSnapshot }) {
  const { info, telemetry } = snapshot;
  const now = useNow(1000);
  const tank = tankPropsFromSnapshot(snapshot);
  const state = getLevelState(tank.ratio);
  const toLimit = Math.max(0, info.capacityLiters - telemetry.volumeLiters);

  return (
    <Surface tone={collectorSurfaceTone(snapshot)} className="overflow-hidden p-5">
      <div className="flex items-center justify-between gap-3">
        <span className="eyebrow flex items-center gap-2 text-mist-100">
          <span className="relative flex size-2" aria-hidden>
            <span className="absolute inset-0 animate-pulse-ring rounded-full bg-leaf-400" />
            <span className="relative size-2 rounded-full bg-leaf-400" />
          </span>
          Ao vivo
        </span>
        <StatusPill status={telemetry.status} />
      </div>

      <div className="mt-3 flex gap-3">
        <div className="-ml-3 h-80 shrink-0">
          <CollectorTank {...tank} />
        </div>
        <dl className="flex min-w-0 flex-1 flex-col justify-between py-2">
          <Annotation
            label="Sensor VL53L1X"
            value={telemetry.distanceMm === null ? "Sem leitura" : `${telemetry.distanceMm} mm até a água`}
          />
          <Annotation
            label="Dreno de segurança"
            value={telemetry.overflowing ? "Escoando água" : `${formatLiters(toLimit)} até o limite`}
            className={telemetry.overflowing ? "text-alert-400" : undefined}
          />
          <div>
            <dt className="eyebrow">Volume medido</dt>
            <dd className="font-display text-4xl font-bold leading-tight tracking-tight text-mist-50">
              <AnimatedNumber value={telemetry.volumeLiters} format={(value) => formatDecimal(Math.max(0, value))} />
              <span className="ml-1 text-xl text-aqua-300">L</span>
            </dd>
            <dd className="text-sm text-mist-300">
              <span className="font-semibold text-mist-50">{formatPercent(tank.ratio)}</span> · {state.label}
            </dd>
          </div>
          <Annotation
            label="Válvula de saída"
            value={telemetry.valve === "open" ? "Aberta · liberando" : telemetry.valve === "closed" ? "Fechada" : "Desconhecida"}
            className={telemetry.valve === "open" ? "text-aqua-300" : undefined}
          />
        </dl>
      </div>

      <p className="mt-3 text-sm text-mist-300">{state.message}</p>

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-white/[0.06] pt-3 text-xs text-mist-400">
        <TrendLabel telemetry={telemetry} />
        <span className="shrink-0">
          {telemetry.measuredAt === null
            ? "Aguardando primeira leitura"
            : now !== null && `Leitura ${formatRelativeTime(telemetry.measuredAt, now)}`}
        </span>
      </div>
    </Surface>
  );
}
