import { getLevelState } from "@/lib/collector/level-state";
import { availableLiters } from "@/lib/collector/water";
import type { CollectorSnapshot } from "@/lib/iot/types";
import type { MissionDefinition } from "./catalog";
import { getRescuePlan } from "./rescue";

/*
 * DESPACHO ENTRE CAPTADORES — qual tubo o app manda a pessoa esvaziar.
 *
 * Com mais de um captador, deixar a escolha para o usuário desperdiça água: ele
 * pode ir ao tubo pela metade enquanto o outro transborda pelo dreno. Então o app
 * decide e diz por quê; o seletor passa a servir só para olhar os outros.
 *
 * A ordem é por URGÊNCIA DE PERDA, não por volume:
 *   1. transbordando  — a água está indo para o ralo AGORA
 *   2. crítico (>95%) — vai transbordar em minutos
 *   3. atenção (>85%) — dá tempo, mas é o próximo
 *   4. o resto        — mais cheio primeiro, e entre iguais o que enche mais rápido
 *
 * Empate em nível se desfaz pela vazão de entrada: entre dois tubos a 60%, o que
 * recebe condensado mais rápido chega ao dreno antes.
 *
 * Captador fora de serviço nunca é indicado: offline, em ensaio de bancada, com
 * hardware incompatível ou SEM CALIBRAÇÃO não entrega litros confiáveis
 * (docs/CALIBRACAO.md), e missão não se faz com volume desconhecido.
 */

export type DispatchUrgency = "overflowing" | "critical" | "attention" | "normal";

const URGENCY_RANK: Record<DispatchUrgency, number> = { overflowing: 3, critical: 2, attention: 1, normal: 0 };

export interface CollectorPriority {
  code: string;
  name: string;
  location: string;
  urgency: DispatchUrgency;
  /** Fração do captador ocupada (0 a 1). */
  fillRatio: number;
  /** Água acima da reserva, liberável agora. */
  freeLiters: number;
  /** Litros até a boca do dreno. Zero significa que já está transbordando. */
  litersToDrain: number;
  /** Vazão líquida de entrada (L/h). Negativa durante uma liberação. */
  inflowLitersPerHour: number;
  /** Estimativa de quanto tempo até a água começar a ir para o dreno. `null` se não está enchendo. */
  minutesToDrain: number | null;
  /** Litros que o servidor estima já terem ido para o dreno neste captador. */
  discardedEstimatedLiters: number;
  origin: CollectorSnapshot["telemetry"]["origin"];
  /** Frase curta explicando por que este é o indicado. */
  reason: string;
}

/** Um captador só entra no despacho se as leituras dele viram litros confiáveis. */
export function isDispatchable(snapshot: CollectorSnapshot): boolean {
  const { telemetry } = snapshot;
  if (snapshot.benchMode) return false;
  if (telemetry.status === "OFFLINE" || telemetry.status === "ERROR" || telemetry.status === "CALIBRATING") return false;
  if (snapshot.hardware?.compatibility === "incompatible") return false;
  // Sem calibração ativa o volume não é derivado da distância: não dá para prometer litros.
  return telemetry.volumeSource === undefined || telemetry.volumeSource === "calibration" || telemetry.volumeSource === "device";
}

function urgencyOf(snapshot: CollectorSnapshot, ratio: number): DispatchUrgency {
  if (snapshot.telemetry.overflowing) return "overflowing";
  const { urgency } = getLevelState(ratio);
  return urgency === "critical" ? "critical" : urgency === "attention" ? "attention" : "normal";
}

function minutesToDrain(litersToDrain: number, inflowLitersPerHour: number): number | null {
  if (inflowLitersPerHour <= 0) return null;
  return Math.max(0, Math.round((litersToDrain / inflowLitersPerHour) * 60));
}

function reasonFor(priority: Omit<CollectorPriority, "reason">): string {
  switch (priority.urgency) {
    case "overflowing":
      return "Transbordando: a água está indo para o dreno agora.";
    case "critical":
    case "attention": {
      const minutes = priority.minutesToDrain;
      if (minutes !== null && minutes <= 180) {
        return `A ${Math.round(priority.fillRatio * 100)}% — cerca de ${minutes} min até começar a transbordar.`;
      }
      return `A ${Math.round(priority.fillRatio * 100)}% da capacidade.`;
    }
    default:
      return priority.freeLiters > 0 ? `${priority.freeLiters.toFixed(1).replace(".", ",")} L disponíveis.` : "Sem água liberável agora.";
  }
}

/** Prioridade de um captador isolado. */
export function priorityOf(snapshot: CollectorSnapshot): CollectorPriority {
  const { info, telemetry, totals } = snapshot;
  const ratio = info.capacityLiters > 0 ? Math.min(1, Math.max(0, telemetry.volumeLiters / info.capacityLiters)) : 0;
  const litersToDrain = Math.max(0, info.capacityLiters - telemetry.volumeLiters);
  const inflow = Math.max(0, telemetry.netFlowLitersPerHour);
  const base = {
    code: info.code,
    name: info.name,
    location: info.location,
    urgency: urgencyOf(snapshot, ratio),
    fillRatio: ratio,
    freeLiters: availableLiters(telemetry.volumeLiters, info.reserveLiters),
    litersToDrain,
    inflowLitersPerHour: telemetry.netFlowLitersPerHour,
    minutesToDrain: telemetry.overflowing ? 0 : minutesToDrain(litersToDrain, inflow),
    discardedEstimatedLiters: totals.discardedEstimatedLiters,
    origin: telemetry.origin,
  };
  return { ...base, reason: reasonFor(base) };
}

/**
 * Captadores em serviço, do mais urgente para o menos.
 * O primeiro da lista é para onde o app manda a pessoa ir.
 */
export function rankCollectors(snapshots: readonly CollectorSnapshot[]): CollectorPriority[] {
  return snapshots
    .filter(isDispatchable)
    .map(priorityOf)
    .sort((a, b) => {
      const byUrgency = URGENCY_RANK[b.urgency] - URGENCY_RANK[a.urgency];
      if (byUrgency !== 0) return byUrgency;
      if (Math.abs(b.fillRatio - a.fillRatio) > 0.005) return b.fillRatio - a.fillRatio;
      // Mesmo nível: chega ao dreno antes quem recebe condensado mais rápido.
      if (b.inflowLitersPerHour !== a.inflowLitersPerHour) return b.inflowLitersPerHour - a.inflowLitersPerHour;
      return a.code.localeCompare(b.code);
    });
}

export interface MissionTarget {
  mission: MissionDefinition;
  /** Onde fazer esta missão. `null` quando nenhum captador em serviço tem água suficiente. */
  target: CollectorPriority | null;
  /** Quanto falta no captador mais cheio para a missão caber. `0` quando já cabe. */
  missingLiters: number;
}

const EPSILON = 1e-6;

/**
 * Para cada missão, o captador indicado: o mais urgente que tenha água suficiente.
 * Se nenhum tiver, devolve o mais cheio e quanto falta — a missão aparece em espera,
 * apontando o tubo certo para acompanhar.
 */
export function targetFor(mission: MissionDefinition, ranked: readonly CollectorPriority[]): MissionTarget {
  const needed = mission.liters ?? 0;
  const fits = ranked.find((item) => item.freeLiters + EPSILON >= needed);
  if (fits) return { mission, target: fits, missingLiters: 0 };
  const fullest = ranked[0] ?? null;
  return { mission, target: fullest, missingLiters: fullest ? Math.max(0, needed - fullest.freeLiters) : needed };
}

export interface RescueTarget {
  priority: CollectorPriority;
  suggestedLiters: number;
}

/**
 * Resgate: o captador que está perdendo (ou prestes a perder) água pelo dreno.
 * É a missão que o app empurra para a frente — é ela que evita o desperdício.
 */
export function rescueTarget(snapshots: readonly CollectorSnapshot[]): RescueTarget | null {
  for (const snapshot of snapshots.filter(isDispatchable).sort((a, b) => URGENCY_RANK[urgencyOf(b, ratioOf(b))] - URGENCY_RANK[urgencyOf(a, ratioOf(a))])) {
    const plan = getRescuePlan(snapshot);
    if (plan) return { priority: priorityOf(snapshot), suggestedLiters: plan.suggestedLiters };
  }
  return null;
}

function ratioOf(snapshot: CollectorSnapshot) {
  const capacity = snapshot.info.capacityLiters;
  return capacity > 0 ? Math.min(1, Math.max(0, snapshot.telemetry.volumeLiters / capacity)) : 0;
}

/** Soma de água já estimada como perdida pelo dreno, em todos os captadores. */
export function totalDiscardedLiters(snapshots: readonly CollectorSnapshot[]): number {
  return Math.round(snapshots.reduce((sum, snapshot) => sum + snapshot.totals.discardedEstimatedLiters, 0) * 100) / 100;
}
