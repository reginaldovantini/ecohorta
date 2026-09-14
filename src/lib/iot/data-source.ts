import type {
  CollectorSnapshot,
  DataOrigin,
  DispenseCommand,
  DispenseProgress,
} from "./types";

/**
 * Fonte de dados de captadores. Implementações:
 * - dispositivo virtual (SIMULAÇÃO) — disponível agora;
 * - Supabase Realtime alimentado pelo ESP32 — Dias 6–9.
 *
 * A interface é compatível com `useSyncExternalStore`: `subscribe` avisa
 * mudanças e os getters retornam objetos imutáveis (nova referência a cada mudança).
 */
export interface CollectorDataSource {
  readonly origin: DataOrigin;
  subscribe(listener: () => void): () => void;
  getSnapshot(collectorCode: string): CollectorSnapshot | null;
  getProgress(commandId: string): DispenseProgress | null;
  /** Idempotente por `commandId`: reenviar o mesmo comando retorna o progresso existente. */
  dispense(command: DispenseCommand): DispenseProgress;
}
