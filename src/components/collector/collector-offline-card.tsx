"use client";

import { motion } from "motion/react";
import { CloudOff, Smartphone, WifiOff } from "lucide-react";
import { useState } from "react";
import { Chip } from "@/components/ui/chip";
import { Surface } from "@/components/ui/surface";
import { useNow } from "@/hooks/use-now";
import { hotspotRescue, offlineEstimate } from "@/lib/collector/offline-estimate";
import type { CollectorSnapshot } from "@/lib/iot/types";
import { formatDecimal, formatLiters } from "@/lib/utils/format";

/*
 * O CAPTADOR ESTÁ CALADO — e isso precisa aparecer.
 *
 * A internet da escola cai no fim de semana e o captador continua captando água
 * sem conseguir contar. Se a tela apenas mostrasse o último número, as pessoas
 * acreditariam nele; se mostrasse "offline" e nada mais, ninguém iria até o tubo.
 *
 * Então este cartão faz as duas coisas: diz desde quando ele está calado e, pela
 * média que o próprio captador aprendeu medindo, estima o que deve haver lá
 * dentro — com o selo ESTIMATIVA grudado no número, porque estimativa não entra
 * em impacto, em ranking nem conclui missão.
 *
 * E oferece o resgate: o ponto de acesso do celular com o nome e a senha que a
 * placa já conhece. Dali em diante é o fluxo normal, e a missão conclui pelo
 * volume MEDIDO.
 */

interface OfflineCardProps {
  snapshot: CollectorSnapshot;
  /** Nome e senha da rede daquele captador, quando a plataforma as conhece. */
  network?: { ssid: string; password: string } | null;
}

export function CollectorOfflineCard({ snapshot, network }: OfflineCardProps) {
  const now = useNow(30_000);
  const [open, setOpen] = useState(false);
  if (now === null) return null;

  const silence = offlineEstimate({
    lastSeenAt: snapshot.telemetry.measuredAt,
    lastVolumeLiters: snapshot.telemetry.measuredAt === null ? null : snapshot.telemetry.volumeLiters,
    capacityLiters: snapshot.info.capacityLiters,
    learnedInflowLitersPerHour: snapshot.telemetry.learnedInflowLitersPerHour,
    acSchedule: snapshot.telemetry.acSchedule,
    nowMs: now,
  });
  if (!silence) return null;

  const rescue = network ? hotspotRescue(network) : null;

  return (
    <Surface tone={silence.callToAction ? "ember" : "default"} className="space-y-3 p-5">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-white/[0.06] text-mist-300">
          <CloudOff className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-display font-semibold text-mist-50">Sem conexão {silence.offlineFor}</p>
          <p className="mt-1 text-sm leading-relaxed text-mist-300">{silence.message}</p>
        </div>
      </div>

      {silence.estimatedLiters !== null && (
        <div className="flex items-end justify-between gap-3 rounded-2xl bg-abyss-950/40 px-4 py-3">
          <div>
            <p className="font-display text-3xl font-bold leading-none text-mist-50">
              {formatDecimal(silence.estimatedLiters)}
              <span className="ml-1 text-lg text-mist-400">L</span>
            </p>
            <p className="mt-1.5 text-xs text-mist-400">
              Última medição real: {silence.lastMeasuredLiters === null ? "—" : formatLiters(silence.lastMeasuredLiters)}
            </p>
          </div>
          {/* O selo não é decoração: é o que separa este número de um litro medido. */}
          <Chip tone="sun">{silence.label}</Chip>
        </div>
      )}

      {rescue && (
        <>
          <motion.button
            type="button"
            whileTap={{ scale: 0.97 }}
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-control bg-white/[0.07] text-sm font-semibold text-mist-50 ring-1 ring-inset ring-white/10"
          >
            <Smartphone className="size-4" aria-hidden />
            {open ? "Fechar" : "Dar internet ao captador"}
          </motion.button>

          {open && (
            <div className="space-y-3 rounded-2xl bg-white/[0.04] p-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-mist-100">
                <WifiOff className="size-4 text-sun-300" aria-hidden />
                Estando perto do captador
              </p>
              <ol className="space-y-2">
                {rescue.steps.map((step, index) => (
                  <li key={step} className="flex gap-2.5 text-sm leading-relaxed text-mist-300">
                    <span className="grid size-5 shrink-0 place-items-center rounded-full bg-white/[0.08] text-[0.7rem] font-bold text-mist-200">
                      {index + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
              <p className="text-xs leading-relaxed text-mist-500">
                A missão só conclui com a água medida pelo sensor. A estimativa serve para trazer alguém até aqui.
              </p>
            </div>
          )}
        </>
      )}
    </Surface>
  );
}
