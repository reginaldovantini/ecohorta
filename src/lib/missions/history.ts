import type { DataOrigin } from "@/lib/iot/types";

/** Uma missão finalizada do participante, como o servidor registra. */
export interface ExecutionRecord {
  executionId: string;
  missionId: string;
  commandId: string;
  collectorCode: string;
  status: "COMPLETED" | "FAILED" | "CANCELLED";
  targetLiters: number;
  deliveredLiters: number;
  xpAwarded: number;
  startedAt: number;
  finishedAt: number;
  origin: DataOrigin;
}
