import type {
  CollectorSnapshot,
  ConnectionState,
  DispenseCommand,
  DispenseProgress,
  SimulationSettings,
} from "./types";

export type SimulationAction = { type: "set_level"; ratio: number } | { type: "reset" };

export interface SimulationRequest {
  settings?: Partial<SimulationSettings>;
  action?: SimulationAction;
}

/**
 * Fonte de dados de captadores usada pelas telas. A implementação atual
 * (`api-source`) conversa apenas com a API da plataforma — nunca com o
 * dispositivo. O captador pode ser o ESP32 real ou o dispositivo virtual.
 *
 * Compatível com `useSyncExternalStore`: `subscribe` avisa mudanças e os
 * getters retornam objetos imutáveis (nova referência a cada mudança).
 */
export interface CollectorDataSource {
  subscribe(listener: () => void): () => void;
  getConnectionState(): ConnectionState;
  /** Códigos dos captadores disponíveis (referência estável enquanto a lista não mudar). */
  getCollectorCodes(): readonly string[];
  getSnapshot(collectorCode: string): CollectorSnapshot | null;
  getProgress(commandId: string): DispenseProgress | null;
  /** Envia uma liberação. Idempotente por `commandId`; o andamento aparece em `getProgress`. */
  dispense(command: DispenseCommand): void;
  /** Pede o fechamento da válvula. A água já liberada continua sendo medida. */
  cancel(commandId: string): void;
  /** Controla o dispositivo virtual. A API recusa para captadores reais. */
  updateSimulation(collectorCode: string, request: SimulationRequest): Promise<{ ok: boolean; message?: string }>;
}
