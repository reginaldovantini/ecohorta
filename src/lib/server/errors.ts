/** Falta de configuração do ambiente (variáveis, serviços). A API responde 503. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export type ServiceResult<T> = { ok: true; value: T } | { ok: false; status: number; message: string };

export const fail = (status: number, message: string): { ok: false; status: number; message: string } => ({
  ok: false,
  status,
  message,
});
