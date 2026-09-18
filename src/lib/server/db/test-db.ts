import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { DEFAULT_SIMULATION_SETTINGS } from "@/lib/iot/simulation-config";
import type { Database, Queryable } from "./types";

/*
 * SOMENTE PARA TESTES: PostgreSQL real (PGlite) com as mesmas migrations do Supabase.
 * O "stub" abaixo reproduz o que o Supabase já oferece antes das migrations:
 * papéis anon/authenticated/service_role, esquema auth e privilégios padrão.
 */

const SUPABASE_STUB = `
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create schema auth;
create table auth.users (id uuid primary key, email text unique);
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;

export const TEST_PEPPER = "pepper-de-teste";
export const TEST_DEVICE_TOKEN = "token-de-teste-com-tamanho-suficiente";

const wrap = (target: PGlite | Transaction): Queryable => ({
  query: async (sql, params) => ({ rows: (await target.query(sql, params as unknown[] | undefined)).rows as never[] }),
});

export async function createTestDatabase() {
  const pg = new PGlite();
  await pg.exec(SUPABASE_STUB);
  const dir = path.join(process.cwd(), "supabase", "migrations");
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".sql")).sort()) {
    await pg.exec(readFileSync(path.join(dir, file), "utf8"));
  }
  const db: Database = {
    ...wrap(pg),
    transaction: (fn) => pg.transaction((tx) => fn(wrap(tx))),
  };
  return { pg, db };
}

/** Limpa todos os dados e recria o cenário padrão (mais rápido que recriar o banco). */
export async function resetTestDatabase(db: Queryable) {
  await db.query(
    `truncate table public.xp_transactions, public.mission_executions, public.device_commands, public.telemetry,
     public.calibration_validations, public.sensor_observations, public.collector_hardware_changes,
     public.collector_state, public.collector_calibrations, public.devices, public.collectors, public.guardian_consents, public.person_records,
     public.profiles, public.school_classes, public.schools, auth.users restart identity cascade`,
  );
  await seedTestSchool(db);
}

/** Executa como um usuário autenticado do Supabase (JWT simulado) — para testar RLS. */
export function asUser<T>(pg: PGlite, userId: string | null, fn: (q: Queryable) => Promise<T>) {
  return pg.transaction(async (tx) => {
    if (userId) {
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated" })]);
      await tx.query("set local role authenticated");
    } else {
      await tx.query("set local role anon");
    }
    return fn(wrap(tx));
  });
}

export const hashDeviceToken = (token: string, pepper = TEST_PEPPER) =>
  createHash("sha256").update(`${pepper}:${token}`).digest("hex");

export const IDS = {
  school: "10000000-0000-4000-8000-000000000001",
  otherSchool: "10000000-0000-4000-8000-000000000002",
  class6c: "20000000-0000-4000-8000-000000000001",
  otherClass: "20000000-0000-4000-8000-000000000002",
  student: "30000000-0000-4000-8000-000000000001",
  student2: "30000000-0000-4000-8000-000000000002",
  teacher: "30000000-0000-4000-8000-000000000003",
  staff: "30000000-0000-4000-8000-000000000004",
  otherStudent: "30000000-0000-4000-8000-000000000005",
  collector: "40000000-0000-4000-8000-000000000001",
  otherCollector: "40000000-0000-4000-8000-000000000002",
  device: "50000000-0000-4000-8000-000000000001",
  otherDevice: "50000000-0000-4000-8000-000000000002",
} as const;

/** Escola, turma, estudantes, professor, funcionário, outra escola e o captador EC-001 simulado. */
export async function seedTestSchool(db: Queryable) {
  const users = [IDS.student, IDS.student2, IDS.teacher, IDS.staff, IDS.otherStudent];
  for (const id of users) await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `${id}@teste.invalid`]);

  await db.query("insert into schools (id, name) values ($1, 'Escola de Teste'), ($2, 'Outra Escola')", [IDS.school, IDS.otherSchool]);
  await db.query(
    `insert into school_classes (id, school_id, name, education_level, grade, section, school_year)
     values ($1, $2, '6º Ano C', 'elementary', 6, 'C', 2026), ($3, $4, '7º Ano A', 'elementary', 7, 'A', 2026)`,
    [IDS.class6c, IDS.school, IDS.otherClass, IDS.otherSchool],
  );
  await db.query(
    `insert into profiles (id, school_id, role, nickname, avatar_id, class_id, access_code, job_title, staff_sector, onboarded_at) values
     ($1, $6, 'student', 'Jhow', 'broto', $7, '6C-AAAA', null, null, now()),
     ($2, $6, 'student', 'Ana', 'gota', $7, '6C-BBBB', null, null, now()),
     ($3, $6, 'teacher', 'Prof. Rê', 'cientista', null, null, 'Professor de Ciências', null, now()),
     ($4, $6, 'staff', 'Lia', 'sensor', null, null, 'Técnica', 'laboratorio', now()),
     ($5, $8, 'student', 'Outro', 'flor', $9, '7A-CCCC', null, null, now())`,
    [IDS.student, IDS.student2, IDS.teacher, IDS.staff, IDS.otherStudent, IDS.school, IDS.class6c, IDS.otherSchool, IDS.otherClass],
  );
  await db.query(
    `insert into person_records (profile_id, first_name, last_name, birth_date) values
     ($1, 'João', 'Silva', '2012-04-15'), ($2, 'Ana', 'Souza', '2013-01-10'),
     ($3, 'Regina', 'Lima', null), ($4, 'Lia', 'Costa', null), ($5, 'Outro', 'Aluno', '2011-07-01')`,
    [IDS.student, IDS.student2, IDS.teacher, IDS.staff, IDS.otherStudent],
  );
  await db.query(
    `insert into collectors (id, school_id, code, name, location, capacity_liters, reserve_liters, nominal_diameter_mm, nominal_useful_height_mm) values
     ($1, $2, 'EC-001', 'EcoCaptador', 'Horta', 12, 0.5, 100, 1500), ($3, $4, 'EC-900', 'Captador Externo', 'Pátio', 12, 0.5, null, null)`,
    [IDS.collector, IDS.school, IDS.otherCollector, IDS.otherSchool],
  );
  await db.query(
    `insert into devices (id, collector_id, device_key, is_simulated, token_hash) values
     ($1, $2, 'VIRTUAL-001', true, $3), ($4, $5, 'ESP32-900', false, $6)`,
    [IDS.device, IDS.collector, hashDeviceToken(TEST_DEVICE_TOKEN), IDS.otherDevice, IDS.otherCollector, hashDeviceToken("outro-token")],
  );
  await db.query(
    `insert into collector_state (collector_id, device_id, simulation) values ($1, $2, $3), ($4, $5, null)`,
    [
      IDS.collector,
      IDS.device,
      JSON.stringify({ settings: DEFAULT_SIMULATION_SETTINGS, pendingAction: null, nextActionId: 1 }),
      IDS.otherCollector,
      IDS.otherDevice,
    ],
  );
}
