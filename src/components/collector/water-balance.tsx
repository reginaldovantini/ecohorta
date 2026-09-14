"use client";

import { AnimatedNumber } from "@/components/ui/animated-number";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Surface } from "@/components/ui/surface";
import { reuseRate } from "@/lib/collector/water";
import type { WaterTotals } from "@/lib/iot/types";
import { formatDecimal, formatPercent } from "@/lib/utils/format";

/** Balanço hídrico: captado, reutilizado, descartado (estimado) e taxa de aproveitamento. */
export function WaterBalance({ totals }: { totals: WaterTotals }) {
  const rate = reuseRate(totals);
  const items = [
    { label: "Captado", value: totals.capturedLiters, className: "text-aqua-300" },
    { label: "Reutilizado", value: totals.reusedLiters, className: "text-leaf-300" },
    { label: "Descartado*", value: totals.discardedEstimatedLiters, className: "text-ember-400" },
  ];

  return (
    <Surface className="p-4">
      <div className="grid grid-cols-3 divide-x divide-white/[0.06] text-center">
        {items.map((item) => (
          <div key={item.label} className="px-1">
            <p className="eyebrow">{item.label}</p>
            <p className={`mt-1 font-display text-xl font-bold ${item.className}`}>
              <AnimatedNumber value={item.value} format={(value) => formatDecimal(value, 1)} />
              <span className="ml-0.5 text-xs">L</span>
            </p>
          </div>
        ))}
      </div>
      <div className="mt-4 border-t border-white/[0.06] pt-3">
        <div className="flex items-baseline justify-between text-sm">
          <span className="text-mist-300">Taxa de aproveitamento</span>
          <span className="font-display font-bold tabular-nums text-leaf-300">{rate === null ? "—" : formatPercent(rate)}</span>
        </div>
        <ProgressBar value={rate ?? 0} tone="leaf" label="Taxa de aproveitamento" className="mt-2 h-2" />
        <p className="mt-2 text-[11px] leading-snug text-mist-500">
          * Estimado: o sensor não mede diretamente a água que sai pelo dreno de segurança.
        </p>
      </div>
    </Surface>
  );
}
