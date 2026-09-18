import type { DeviceStatus } from "@/lib/iot/types";
import type { DistanceSensorModel, SensorCompatibility, SensorState } from "./distance-sensors";

/*
 * Contrato da tela Ligações (servidor → app): configuração de hardware do captador,
 * o que o firmware informa estar usando e o histórico de trocas do sensor.
 */

export interface HardwareChangeRecord {
  id: string;
  /** Revisão criada por esta troca. */
  revision: number;
  previousSensor: DistanceSensorModel;
  newSensor: DistanceSensorModel;
  changedAt: number;
  /** Apelido de quem trocou (nunca o nome cadastral). */
  changedBy: string | null;
  note: string | null;
  /** Versão da calibração ativa que deixou de valer com a troca. */
  supersededCalibrationVersion: number | null;
  /** A troca cancelou uma calibração em andamento. */
  cancelledCalibration: boolean;
  isSimulated: boolean;
}

export interface HardwareView {
  serverTime: number;
  collector: {
    code: string;
    name: string;
    location: string;
    deviceKey: string | null;
    firmwareVersion: string | null;
    isSimulated: boolean;
  };
  /** Configuração definida na plataforma (fonte da configuração do firmware). */
  configuration: {
    distanceSensor: DistanceSensorModel;
    revision: number;
    updatedAt: number | null;
    updatedBy: string | null;
  };
  /** O que o firmware informou na última leitura. */
  device: {
    online: boolean;
    measuredAt: number | null;
    status: DeviceStatus;
    reportedSensor: string | null;
    reportedRevision: number | null;
    sensorState: SensorState | null;
    modelId: string | null;
    i2cAck: boolean | null;
    i2cClockHz: number | null;
    lastDistanceMm: number | null;
  };
  compatibility: { state: SensorCompatibility; message: string };
  /** Calibração ativa e se ela vale para a configuração atual. */
  calibration: { version: number; sensorModel: string; hardwareRevision: number; applies: boolean } | null;
  benchActive: boolean;
  /** Liberação em andamento: a troca do sensor espera terminar. */
  dispenseActive: boolean;
  history: HardwareChangeRecord[];
}
