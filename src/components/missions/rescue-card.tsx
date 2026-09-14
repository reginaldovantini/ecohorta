"use client";

import { motion } from "motion/react";
import { Droplets, Siren, Sparkles, TriangleAlert } from "lucide-react";
import { useCallback, useState } from "react";
import { CollectorTank, tankPropsFromSnapshot } from "@/components/collector/collector-tank";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Surface } from "@/components/ui/surface";
import type { CollectorSnapshot } from "@/lib/iot/types";
import { getMissionAvailability } from "@/lib/missions/availability";
import { buildRescueMission, type RescuePlan } from "@/lib/missions/rescue";
import { formatLiters, formatPercent } from "@/lib/utils/format";
import { HoldToConfirm } from "./hold-to-confirm";
import { useMissionRunner } from "./mission-runner";

/**
 * MISSÃO DE RESGATE: o nível perto do dreno vira uma situação de jogo.
 * Os litros até o limite são medidos; o descarte, quando houver, é sempre estimado.
 */
export function RescueCard({ snapshot, plan }: { snapshot: CollectorSnapshot; plan: RescuePlan }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const { start, isRunning } = useMissionRunner();
  const mission = buildRescueMission(plan);
  const available = getMissionAvailability(mission, snapshot, isRunning).status === "available";
  const code = snapshot.info.code;

  return (
    <>
      <motion.div initial={{ opacity: 0, y: 10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: "spring", stiffness: 320, damping: 28 }}>
        <Surface tone={plan.urgency === "critical" ? "alert" : "ember"} role="alert" className="relative overflow-hidden p-5" data-testid="rescue-card">
          <div className="flex gap-4">
            <div className="-my-1 h-32 shrink-0">
              <CollectorTank {...tankPropsFromSnapshot(snapshot)} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="eyebrow flex items-center gap-1.5 text-alert-400">
                <Siren className="size-3.5 animate-pulse" aria-hidden /> Missão de resgate
              </p>
              <p className="mt-1 font-display text-xl font-bold leading-tight text-mist-50">
                {plan.overflowing ? "Água indo para o dreno!" : `O captador está com ${formatPercent(plan.ratio)}!`}
              </p>
              <p className="mt-1.5 text-sm leading-relaxed text-mist-300">
                {plan.overflowing ? (
                  "O limite foi atingido: a água que chega agora segue para o dreno de segurança."
                ) : (
                  <>
                    <strong className="text-mist-50">{formatLiters(plan.litersToLimit)}</strong> até o limite do dreno de segurança.
                  </>
                )}
              </p>
            </div>
          </div>
          <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-mist-400">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-ember-400" aria-hidden />
            Se o nível continuar subindo, a água será descartada pelo dreno.
          </p>
          <Button
            variant="alert"
            size="lg"
            className="mt-4 w-full"
            disabled={!available}
            icon={<Droplets className="size-5" />}
            onClick={() => setOpen(true)}
          >
            {available ? `Resgatar ${formatLiters(plan.suggestedLiters, 1)} agora` : "Aguarde a liberação em andamento"}
          </Button>
        </Surface>
      </motion.div>

      <BottomSheet
        open={open}
        onClose={close}
        title="Missão de resgate"
        description={`Liberar ${formatLiters(plan.suggestedLiters, 1)} do captador ${code} abre espaço para a água que continua chegando.`}
      >
        <div className="space-y-5">
          <div className="flex gap-2">
            <Chip tone="aqua" icon={<Droplets />}>
              {formatLiters(plan.suggestedLiters, 1)}
            </Chip>
            <Chip tone="sun" icon={<Sparkles />}>
              +{mission.xp} XP
            </Chip>
          </div>
          <ol className="space-y-2.5">
            {mission.steps.map((step, index) => (
              <li key={step} className="flex gap-3 text-sm text-mist-300">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-white/[0.06] font-display text-xs font-semibold text-mist-100">
                  {index + 1}
                </span>
                <span className="pt-0.5">{step}</span>
              </li>
            ))}
          </ol>
          <HoldToConfirm
            label={`Segure para liberar ${formatLiters(plan.suggestedLiters, 1)}`}
            holdingLabel="Continue segurando…"
            icon={<Droplets className="size-5" />}
            disabled={!available}
            onConfirm={() => {
              close();
              start(mission, code);
            }}
          />
        </div>
      </BottomSheet>
    </>
  );
}
