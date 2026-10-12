import { createCollectorSetupService } from "./collector-setup-service";
import { getDatabase } from "./db/pg";

/** Jornada de construção de um captador sobre o banco da aplicação (sem estado em memória). */
export function getCollectorSetupService() {
  return createCollectorSetupService({ db: getDatabase() });
}
