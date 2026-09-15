import { Pool } from "pg";
import { ConfigError } from "../errors";
import type { Database, Queryable } from "./types";

/*
 * Conexão Postgres do servidor (Supabase). Em produção use o "Transaction pooler"
 * (porta 6543), compatível com funções serverless. O pool é só um cache de
 * conexões por instância — nenhum estado de negócio fica em memória.
 */

const globalPool = globalThis as typeof globalThis & { __ecohortaPool?: Pool };

function createPool(connectionString: string) {
  const url = new URL(connectionString);
  const isLocal = ["localhost", "127.0.0.1"].includes(url.hostname);
  url.searchParams.delete("sslmode");
  return new Pool({
    connectionString: url.toString(),
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    // Conexão sempre criptografada com o Supabase.
    ssl: isLocal ? undefined : { rejectUnauthorized: false },
  });
}

export function createDatabase(pool: Pool): Database {
  return {
    query: async (sql, params) => {
      const result = await pool.query(sql, params as unknown[] | undefined);
      return { rows: result.rows };
    },
    transaction: async (fn) => {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const tx: Queryable = {
          query: async (sql, params) => ({ rows: (await client.query(sql, params as unknown[] | undefined)).rows }),
        };
        const value = await fn(tx);
        await client.query("commit");
        return value;
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

/** Banco da aplicação (DATABASE_URL). */
export function getDatabase(): Database {
  if (!globalPool.__ecohortaPool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new ConfigError("Banco de dados não configurado (DATABASE_URL).");
    globalPool.__ecohortaPool = createPool(connectionString);
  }
  return createDatabase(globalPool.__ecohortaPool);
}

/** Banco para scripts (migrations e provisionamento): conexão dedicada que precisa ser encerrada. */
export function openScriptDatabase(connectionString: string) {
  const pool = createPool(connectionString);
  return { db: createDatabase(pool), close: () => pool.end() };
}
