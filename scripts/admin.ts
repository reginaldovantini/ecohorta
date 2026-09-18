/*
 * Administração da EcoHorta — executar no computador do responsável, nunca no navegador.
 * Lê as credenciais do .env.local.
 *
 *   npm run db:migrate
 *   npm run db:seed -- --class "6º Ano C:elementary:6:C" [--class ...] [--school "Nome"] [--year 2026]
 *   npm run admin -- list-classes
 *   npm run admin -- create-user --role student --class "6º Ano C" --first João --last Silva --birth 2012-04-15 --consent termo_impresso
 *   npm run admin -- create-user --role teacher --first Ana --last Lima --job "Professora de Ciências" --email ana@escola.exemplo
 *   npm run admin -- create-user --role staff --first Rita --last Alves --job "Secretária" --sector secretaria --email rita@escola.exemplo
 *   npm run admin -- create-user --role admin --first Rê --last Vantini --email admin@escola.exemplo
 *   npm run admin -- register-device --collector EC-001 --name "EcoCaptador" --location "Horta" --capacity 11.8 --reserve 0.5 --diameter 100 --height 1500 --key ESP32-001 [--sensor VL53L1X]
 *
 * Convenção: EC-001 = captador FÍSICO (ESP32-001). SIM-001 = captador da SIMULAÇÃO (VIRTUAL-001), criado pelo seed.
 *
 * --diameter e --height: diâmetro nominal (mm) e altura útil aproximada (mm) do tubo. Servem de
 * referência para validar a calibração de volume feita no app (Administração → Captadores).
 *
 * --sensor: sensor de distância (VL53L0X ou VL53L1X; padrão VL53L1X) de um captador NOVO. Em um
 * captador existente o sensor não muda por aqui: a troca é feita na plataforma (Administração →
 * Captadores → {código} → Ligações), com confirmação e histórico.
 *
 * PINs, senhas e tokens gerados aparecem UMA única vez no terminal e não são salvos,
 * exceto o token do dispositivo virtual, gravado apenas no .env.local deste computador.
 */
import { randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { DEFAULT_DISTANCE_SENSOR, DISTANCE_SENSOR_MODELS, isDistanceSensorModel } from "@/lib/collector/distance-sensors";
import { SIMULATED_COLLECTOR, SIMULATED_DEVICE_ID } from "@/lib/iot/simulation-config";
import { openScriptDatabase } from "@/lib/server/db/pg";
import type { Queryable } from "@/lib/server/db/types";
import {
  createParticipant,
  ensureClass,
  ensureCollector,
  ensureSchool,
  generateSecret,
  recordGuardianConsent,
  type ParticipantInput,
} from "@/lib/server/provisioning";
import { createAuthAdmin } from "@/lib/server/supabase-admin";
import { EDUCATION_LEVELS, STAFF_SECTORS, type EducationLevel, type StaffSector } from "@/lib/users/types";

try {
  process.loadEnvFile(".env.local");
} catch {
  // Variáveis podem vir do ambiente.
}

const DEFAULT_SCHOOL = "EE Prof.ª Clarinda Mendes de Aquino";
const CONSENT_METHODS = ["termo_impresso", "termo_digital", "outro"] as const;

const [command = "help", ...rest] = process.argv.slice(2);
const { values } = parseArgs({
  args: rest,
  strict: true,
  options: {
    school: { type: "string" },
    class: { type: "string", multiple: true },
    year: { type: "string" },
    role: { type: "string" },
    first: { type: "string" },
    last: { type: "string" },
    birth: { type: "string" },
    email: { type: "string" },
    job: { type: "string" },
    sector: { type: "string" },
    consent: { type: "string" },
    collector: { type: "string" },
    name: { type: "string" },
    location: { type: "string" },
    capacity: { type: "string" },
    reserve: { type: "string" },
    diameter: { type: "string" },
    height: { type: "string" },
    key: { type: "string" },
    sensor: { type: "string" },
  },
});

function need(name: string, value = process.env[name]) {
  if (!value) throw new Error(`Informe ${name}.`);
  return value;
}

const scriptDatabaseUrl = () => process.env.DATABASE_MIGRATION_URL || need("DATABASE_URL");

function pepper() {
  const value = need("IOT_TOKEN_PEPPER");
  if (value.length < 32) throw new Error("IOT_TOKEN_PEPPER precisa de pelo menos 32 caracteres aleatórios.");
  return value;
}

async function withDatabase<T>(fn: (db: ReturnType<typeof openScriptDatabase>["db"]) => Promise<T>) {
  const { db, close } = openScriptDatabase(scriptDatabaseUrl());
  try {
    return await fn(db);
  } finally {
    await close();
  }
}

async function resolveSchool(db: Queryable) {
  const { rows } = await db.query<{ id: string; name: string }>("select id, name from public.schools order by name");
  const match = values.school ? rows.find((row) => row.name === values.school) : rows.length === 1 ? rows[0] : undefined;
  if (!match) throw new Error(rows.length === 0 ? "Nenhuma escola cadastrada. Rode `npm run db:seed`." : "Informe --school com o nome exato da escola.");
  return match.id;
}

/** Salva o token do dispositivo virtual no .env.local (somente neste computador). */
function storeVirtualToken(token: string) {
  const file = ".env.local";
  const content = existsSync(file) ? readFileSync(file, "utf8") : "";
  const line = `IOT_SIMULATED_DEVICE_TOKEN=${token}`;
  const next = /^IOT_SIMULATED_DEVICE_TOKEN=.*$/m.test(content)
    ? content.replace(/^IOT_SIMULATED_DEVICE_TOKEN=.*$/m, line)
    : `${content.trimEnd()}\n\n# Gerado por npm run db:seed (o banco guarda apenas o hash)\n${line}\n`;
  writeFileSync(file, next);
}

async function migrate() {
  await withDatabase(async (db) => {
    // Mesma tabela de controle do Supabase CLI: migrations aplicadas aqui também aparecem para `supabase db push`.
    await db.query(
      "create schema if not exists supabase_migrations; create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text)",
    );
    const { rows } = await db.query<{ version: string }>("select version from supabase_migrations.schema_migrations");
    const applied = new Set(rows.map((row) => row.version));
    const dir = path.join(process.cwd(), "supabase", "migrations");

    for (const file of readdirSync(dir).filter((name) => name.endsWith(".sql")).sort()) {
      const match = /^(\d+)_(.+)\.sql$/.exec(file);
      if (!match) continue;
      const [, version, name] = match;
      if (applied.has(version!)) {
        console.log(`= ${file} (já aplicada)`);
        continue;
      }
      const sql = readFileSync(path.join(dir, file), "utf8");
      await db.transaction(async (tx) => {
        await tx.query(sql);
        await tx.query("insert into supabase_migrations.schema_migrations (version, statements, name) values ($1, $2, $3)", [version, [sql], name]);
      });
      console.log(`+ ${file} aplicada`);
    }
  });
}

async function seed() {
  const devicePepper = pepper();
  let token = process.env.IOT_SIMULATED_DEVICE_TOKEN;
  if (!token) {
    token = generateSecret(32);
    storeVirtualToken(token);
    console.log("Token do dispositivo virtual gerado e gravado no .env.local.");
  }
  const year = Number(values.year ?? new Date().getFullYear());

  await withDatabase(async (db) => {
    const schoolId = await ensureSchool(db, values.school ?? DEFAULT_SCHOOL);
    console.log(`Escola: ${values.school ?? DEFAULT_SCHOOL}`);

    for (const spec of values.class ?? []) {
      const [name, level, grade, section] = spec.split(":");
      if (!name || !EDUCATION_LEVELS.includes(level as EducationLevel) || !grade || !section) {
        throw new Error(`Turma inválida "${spec}". Formato: "6º Ano C:elementary:6:C" (níveis: ${EDUCATION_LEVELS.join(", ")}).`);
      }
      await ensureClass(db, schoolId, { name, educationLevel: level as EducationLevel, grade: Number(grade), section, schoolYear: year });
      console.log(`Turma: ${name} (${year})`);
    }

    await ensureCollector(db, {
      schoolId,
      code: SIMULATED_COLLECTOR.code,
      name: SIMULATED_COLLECTOR.name,
      location: SIMULATED_COLLECTOR.location,
      capacityLiters: SIMULATED_COLLECTOR.capacityLiters,
      reserveLiters: SIMULATED_COLLECTOR.reserveLiters,
      // Geometria de referência do tubo simulado (DN100, ~1,50 m úteis).
      nominalDiameterMm: 100,
      nominalUsefulHeightMm: 1500,
      device: { deviceKey: SIMULATED_DEVICE_ID, isSimulated: true, token, pepper: devicePepper },
    });
    console.log(`Captador ${SIMULATED_COLLECTOR.code} + dispositivo ${SIMULATED_DEVICE_ID} (SIMULAÇÃO) registrados.`);
  });
}

async function listClasses() {
  await withDatabase(async (db) => {
    const { rows } = await db.query<{ school: string; name: string; school_year: number; education_level: string; students: number }>(
      `select s.name as school, c.name, c.school_year, c.education_level,
              (select count(*)::int from public.profiles p where p.class_id = c.id) as students
       from public.school_classes c join public.schools s on s.id = c.school_id
       order by s.name, c.school_year desc, c.education_level, c.grade, c.section`,
    );
    console.table(rows);
  });
}

async function createUser() {
  const role = need("--role", values.role);
  const firstName = need("--first", values.first);
  const lastName = need("--last", values.last);

  await withDatabase(async (db) => {
    const schoolId = await resolveSchool(db);
    const auth = createAuthAdmin();

    if (role === "student") {
      const className = need("--class", values.class?.[0]);
      const consent = need("--consent", values.consent);
      if (!CONSENT_METHODS.includes(consent as (typeof CONSENT_METHODS)[number])) {
        throw new Error(`--consent deve ser: ${CONSENT_METHODS.join(", ")} (registro do consentimento do responsável).`);
      }
      const { rows } = await db.query<{ id: string }>(
        "select id from public.school_classes where school_id = $1 and name = $2 order by school_year desc limit 1",
        [schoolId, className],
      );
      if (!rows[0]) throw new Error(`Turma "${className}" não encontrada. Veja: npm run admin -- list-classes`);

      const created = await createParticipant(db, auth, {
        role,
        schoolId,
        classId: rows[0].id,
        firstName,
        lastName,
        birthDate: need("--birth", values.birth),
      });
      await recordGuardianConsent(db, { studentId: created.profileId, recordedBy: null, method: consent as (typeof CONSENT_METHODS)[number] });
      console.log(`\nEstudante criado. Entregue ao estudante (aparece só agora):\n  Código: ${created.accessCode}\n  PIN:    ${created.pin}\n`);
      return;
    }

    const email = need("--email", values.email);
    const password = randomBytes(12).toString("base64url");
    let input: ParticipantInput;
    if (role === "teacher") input = { role, schoolId, firstName, lastName, jobTitle: need("--job", values.job), email, password };
    else if (role === "staff") {
      const sector = need("--sector", values.sector);
      if (!STAFF_SECTORS.includes(sector as StaffSector)) throw new Error(`--sector deve ser: ${STAFF_SECTORS.join(", ")}`);
      input = { role, schoolId, firstName, lastName, jobTitle: need("--job", values.job), sector: sector as StaffSector, email, password };
    } else if (role === "admin") input = { role, schoolId, firstName, lastName, jobTitle: values.job ?? null, email, password };
    else throw new Error("--role deve ser student, teacher, staff ou admin.");

    const created = await createParticipant(db, auth, input);
    console.log(`\nConta criada (a senha aparece só agora):\n  E-mail: ${created.email}\n  Senha:  ${password}\n`);
  });
}

async function registerDevice() {
  const devicePepper = pepper();
  const code = need("--collector", values.collector);
  const deviceKey = need("--key", values.key);
  const sensor = (values.sensor ?? DEFAULT_DISTANCE_SENSOR).toUpperCase();
  if (!isDistanceSensorModel(sensor)) throw new Error(`Sensor inválido "${values.sensor}". Use ${DISTANCE_SENSOR_MODELS.join(" ou ")}.`);
  const token = randomBytes(32).toString("hex");

  await withDatabase(async (db) => {
    const schoolId = await resolveSchool(db);
    const { rows } = await db.query<{ device_key: string }>(
      "select d.device_key from public.devices d join public.collectors c on c.id = d.collector_id where c.code = $1 and d.active",
      [code.toUpperCase()],
    );
    if (rows[0] && rows[0].device_key !== deviceKey) {
      throw new Error(`O captador ${code} já tem o dispositivo ${rows[0].device_key}. Desative-o ou use outro código de captador.`);
    }
    await ensureCollector(db, {
      schoolId,
      code,
      name: need("--name", values.name),
      location: need("--location", values.location),
      capacityLiters: Number(need("--capacity", values.capacity)),
      reserveLiters: Number(values.reserve ?? "0"),
      nominalDiameterMm: values.diameter ? Number(values.diameter) : null,
      nominalUsefulHeightMm: values.height ? Number(values.height) : null,
      distanceSensor: sensor,
      device: { deviceKey, isSimulated: false, token, pepper: devicePepper },
    });
    const configured = await db.query<{ distance_sensor: string; hardware_revision: number }>(
      "select distance_sensor, hardware_revision from public.collectors where code = $1",
      [code.toUpperCase()],
    );
    const current = configured.rows[0];
    if (current) {
      console.log(`Sensor de distância configurado: ${current.distance_sensor} (revisão ${current.hardware_revision}).`);
      if (current.distance_sensor !== sensor) {
        console.log(`O captador já existia: o sensor NÃO foi trocado. Para trocar, use Administração → Captadores → ${code.toUpperCase()} → Ligações.`);
      }
    }
  });
  console.log(`\nDispositivo ${deviceKey} (REAL) registrado no captador ${code}.`);
  console.log(`Token (aparece só agora; grave em firmware/include/secrets.h, que não vai para o Git):\n  ${token}\n`);
}

const COMMANDS: Record<string, () => Promise<void>> = {
  migrate,
  seed,
  "list-classes": listClasses,
  "create-user": createUser,
  "register-device": registerDevice,
};

const run = COMMANDS[command];
if (!run) {
  console.log("Comandos: migrate, seed, list-classes, create-user, register-device (veja o cabeçalho de scripts/admin.ts).");
  process.exit(command === "help" ? 0 : 1);
}

run().catch((error: unknown) => {
  console.error(`\nErro: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
