import { availableLiters } from "@/lib/collector/water";
import type { CollectorSnapshot } from "@/lib/iot/types";
import type { MissionDefinition } from "./catalog";

export type MissionAvailability =
  | { status: "available"; freeLiters: number }
  | { status: "waiting_water"; missingLiters: number }
  | { status: "busy" }
  | { status: "device_unavailable" }
  /** Captador ainda apagado: esta pessoa nunca leu o QR dele. */
  | { status: "needs_verification" };

const EPSILON = 1e-6;

export function getMissionAvailability(
  mission: MissionDefinition,
  snapshot: CollectorSnapshot | null,
  hasActiveExecution: boolean,
): MissionAvailability {
  if (hasActiveExecution || snapshot?.telemetry.status === "DISPENSING") return { status: "busy" };
  if (!snapshot || (snapshot.telemetry.status !== "READY" && snapshot.telemetry.status !== "ONLINE")) {
    return { status: "device_unavailable" };
  }
  // Antes da primeira leitura o captador não entrega nível nem missão: a pessoa
  // precisa ter estado na frente dele ao menos uma vez. Fica DEPOIS da checagem
  // acima porque, com o captador fora do ar, caminhar até lá e ler não resolve —
  // e a mensagem útil é a que diz a verdade sobre o aparelho.
  if (snapshot.verified === false) return { status: "needs_verification" };

  const free = availableLiters(snapshot.telemetry.volumeLiters, snapshot.info.reserveLiters);
  const needed = mission.liters ?? 0;
  if (free + EPSILON < needed) return { status: "waiting_water", missingLiters: needed - free };
  return { status: "available", freeLiters: free };
}
