import { createCollectorService } from "./collector-service";
import { getDatabase } from "./db/pg";
import { ConfigError } from "./errors";

/**
 * Serviço de captadores sobre o banco da aplicação. Sem estado em memória:
 * pode ser criado a cada requisição (compatível com serverless).
 */
export function getCollectorService() {
  const pepper = process.env.IOT_TOKEN_PEPPER;
  if (!pepper) throw new ConfigError("IOT_TOKEN_PEPPER não configurado.");
  return createCollectorService({ db: getDatabase(), pepper });
}
