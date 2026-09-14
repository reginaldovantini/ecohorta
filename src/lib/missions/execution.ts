import type { DispenseProgress, FailureReason } from "@/lib/iot/types";
import type { MissionDefinition } from "./catalog";

export type TerminalProgress = DispenseProgress & { status: "COMPLETED" | "FAILED" };

export function isTerminal(progress: DispenseProgress | null): progress is TerminalProgress {
  return progress?.status === "COMPLETED" || progress?.status === "FAILED";
}

/** XP só é concedido quando o sensor confirma a conclusão da liberação. */
export function xpForExecution(mission: MissionDefinition, progress: DispenseProgress) {
  return progress.status === "COMPLETED" ? mission.xp : 0;
}

export const FAILURE_COPY: Record<FailureReason, { title: string; message: string }> = {
  NO_FLOW: {
    title: "A água não saiu",
    message:
      "A válvula abriu, mas o sensor não detectou queda de nível. Ela foi fechada por segurança. Avise o professor responsável.",
  },
  TIMEOUT: {
    title: "Tempo máximo atingido",
    message: "A válvula foi fechada automaticamente antes de completar o volume.",
  },
  INSUFFICIENT_WATER: {
    title: "Água insuficiente",
    message: "O volume disponível mudou antes da liberação. Nenhuma água foi liberada.",
  },
  DEVICE_OFFLINE: {
    title: "Captador sem conexão",
    message: "O comando não chegou ao captador. Nenhuma água foi liberada.",
  },
  DEVICE_BUSY: {
    title: "Captador ocupado",
    message: "Outra missão está liberando água agora. Tente novamente em instantes.",
  },
  SENSOR_ERROR: {
    title: "Falha no sensor",
    message: "Sem uma medição confiável, a válvula foi fechada por segurança.",
  },
  CANCELLED_BY_USER: {
    title: "Missão cancelada",
    message: "A válvula foi fechada.",
  },
};
