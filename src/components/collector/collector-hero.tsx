"use client";

import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import Link from "next/link";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { Chip, type ChipTone } from "@/components/ui/chip";
import { StatusPill } from "@/components/ui/status-pill";
import { Surface, type SurfaceTone } from "@/components/ui/surface";
import { useNow } from "@/hooks/use-now";
import { fillRatio, getLevelState, type LevelStateId } from "@/lib/collector/level-state";
import type { CollectorSnapshot, CollectorTelemetry } from "@/lib/iot/types";
import { formatDecimal, formatLiters, formatPercent, formatRelativeTime } from "@/lib/utils/format";

const STATE_TONE: Record<LevelStateId, ChipTone> = {
  low: "neutral",
  available: "aqua",
  good: "leaf",
  attention: "ember",
  critical: "alert",
};

export function collectorSurfaceTone(snapshot: CollectorSnapshot): SurfaceTone {
  const ratio = fillRatio(snapshot.telemetry.volumeLiters, snapshot.info.capacityLiters);
  const { urgency } = getLevelState(ratio);
  if (snapshot.telemetry.overflowing || urgency === "critical") return "alert";
  if (urgency === "attention") return "ember";
  return "aqua";
}

export function TrendLabel({ telemetry }: { telemetry: CollectorTelemetry }) {
  const rate = `${telemetry.netFlowLitersPerHour >= 0 ? "+" : ""}${formatDecimal(telemetry.netFlowLitersPerHour)} L/h`;
  if (telemetry.trend === "rising") {
    return (
      <span className="flex items-center gap-1 text-aqua-300">
        <ArrowUpRight className="size-4" aria-hidden /> Acumulando · {rate}
      </span>
    );
  }
  if (telemetry.trend === "falling") {
    return (
      <span className="flex items-center gap-1 text-leaf-300">
        <ArrowDownRight className="size-4" aria-hidden /> Nível descendo · {rate}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1">
      <Minus className="size-4" aria-hidden /> Estável
    </span>
  );
}

interface CollectorHeroProps {
  snapshot: CollectorSnapshot;
  /** Na Home o card leva ao detalhe do captador. */
  href?: string;
}

export function CollectorHero({ snapshot, href }: CollectorHeroProps) {
  const { info, telemetry } = snapshot;
  const now = useNow(1000);
  const ratio = fillRatio(telemetry.volumeLiters, info.capacityLiters);
  const state = getLevelState(ratio);

  const content = (
    <Surface tone={collectorSurfaceTone(snapshot)} className="relative overflow-hidden p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow">EcoCaptador</p>
          <p className="truncate font-display text-sm font-semibold text-mist-50">
            {info.code} · {info.location}
          </p>
        </div>
        <StatusPill status={telemetry.status} />
      </div>

      <div className="mt-5 flex items-end gap-5">
        {/* Fase 5: captador animado */}
        <div data-slot="tank" className="relative h-40 w-20 shrink-0 overflow-hidden rounded-2xl bg-white/[0.05] ring-1 ring-inset ring-white/10">
          <div
            className="absolute inset-x-0 bottom-0 bg-linear-to-t from-aqua-600 to-aqua-300 transition-[height] duration-700"
            style={{ height: `${ratio * 100}%` }}
          />
        </div>
        <div className="min-w-0 flex-1 pb-1">
          <p className="font-display text-[3.25rem] font-bold leading-none tracking-tight text-mist-50">
            <AnimatedNumber value={telemetry.volumeLiters} format={(value) => formatDecimal(Math.max(0, value))} />
            <span className="ml-1 text-2xl text-aqua-300">L</span>
          </p>
          <p className="mt-2 text-sm text-mist-300">
            <span className="font-semibold tabular-nums text-mist-50">{formatPercent(ratio)}</span> de{" "}
            {formatLiters(info.capacityLiters, 0)}
          </p>
          <Chip tone={STATE_TONE[state.id]} className="mt-3">
            {state.label}
          </Chip>
        </div>
      </div>

      <p className="mt-4 text-sm text-mist-300">{state.message}</p>

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-white/[0.06] pt-3 text-xs text-mist-400">
        <TrendLabel telemetry={telemetry} />
        {now !== null && <span className="shrink-0">Leitura {formatRelativeTime(telemetry.measuredAt, now)}</span>}
      </div>
    </Surface>
  );

  if (!href) return content;
  return (
    <Link href={href} className="block rounded-card active:scale-[0.99] transition-transform" aria-label={`Ver captador ${info.code}`}>
      {content}
    </Link>
  );
}
