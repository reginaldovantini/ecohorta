import type { CollectorDataSource } from "./data-source";
import type { CollectorSnapshot, DispenseCommand, DispenseProgress } from "./types";

/**
 * Fonte ESTÁTICA, usada só para revisar as telas da Fase 4.
 * Será substituída pelo dispositivo virtual (SIMULAÇÃO) na Fase 6.
 * Não executa liberações: todo comando falha como "captador sem conexão".
 */
export function createPreviewSource(): CollectorDataSource {
  const codes = ["EC-001"] as const;
  const snapshot: CollectorSnapshot = {
    info: {
      id: "preview-ec-001",
      code: "EC-001",
      name: "EcoCaptador",
      location: "Horta",
      capacityLiters: 12,
      reserveLiters: 0.5,
      valveKind: "undefined",
    },
    telemetry: {
      deviceId: "preview",
      origin: "simulation",
      status: "READY",
      distanceMm: 312,
      volumeLiters: 7.42,
      valve: "closed",
      netFlowLitersPerHour: 0.8,
      trend: "rising",
      overflowing: false,
      measuredAt: Date.now(),
    },
    totals: { capturedLiters: 18.4, reusedLiters: 9.4, discardedEstimatedLiters: 1.6 },
  };
  const progressById = new Map<string, DispenseProgress>();

  return {
    origin: "simulation",
    subscribe: () => () => {},
    getCollectorCodes: () => codes,
    getSnapshot: (code) => (code === snapshot.info.code ? snapshot : null),
    getProgress: (commandId) => progressById.get(commandId) ?? null,
    dispense(command: DispenseCommand) {
      const existing = progressById.get(command.commandId);
      if (existing) return existing;
      const now = Date.now();
      const progress: DispenseProgress = {
        commandId: command.commandId,
        status: "FAILED",
        targetLiters: command.targetLiters,
        deliveredLiters: 0,
        startVolumeLiters: null,
        endVolumeLiters: null,
        queuedAt: now,
        startedAt: null,
        finishedAt: now,
        failure: "DEVICE_OFFLINE",
        origin: "simulation",
      };
      progressById.set(command.commandId, progress);
      return progress;
    },
  };
}
