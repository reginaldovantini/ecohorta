import type { CollectorHardwareStatus } from "@/lib/iot/types";
import type { DistanceStability } from "./distance-stability";
import type { LevelStateId } from "./level-state";
import type { CalibrationDistances, CalibrationFit, CalibrationQuality, CalibrationStepId } from "./volume-calibration";

/*
 * Contrato da tela de calibração (servidor → app). Tudo é calculado no servidor:
 * o app nunca envia distâncias nem volumes, só "registrar a leitura estável desta etapa".
 */

export type CalibrationStatus = "draft" | "active" | "superseded" | "rejected" | "cancelled";

export const CALIBRATION_STATUS_LABEL: Record<CalibrationStatus, string> = {
  draft: "Em andamento",
  active: "Ativa",
  superseded: "Substituída",
  rejected: "Inconsistente",
  cancelled: "Cancelada",
};

export interface CalibrationPointDetail {
  distanceMm: number;
  stdMm: number | null;
  readings: number;
  recordedAt: number;
}

export interface CalibrationRecord {
  id: string;
  version: number | null;
  status: CalibrationStatus;
  quality: CalibrationQuality | null;
  /** Sensor configurado quando a calibração foi feita. */
  sensorModel: string;
  /** Revisão da configuração de hardware com que foi feita: só vale nessa mesma revisão. */
  hardwareRevision: number;
  isSimulated: boolean;
  createdAt: number;
  completedAt: number | null;
  activatedAt: number | null;
  supersededAt: number | null;
  /** Apelido de quem calibrou (nunca o nome cadastral). */
  createdBy: string | null;
  distances: { [K in keyof CalibrationDistances]: number | null };
  points: Partial<Record<CalibrationStepId, CalibrationPointDetail>>;
  constantLitersPerMm: number | null;
  effectiveDiameterMm: number | null;
  effectiveHeightMm: number | null;
  effectiveCapacityLiters: number | null;
  rSquared: number | null;
  maxResidualLiters: number | null;
  nominalDiameterMm: number | null;
  nominalUsefulHeightMm: number | null;
  report: CalibrationFit | null;
}

export interface CalibrationLiveVolume {
  liters: number;
  fillRatio: number;
  heightMm: number;
  levelState: LevelStateId;
  belowZero: boolean;
  aboveMaximum: boolean;
}

export interface CalibrationView {
  serverTime: number;
  collector: {
    code: string;
    name: string;
    location: string;
    configuredCapacityLiters: number;
    nominalDiameterMm: number | null;
    nominalUsefulHeightMm: number | null;
    deviceKey: string | null;
    isSimulated: boolean;
    sensorModel: string | null;
    /** Ensaio de bancada em andamento (a calibração inicia um). */
    benchActive: boolean;
  };
  /** Sensor configurado × reportado pelo firmware. Incompatível: a calibração não pode ser feita. */
  hardware: CollectorHardwareStatus;
  live: {
    online: boolean;
    lastDistanceMm: number | null;
    measuredAt: number | null;
    stability: DistanceStability;
    /** Volume pela calibração ativa, a partir da distância estabilizada (ou da última leitura). */
    volume: CalibrationLiveVolume | null;
  };
  active: CalibrationRecord | null;
  /** A calibração ativa foi feita com o dispositivo e a configuração de hardware atuais? Se não, o volume não é calculado. */
  activeAppliesToDevice: boolean;
  draft: (CalibrationRecord & { nextStep: CalibrationStepId | null; preview: CalibrationFit | null }) | null;
  /** Calibrações concluídas (ativa, substituídas e inconsistentes), da mais recente para a mais antiga. */
  history: CalibrationRecord[];
}

export interface CalibrationCompletion {
  status: "active" | "rejected";
  version: number;
  fit: CalibrationFit;
  view: CalibrationView;
}
