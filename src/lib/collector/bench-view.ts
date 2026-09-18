import type { SensorDiagnostics } from "@/lib/iot/api-schema";
import type { CollectorHardwareStatus, DeviceStatus, VolumeSource } from "@/lib/iot/types";
import type { CalibrationLiveVolume } from "./calibration-view";
import type { DistanceStability } from "./distance-stability";
import type { ValidationMethod, ValidationSummary } from "./validation";

/*
 * Contrato da tela de bancada (servidor → app): diagnóstico do sensor de distância,
 * observações do comportamento do sensor e validações experimentais da calibração.
 */

export const OBSERVATION_CONDITIONS = ["sem_agua", "com_agua", "alvo_flutuante", "outro"] as const;
export type ObservationCondition = (typeof OBSERVATION_CONDITIONS)[number];

export const OBSERVATION_CONDITION_LABEL: Record<ObservationCondition, string> = {
  sem_agua: "Tubo sem água",
  com_agua: "Com água",
  alvo_flutuante: "Com alvo flutuante",
  outro: "Outra condição",
};

export interface BenchReading {
  at: number;
  distanceMm: number | null;
  heightMm: number | null;
  volumeLiters: number | null;
  volumeSource: VolumeSource;
  status: DeviceStatus;
  bench: boolean;
}

export interface SensorObservationRecord {
  id: string;
  createdAt: number;
  createdBy: string | null;
  condition: ObservationCondition;
  note: string | null;
  referenceHeightMm: number | null;
  stabilityState: DistanceStability["state"];
  distanceMm: number | null;
  stdMm: number | null;
  driftMm: number | null;
  readings: number;
  outliers: number;
  invalid: number;
  total: number;
  averageIntervalMs: number | null;
  heightMm: number | null;
  volumeLiters: number | null;
  calibrationVersion: number | null;
  sensorDiagnostics: SensorDiagnostics | null;
  isSimulated: boolean;
}

export interface ValidationRecord {
  id: string;
  createdAt: number;
  createdBy: string | null;
  calibrationId: string;
  calibrationVersion: number;
  sensorModel: string;
  isSimulated: boolean;
  knownVolumeLiters: number;
  measurementMethod: ValidationMethod;
  knownMassKg: number | null;
  note: string | null;
  distanceMm: number;
  distanceStdMm: number | null;
  readings: number;
  heightMm: number;
  calculatedVolumeLiters: number;
  rawVolumeLiters: number;
  belowZero: boolean;
  aboveMaximum: boolean;
  errorLiters: number;
  absoluteErrorLiters: number;
  percentError: number | null;
  absolutePercentError: number | null;
}

export interface BenchView {
  serverTime: number;
  collector: {
    code: string;
    name: string;
    location: string;
    deviceKey: string | null;
    firmwareVersion: string | null;
    sensorModel: string | null;
    isSimulated: boolean;
    configuredCapacityLiters: number;
    nominalDiameterMm: number | null;
    nominalUsefulHeightMm: number | null;
  };
  /** Sensor configurado × reportado pelo firmware. Incompatível: sem volume e sem validação. */
  hardware: CollectorHardwareStatus;
  bench: { active: boolean; startedAt: number | null; until: number | null; startedBy: string | null };
  live: {
    online: boolean;
    measuredAt: number | null;
    deviceStatus: DeviceStatus;
    lastDistanceMm: number | null;
    stability: DistanceStability;
    diagnostics: SensorDiagnostics | null;
    volume: CalibrationLiveVolume | null;
  };
  /** Calibração ativa do captador. `appliesToDevice = false`: feita com outro dispositivo, não converte leituras. */
  calibration: {
    id: string;
    version: number;
    constantLitersPerMm: number;
    capacityLiters: number;
    effectiveDiameterMm: number;
    effectiveHeightMm: number;
    isSimulated: boolean;
    appliesToDevice: boolean;
  } | null;
  /** Leituras dos últimos minutos, da mais antiga para a mais recente. */
  readings: BenchReading[];
  observations: SensorObservationRecord[];
  validations: ValidationRecord[];
  /** Estatística descritiva das validações da calibração ativa (sem limite de aprovação). */
  validationSummary: ValidationSummary;
}
