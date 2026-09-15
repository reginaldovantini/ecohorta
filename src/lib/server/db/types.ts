/** Mínimo necessário do banco: consultas parametrizadas e transações. */
export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<{ rows: T[] }>;
}

export interface Database extends Queryable {
  /** Executa `fn` numa transação; desfaz tudo se lançar erro. */
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
}

/** Postgres devolve `numeric`/`bigint` como texto em alguns drivers: normaliza para número. */
export const num = (value: unknown): number => (value === null || value === undefined ? Number.NaN : Number(value));
export const numOrNull = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value));

/** timestamptz → epoch ms. */
export const millis = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.getTime();
  return new Date(String(value)).getTime();
};

export const isUniqueViolation = (error: unknown) =>
  typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "23505";
