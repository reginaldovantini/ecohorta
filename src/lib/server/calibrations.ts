import { createCalibrationService } from "./calibration-service";
import { getDatabase } from "./db/pg";

/** Serviço de calibração sobre o banco da aplicação. Sem estado em memória (serverless). */
export function getCalibrationService() {
  return createCalibrationService({ db: getDatabase() });
}
