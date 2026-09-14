"use client";

import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, Clock, Droplets, Gauge, MapPin, Sparkles } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import type { MissionAvailability } from "@/lib/missions/availability";
import { CATEGORY_LABEL, DIFFICULTY_LABEL, type MissionDefinition } from "@/lib/missions/catalog";
import { cn } from "@/lib/utils/cn";
import { formatLiters } from "@/lib/utils/format";
import { HoldToConfirm } from "./hold-to-confirm";
import { MissionIcon } from "./mission-icon";

type Stage = "collapsed" | "details" | "confirm";

interface MissionCardProps {
  mission: MissionDefinition;
  availability: MissionAvailability;
  collectorCode: string;
  onConfirm: (mission: MissionDefinition) => void;
}

function availabilityText(availability: MissionAvailability) {
  switch (availability.status) {
    case "available":
      return { text: "Água disponível", className: "text-leaf-300", dot: "bg-leaf-400" };
    case "waiting_water":
      return {
        text: `Aguardando água · faltam ${formatLiters(availability.missingLiters)}`,
        className: "text-mist-400",
        dot: "bg-mist-500",
      };
    case "busy":
      return { text: "Outra missão está liberando água", className: "text-aqua-300", dot: "bg-aqua-400" };
    case "device_unavailable":
      return { text: "Captador indisponível", className: "text-ember-400", dot: "bg-ember-400" };
  }
}

export function MissionCard({ mission, availability, collectorCode, onConfirm }: MissionCardProps) {
  const [stage, setStage] = useState<Stage>("collapsed");
  const available = availability.status === "available";
  const expanded = stage !== "collapsed";
  const status = availabilityText(availability);
  const liters = mission.liters ?? 0;

  return (
    <motion.article
      layout
      data-testid="mission-card"
      data-mission={mission.id}
      transition={{ layout: { type: "spring", stiffness: 420, damping: 40 } }}
      className={cn(
        "relative overflow-hidden rounded-card border bg-abyss-800/85 shadow-[inset_0_1px_0_rgb(255_255_255/0.04)]",
        expanded ? "border-aqua-400/25" : "border-white/[0.07]",
      )}
    >
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute -right-20 -top-24 size-64 rounded-full",
          available
            ? "bg-[radial-gradient(closest-side,rgb(91_227_143/0.16),transparent)]"
            : "bg-[radial-gradient(closest-side,rgb(255_255_255/0.03),transparent)]",
        )}
      />

      <motion.button
        layout="position"
        type="button"
        aria-expanded={expanded}
        onClick={() => setStage(expanded ? "collapsed" : "details")}
        className="relative flex w-full items-start gap-4 p-5 text-left"
      >
        <MissionIcon icon={mission.icon} dimmed={!available} />
        <div className="min-w-0 flex-1">
          <p className="eyebrow">
            {CATEGORY_LABEL[mission.category]} · Fase {mission.phase}
          </p>
          <h3 className="mt-0.5 font-display text-lg font-semibold leading-snug text-mist-50">{mission.title}</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {mission.liters !== null && (
              <Chip tone="aqua" icon={<Droplets />}>
                {formatLiters(liters, 1)}
              </Chip>
            )}
            <Chip tone="sun" icon={<Sparkles />}>
              +{mission.xp} XP
            </Chip>
          </div>
          <p className={cn("mt-3 flex items-center gap-2 text-xs font-medium", status.className)}>
            <span className={cn("size-1.5 rounded-full", status.dot)} aria-hidden />
            {status.text}
          </p>
        </div>
        <motion.span animate={{ rotate: expanded ? 180 : 0 }} className="mt-1 text-mist-400" aria-hidden>
          <ChevronDown className="size-5" />
        </motion.span>
      </motion.button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="body"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="relative overflow-hidden"
          >
            <div className="space-y-5 px-5 pb-5">
              <p className="text-[0.95rem] leading-relaxed text-mist-300">{mission.summary}</p>

              <dl className="grid grid-cols-3 gap-2 text-center">
                {[
                  { icon: Gauge, label: "Dificuldade", value: DIFFICULTY_LABEL[mission.difficulty] },
                  { icon: Clock, label: "Tempo", value: `${mission.durationMinutes} min` },
                  { icon: MapPin, label: "Local", value: mission.location },
                ].map(({ icon: Icon, label, value }) => (
                  <div key={label} className="rounded-2xl bg-white/[0.04] px-2 py-3">
                    <Icon className="mx-auto size-4 text-mist-400" aria-hidden />
                    <dt className="sr-only">{label}</dt>
                    <dd className="mt-1.5 text-xs font-semibold leading-tight text-mist-100">{value}</dd>
                  </div>
                ))}
              </dl>

              <AnimatePresence mode="wait" initial={false}>
                {stage === "confirm" ? (
                  <motion.div
                    key="confirm"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="space-y-3 rounded-2xl border border-aqua-400/25 bg-aqua-500/10 p-4"
                  >
                    <p className="font-display font-semibold text-mist-50">Confirme a liberação</p>
                    <p className="text-sm leading-relaxed text-mist-300">
                      O captador <strong className="text-mist-50">{collectorCode}</strong> vai liberar{" "}
                      <strong className="text-aqua-300">{formatLiters(liters, 1)}</strong>. Posicione o regador na saída
                      antes de confirmar.
                    </p>
                    <HoldToConfirm
                      label={`Segure para liberar ${formatLiters(liters, 1)}`}
                      holdingLabel="Continue segurando…"
                      icon={<Droplets className="size-5" />}
                      disabled={!available}
                      onConfirm={() => {
                        setStage("collapsed");
                        onConfirm(mission);
                      }}
                    />
                    <Button variant="ghost" size="sm" className="w-full" onClick={() => setStage("details")}>
                      Voltar
                    </Button>
                  </motion.div>
                ) : (
                  <motion.div
                    key="details"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="space-y-5"
                  >
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
                    <Button
                      size="lg"
                      className="w-full"
                      disabled={!available}
                      icon={<Droplets className="size-5" />}
                      onClick={() => setStage("confirm")}
                    >
                      {available ? "Aceitar missão" : status.text}
                    </Button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.article>
  );
}
