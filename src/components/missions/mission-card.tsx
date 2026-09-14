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
import { MissionArt } from "./mission-art";

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
  const rescue = mission.category === "rescue";
  const status = availabilityText(availability);
  const liters = mission.liters ?? 0;
  const toggle = () => setStage(expanded ? "collapsed" : "details");

  return (
    <motion.article
      layout
      data-testid="mission-card"
      data-mission={mission.id}
      transition={{ layout: { type: "spring", stiffness: 420, damping: 40 } }}
      className={cn(
        "relative overflow-hidden rounded-card border bg-abyss-800/85 shadow-[inset_0_1px_0_rgb(255_255_255/0.04)]",
        rescue ? "border-alert-400/40" : expanded ? "border-leaf-400/30" : "border-white/[0.07]",
      )}
    >
      <motion.div layout="position" className="flex gap-4 p-4">
        <button type="button" onClick={toggle} aria-label={`Detalhes: ${mission.title}`} className="shrink-0 rounded-2xl active:scale-95 transition-transform">
          <MissionArt art={mission.art} dimmed={!available} className="size-[5.5rem]" />
        </button>
        <div className="min-w-0 flex-1">
          <button type="button" onClick={toggle} aria-expanded={expanded} className="flex w-full items-start gap-2 text-left">
            <span className="min-w-0 flex-1">
              <span className={cn("eyebrow block", rescue && "text-alert-400")}>
                {CATEGORY_LABEL[mission.category]} · Fase {mission.phase}
              </span>
              <span className="mt-0.5 block font-display text-[1.05rem] font-semibold leading-snug text-mist-50">
                {mission.title}
              </span>
            </span>
            <motion.span animate={{ rotate: expanded ? 180 : 0 }} className="mt-0.5 text-mist-400" aria-hidden>
              <ChevronDown className="size-5" />
            </motion.span>
          </button>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {mission.liters !== null && (
              <Chip tone="aqua" icon={<Droplets />}>
                {formatLiters(liters, 1)}
              </Chip>
            )}
            <Chip tone="sun" icon={<Sparkles />}>
              +{mission.xp} XP
            </Chip>
          </div>
          <p className={cn("mt-2 flex items-center gap-2 text-xs font-medium", status.className)}>
            <span className={cn("size-1.5 shrink-0 rounded-full", status.dot)} aria-hidden />
            <span className="truncate">{status.text}</span>
          </p>
        </div>
      </motion.div>

      {!expanded && available && (
        <motion.div layout="position" className="px-4 pb-4">
          <Button
            variant={rescue ? "alert" : "leaf"}
            className="w-full"
            onClick={() => setStage("confirm")}
            data-testid="accept-mission"
          >
            {rescue ? "Resgatar agora" : "Aceitar missão"}
          </Button>
        </motion.div>
      )}

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
            <div className="space-y-5 px-4 pb-4">
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

              <AnimatePresence mode="wait" initial={false}>
                {stage === "confirm" ? (
                  <motion.div
                    key="confirm"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className={cn(
                      "space-y-3 rounded-2xl border p-4",
                      rescue ? "border-alert-400/30 bg-alert-500/10" : "border-leaf-400/25 bg-leaf-500/10",
                    )}
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
                  <motion.div key="details" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
                    <Button
                      size="lg"
                      variant={rescue ? "alert" : "leaf"}
                      className="w-full"
                      disabled={!available}
                      icon={<Droplets className="size-5" />}
                      onClick={() => setStage("confirm")}
                    >
                      {available ? (rescue ? "Resgatar agora" : "Aceitar missão") : status.text}
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
