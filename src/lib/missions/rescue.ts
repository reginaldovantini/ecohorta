import { fillRatio, getLevelState } from "@/lib/collector/level-state";
import { availableLiters } from "@/lib/collector/water";
import type { CollectorSnapshot } from "@/lib/iot/types";
import { RESCUE_MISSION_TEMPLATE, type MissionDefinition } from "./catalog";

/** Nível alvo após o resgate: abre espaço para a água que continua chegando. */
export const RESCUE_TARGET_RATIO = 0.7;

export interface RescuePlan {
  ratio: number;
  urgency: "attention" | "critical";
  overflowing: boolean;
  /** Litros até a boca do dreno de segurança (medidos, não estimados). */
  litersToLimit: number;
  /** Volume sugerido para liberar, em múltiplos de 0,5 L. */
  suggestedLiters: number;
}

/**
 * Missão de resgate: existe a partir da faixa de atenção (86%) ou em
 * transbordamento, com captador conectado e água liberável.
 */
export function getRescuePlan(snapshot: CollectorSnapshot): RescuePlan | null {
  const { info, telemetry } = snapshot;
  if (telemetry.status === "OFFLINE") return null;

  const ratio = fillRatio(telemetry.volumeLiters, info.capacityLiters);
  const urgency = telemetry.overflowing ? "critical" : getLevelState(ratio).urgency;
  if (urgency === "normal") return null;

  const free = availableLiters(telemetry.volumeLiters, info.reserveLiters);
  if (free < 1) return null;

  const towardTarget = telemetry.volumeLiters - RESCUE_TARGET_RATIO * info.capacityLiters;
  const suggestedLiters = Math.min(Math.floor(free * 2) / 2, Math.max(1, Math.round(towardTarget * 2) / 2));

  return {
    ratio,
    urgency,
    overflowing: telemetry.overflowing,
    litersToLimit: Math.max(0, info.capacityLiters - telemetry.volumeLiters),
    suggestedLiters,
  };
}

export function buildRescueMission(plan: RescuePlan): MissionDefinition {
  return { ...RESCUE_MISSION_TEMPLATE, liters: plan.suggestedLiters };
}
