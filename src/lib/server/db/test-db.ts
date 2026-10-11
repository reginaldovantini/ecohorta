import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { DEFAULT_SIMULATION_SETTINGS } from "@/lib/iot/simulation-config";
import type { Actor } from "../actor";
import { ensureDevice } from "../provisioning";
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
    `truncate table public.mission_post_reports, public.mission_post_likes, public.mission_posts,
     public.xp_transactions, public.mission_executions, public.device_commands, public.telemetry,
     public.calibration_validations, public.sensor_observations, public.collector_hardware_changes,
     public.collector_scans, public.collector_stewards, public.school_members,
     public.collector_state, public.collector_calibrations, public.devices, public.collectors,
     public.guardian_consents, public.person_records, public.profiles, public.schools, auth.users
     restart identity cascade`,
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

/**
 * Cenário padrão: duas escolas, pessoas já com o primeiro acesso concluído e o
 * captador EC-001 (SIMULAÇÃO) na primeira escola.
 *
 * `teacher` é PROFESSOR DECLARADO e responsável pelo EC-001 — é a segunda coisa,
 * e não a primeira, que lhe dá calibração e bancada. `staff` declarou funcionário
 * e não é responsável por captador nenhum: serve para provar que função declarada
 * não abre porta.
 */
export async function seedTestSchool(db: Queryable) {
  const users = [IDS.student, IDS.student2, IDS.teacher, IDS.staff, IDS.otherStudent];
  for (const id of users) await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `${id}@teste.invalid`]);

  await db.query("insert into schools (id, name) values ($1, 'Escola de Teste'), ($2, 'Outra Escola')", [IDS.school, IDS.otherSchool]);
  await db.query(
    `insert into profiles (id, school_id, role, nickname, avatar_id, grade_phase, job_title, staff_sector, onboarded_at) values
     ($1, $6, 'student', 'Jhow', 'broto', 'ano_9', null, null, now()),
     ($2, $6, 'student', 'Ana', 'gota', 'ano_1', null, null, now()),
     ($3, $6, 'teacher', 'Prof. Rê', 'cientista', null, 'Professor de Ciências', null, now()),
     ($4, $6, 'staff', 'Lia', 'sensor', null, 'Técnica', 'laboratorio', now()),
     ($5, $7, 'student', 'Outro', 'flor', 'ano_2', null, null, now())`,
    [IDS.student, IDS.student2, IDS.teacher, IDS.staff, IDS.otherStudent, IDS.school, IDS.otherSchool],
  );
  await db.query(
    `insert into person_records (profile_id, first_name, sex, birth_date) values
     ($1, 'João', 'masculino', '2010-04-15'), ($2, 'Ana', 'feminino', '2009-01-10'),
     ($3, 'Regina', 'feminino', null), ($4, 'Lia', 'feminino', null), ($5, 'Outro', 'masculino', '2008-07-01')`,
    [IDS.student, IDS.student2, IDS.teacher, IDS.staff, IDS.otherStudent],
  );
  await db.query(
    `insert into collectors (id, school_id, seq, code, name, location, capacity_liters, reserve_liters,
       nominal_diameter_mm, nominal_useful_height_mm, qr_token) values
     ($1, $2, 1, 'EC-001', 'EcoCaptador', 'Horta', 12, 0.5, 100, 1500, $5),
     ($3, $4, 1, 'EC-900', 'Captador Externo', 'Pátio', 12, 0.5, null, null, $6)`,
    [IDS.collector, IDS.school, IDS.otherCollector, IDS.otherSchool, "a".repeat(32), "b".repeat(32)],
  );
  // Pertencer à escola é o que dá visibilidade; é o que a leitura do QR cria.
  await db.query(
    `insert into school_members (profile_id, school_id) values ($1, $6), ($2, $6), ($3, $6), ($4, $6), ($5, $7)`,
    [IDS.student, IDS.student2, IDS.teacher, IDS.staff, IDS.otherStudent, IDS.school, IDS.otherSchool],
  );
  // O poder de calibrar vem daqui, não do papel declarado no cadastro.
  await db.query("insert into collector_stewards (collector_id, profile_id) values ($1, $2)", [IDS.collector, IDS.teacher]);
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

/**
 * Atores do cenário padrão. Montar `Actor` na mão em cada teste espalhava a regra
 * de quem pode o quê; aqui ela fica em um lugar só e acompanha o `seedTestSchool`.
 */
export const ACTORS = {
  /** Estudante comum. */
  student: { profileId: IDS.student, schoolId: IDS.school, role: "student", platformAdmin: false, stewardOf: [] },
  student2: { profileId: IDS.student2, schoolId: IDS.school, role: "student", platformAdmin: false, stewardOf: [] },
  /** Professor declarado E responsável pelo EC-001: calibra e usa a bancada. */
  teacher: { profileId: IDS.teacher, schoolId: IDS.school, role: "teacher", platformAdmin: false, stewardOf: [IDS.collector] },
  /** Funcionário declarado, sem responsabilidade: a função sozinha não abre porta. */
  staff: { profileId: IDS.staff, schoolId: IDS.school, role: "staff", platformAdmin: false, stewardOf: [] },
  /** Estudante da outra escola. */
  otherStudent: { profileId: IDS.otherStudent, schoolId: IDS.otherSchool, role: "student", platformAdmin: false, stewardOf: [] },
  /** Professor declarado na outra escola, responsável pelo captador de lá. */
  otherSchoolTeacher: { profileId: IDS.otherStudent, schoolId: IDS.otherSchool, role: "teacher", platformAdmin: false, stewardOf: [IDS.otherCollector] },
} as const satisfies Record<string, Actor>;

/**
 * Cenário físico da Fase 3 sobre o cenário padrão: o EC-001 passa a ser o captador
 * REAL (ESP32-001) e o SIM-001 nasce como o captador da SIMULAÇÃO (VIRTUAL-001).
 *
 * Os dois códigos são escritos direto, e não pela sequência: aqui eles são a
 * identidade que os testes usam, não um cadastro sendo exercitado.
 */
export async function seedPhysicalScenario(db: Database, esp32Token: string) {
  const sim = await db.query<{ id: string }>(
    `insert into public.collectors (school_id, seq, code, name, location, capacity_liters, reserve_liters,
       nominal_diameter_mm, nominal_useful_height_mm, qr_token)
     values ($1, 2, 'SIM-001', 'Captador virtual', 'Simulação', 12, 0.5, 100, 1500, $2)
     on conflict (school_id, code) do update set name = excluded.name
     returning id`,
    [IDS.school, "c".repeat(32)],
  );
  const simId = sim.rows[0]!.id;
  // VIRTUAL-001 larga o EC-001 e assume o SIM-001; o EC-001 recebe o ESP32.
  await ensureDevice(db, { collectorId: simId, deviceKey: "VIRTUAL-001", isSimulated: true, token: TEST_DEVICE_TOKEN, pepper: TEST_PEPPER });
  await ensureDevice(db, { collectorId: IDS.collector, deviceKey: "ESP32-001", isSimulated: false, token: esp32Token, pepper: TEST_PEPPER });
  return { simCollectorId: simId };
}
