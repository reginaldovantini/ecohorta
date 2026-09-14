/**
 * Contrato de dados entre captador físico (ESP32), backend e interface.
 *
 * Estes tipos são a fronteira que permite trocar o dispositivo virtual
 * (SIMULAÇÃO) pelo ESP32 real sem alterar as telas.
 */

export const DEVICE_STATUSES = [
  "OFFLINE",
  "ONLINE",
  "READY",
  "DISPENSING",
  "CALIBRATING",
  "ERROR",
  "MAINTENANCE",
] as const;
export type DeviceStatus = (typeof DEVICE_STATUSES)[number];

export const EXECUTION_STATUSES = [
  "AVAILABLE",
  "ACCEPTED",
  "QUEUED",
  "EXECUTING",
  "MEASURING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "EXPIRED",
] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

/** De onde vêm os dados. Tudo que não for "device" deve ser sinalizado na interface. */
export type DataOrigin = "device" | "simulation";

export type ValveState = "closed" | "open" | "unknown";

/**
 * Tipo de atuador de saída. A válvula ainda NÃO foi escolhida:
 * o captador trabalha por gravidade e exige válvula NC de acionamento
 * direto / pressão zero (ver docs/HARDWARE.md).
 */
export type ValveKind = "undefined" | "solenoid_direct_acting" | "motorized_ball" | "pump";

export type WaterTrend = "rising" | "falling" | "stable";

/** Falhas detectadas e reportadas pelo firmware. */
export const DEVICE_FAILURES = ["NO_FLOW", "TIMEOUT", "INSUFFICIENT_WATER", "SENSOR_ERROR", "DEVICE_BUSY"] as const;
export type DeviceFailure = (typeof DEVICE_FAILURES)[number];

/** Falhas possíveis de uma execução: do dispositivo, da plataforma ou da conexão do app. */
export type FailureReason = DeviceFailure | "DEVICE_OFFLINE" | "CONNECTION_ERROR";

export interface CollectorInfo {
  /** collector_id — UUID no banco; identificador estável. */
  id: string;
  /** Código impresso no QR Code, ex.: "EC-001". */
  code: string;
  name: string;
  location: string;
  capacityLiters: number;
  /** Volume que permanece no reservatório e nunca é liberado por missões. */
  reserveLiters: number;
  valveKind: ValveKind;
}

export interface CollectorTelemetry {
  deviceId: string;
  origin: DataOrigin;
  status: DeviceStatus;
  /** Distância bruta do sensor até a superfície (mm). Guardada para permitir recalibração. */
  distanceMm: number | null;
  volumeLiters: number;
  valve: ValveState;
  /** Taxa líquida estimada pelo servidor (L/h). Positiva = acumulando. */
  netFlowLitersPerHour: number;
  trend: WaterTrend;
  /** Nível no limite do dreno de segurança: água pode estar sendo descartada. */
  overflowing: boolean;
  /** epoch ms da última leitura recebida; `null` antes da primeira conexão. */
  measuredAt: number | null;
}

export interface WaterTotals {
  capturedLiters: number;
  reusedLiters: number;
  /** ESTIMADO: o sensor não mede diretamente a água que sai pelo dreno de segurança. */
  discardedEstimatedLiters: number;
}

/** Parâmetros do dispositivo virtual — só existem para captadores simulados. */
export interface SimulationSettings {
  timeScale: number;
  inflowEnabled: boolean;
  inflowLitersPerHour: number;
  faultNoFlow: boolean;
  offline: boolean;
}

export interface CollectorSnapshot {
  info: CollectorInfo;
  telemetry: CollectorTelemetry;
  totals: WaterTotals;
  simulation: SimulationSettings | null;
}

/** Comando de liberação de água. `commandId` é único: repetir o envio nunca executa duas vezes. */
export interface DispenseCommand {
  commandId: string;
  executionId: string;
  missionId: string;
  collectorCode: string;
  targetLiters: number;
}

export type DispenseStatus = Extract<
  ExecutionStatus,
  "QUEUED" | "EXECUTING" | "MEASURING" | "COMPLETED" | "FAILED" | "CANCELLED"
>;

export interface DispenseProgress {
  commandId: string;
  status: DispenseStatus;
  targetLiters: number;
  /** Volume efetivamente medido pelo sensor (não o comandado). */
  deliveredLiters: number;
  startVolumeLiters: number | null;
  endVolumeLiters: number | null;
  queuedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  failure: FailureReason | null;
  /** Cancelamento pedido e ainda não confirmado pelo dispositivo. */
  cancelRequested: boolean;
  origin: DataOrigin;
}

export type ConnectionState = "connecting" | "online" | "error";
