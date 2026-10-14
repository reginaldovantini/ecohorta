import type { DataOrigin, FailureReason } from "@/lib/iot/types";

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
  /**
   * Por que a missão não concluiu. `null` quando concluiu.
   *
   * Sem isto o estudante lê "não concluída" e fica sem saber o que houve — e o
   * que houve quase sempre tem solução: o recipiente não estava embaixo, a
   * torneira estava fechada, o tubo estava quase vazio.
   */
  failure: FailureReason | null;
  startedAt: number;
  finishedAt: number;
  origin: DataOrigin;
}
