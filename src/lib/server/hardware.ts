import { getDatabase } from "./db/pg";
import { createHardwareService } from "./hardware-service";

/** Serviço de configuração de hardware sobre o banco da aplicação. Sem estado em memória (serverless). */
export function getHardwareService() {
  return createHardwareService({ db: getDatabase() });
}
