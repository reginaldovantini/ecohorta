import { createBenchService } from "./bench-service";
import { getDatabase } from "./db/pg";

/** Serviço de bancada sobre o banco da aplicação. Sem estado em memória (serverless). */
export function getBenchService() {
  return createBenchService({ db: getDatabase() });
}
