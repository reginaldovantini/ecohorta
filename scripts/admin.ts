/*
 * Administração da EcoHorta — executar no computador do responsável, nunca no navegador.
 * Lê as credenciais do .env.local.
 *
 *   npm run db:migrate
 *   npm run db:seed [--school "Nome"]
 *   npm run admin -- create-admin --email voce@escola.exemplo --name "Rê" [--platform] [--school "Nome"]
 *   npm run admin -- list-collectors
 *   npm run admin -- register-collector --location "Horta dos fundos" [--school "Nome"] [--diameter 100] [--height 1500] [--reserve 0.5] [--sensor VL53L1X]
 *   npm run admin -- register-device --collector EC-001 --key ESP32-001
 *
 * PESSOAS NÃO SÃO CRIADAS AQUI. O cadastro é aberto: estudantes, professores e
 * funcionários entram pelo app (Google) e declaram a função. Só `create-admin`
 * existe, porque administração é a única função que ninguém pode se autoatribuir.
 *
 * CAPTADOR normalmente se cadastra DENTRO da plataforma (Administração → Captadores).
 * `register-collector` existe para o primeiro captador, antes de haver administrador.
 *
 * Convenção: EC-001, EC-002... são sequenciais DENTRO de cada escola. SIM-001 é o
 * captador da SIMULAÇÃO (VIRTUAL-001), criado pelo seed.
 *
 * Senhas, códigos de responsável e tokens aparecem UMA única vez e não são salvos,
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
import { registerCollector } from "@/lib/server/collector-registry";
import { createAdministrator, ensureDevice, ensureSchool, generateSecret } from "@/lib/server/provisioning";
import { createAuthAdmin } from "@/lib/server/supabase-admin";

try {
  process.loadEnvFile(".env.local");
} catch {
  // Variáveis podem vir do ambiente.
}

const DEFAULT_SCHOOL = "EE Prof.ª Clarinda Mendes de Aquino";

const [command = "help", ...rest] = process.argv.slice(2);
const { values } = parseArgs({
  args: rest,
  strict: true,
  options: {
    school: { type: "string" },
    email: { type: "string" },
    name: { type: "string" },
    platform: { type: "boolean" },
    collector: { type: "string" },
    location: { type: "string" },
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

  await withDatabase(async (db) => {
    const schoolId = await ensureSchool(db, values.school ?? DEFAULT_SCHOOL);
    console.log(`Escola: ${values.school ?? DEFAULT_SCHOOL}`);

    const existente = await db.query<{ id: string; code: string }>(
      "select c.id, c.code from public.collectors c join public.devices d on d.collector_id = c.id where d.device_key = $1",
      [SIMULATED_DEVICE_ID],
    );
    let collectorId = existente.rows[0]?.id;
    let code = existente.rows[0]?.code;

    if (!collectorId) {
      const criado = await db.transaction((tx) =>
        registerCollector(tx, {
          schoolId,
          prefix: "SIM",
          location: SIMULATED_COLLECTOR.location,
          name: SIMULATED_COLLECTOR.name,
          nominalDiameterMm: 100,
          nominalUsefulHeightMm: 1500,
          reserveLiters: SIMULATED_COLLECTOR.reserveLiters,
          createdBy: null,
          pepper: devicePepper,
        }),
      );
      collectorId = criado.id;
      code = criado.code;
      console.log(`Captador ${criado.code} criado (${criado.location}, ~${criado.estimatedCapacityLiters} L estimados).`);
      console.log(`Código de responsável (aparece só agora): ${criado.stewardCode}`);
    }

    await ensureDevice(db, { collectorId, deviceKey: SIMULATED_DEVICE_ID, isSimulated: true, token, pepper: devicePepper });
    console.log(`Dispositivo ${SIMULATED_DEVICE_ID} (SIMULAÇÃO) ligado ao captador ${code}.`);
    console.log("Este captador ainda NÃO entrega litros: calibre-o em Administração → Captadores.");
  });
}

async function listCollectors() {
  await withDatabase(async (db) => {
    const { rows } = await db.query(
      `select s.name as escola, c.code as codigo, c.location as localizacao, c.distance_sensor as sensor,
              c.active as ativo,
              (select count(*)::int from public.collector_stewards w where w.collector_id = c.id) as responsaveis,
              (k.version is not null) as calibrado
       from public.collectors c
       join public.schools s on s.id = c.school_id
       left join public.collector_calibrations k on k.collector_id = c.id and k.status = 'active'
       order by s.name, c.seq`,
    );
    if (rows.length === 0) console.log("Nenhum captador cadastrado. Rode `npm run db:seed`.");
    else console.table(rows);
  });
}

async function createAdmin() {
  const email = need("--email", values.email);
  const name = need("--name", values.name);
  const password = randomBytes(12).toString("base64url");

  await withDatabase(async (db) => {
    // Administrar a plataforma e pertencer a uma escola são coisas separadas: quem
    // cuida da rede normalmente também participa de uma escola. Sem escola cadastrada,
    // a conta nasce sem vínculo — e é ela que vai criar a primeira.
    const escolas = await db.query<{ id: string }>("select id from public.schools");
    const schoolId = escolas.rows.length === 0 && values.platform ? null : await resolveSchool(db);
    const created = await createAdministrator(db, createAuthAdmin(), {
      email,
      password,
      name,
      schoolId,
      platformAdmin: values.platform ?? false,
    });
    console.log("");
    console.log("Conta de administração criada (a senha aparece só agora):");
    console.log(`  E-mail: ${created.email}`);
    console.log(`  Senha:  ${password}`);
    console.log(values.platform ? "  Alcance: plataforma (todas as escolas)" : "  Alcance: uma escola");
    console.log("");
  });
}

async function registerCollectorCommand() {
  const devicePepper = pepper();
  const location = need("--location", values.location);
  const sensor = (values.sensor ?? DEFAULT_DISTANCE_SENSOR).toUpperCase();
  if (!isDistanceSensorModel(sensor)) throw new Error(`Sensor inválido "${values.sensor}". Use ${DISTANCE_SENSOR_MODELS.join(" ou ")}.`);

  await withDatabase(async (db) => {
    const schoolId = await resolveSchool(db);
    const criado = await db.transaction((tx) =>
      registerCollector(tx, {
        schoolId,
        location,
        name: values.name ?? null,
        nominalDiameterMm: Number(values.diameter ?? "100"),
        nominalUsefulHeightMm: Number(values.height ?? "1500"),
        reserveLiters: Number(values.reserve ?? "0.5"),
        distanceSensor: sensor,
        createdBy: null,
        pepper: devicePepper,
      }),
    );
    console.log("");
    console.log(`Captador ${criado.code} cadastrado em "${criado.location}".`);
    console.log(`  Sensor:              ${criado.distanceSensor}`);
    console.log(`  Capacidade estimada: ${criado.estimatedCapacityLiters} L (a real sai da calibração)`);
    console.log("");
    console.log("Imprima e cole no tubo o QR Code deste token:");
    console.log(`  ${criado.qrToken}`);
    console.log("");
    console.log("Guarde DENTRO da caixa eletrônica (aparece só agora):");
    console.log(`  Código de responsável: ${criado.stewardCode}`);
    console.log("");
    console.log("O captador só entrega litros depois de calibrado.");
  });
}

async function registerDevice() {
  const devicePepper = pepper();
  const code = need("--collector", values.collector).toUpperCase();
  const deviceKey = need("--key", values.key);
  const token = randomBytes(32).toString("hex");

  await withDatabase(async (db) => {
    const schoolId = await resolveSchool(db);
    const { rows } = await db.query<{ id: string; location: string }>(
      "select id, location from public.collectors where school_id = $1 and code = $2",
      [schoolId, code],
    );
    const collector = rows[0];
    if (!collector) throw new Error(`Captador ${code} não existe nesta escola. Veja: npm run admin -- list-collectors`);

    const ocupado = await db.query<{ device_key: string }>(
      "select device_key from public.devices where collector_id = $1 and active",
      [collector.id],
    );
    if (ocupado.rows[0] && ocupado.rows[0].device_key !== deviceKey) {
      throw new Error(`O captador ${code} já tem o dispositivo ${ocupado.rows[0].device_key}.`);
    }

    await ensureDevice(db, { collectorId: collector.id, deviceKey, isSimulated: false, token, pepper: devicePepper });
    console.log("");
    console.log(`Dispositivo ${deviceKey} (REAL) ligado ao captador ${code} — ${collector.location}.`);
    console.log("Token (aparece só agora; grave em firmware/include/secrets.h, que não vai para o Git):");
    console.log(`  ${token}`);
  });
}

const COMMANDS: Record<string, () => Promise<void>> = {
  migrate,
  seed,
  "list-collectors": listCollectors,
  "create-admin": createAdmin,
  "register-collector": registerCollectorCommand,
  "register-device": registerDevice,
};

const run = COMMANDS[command];
if (!run) {
  console.log("Comandos: migrate, seed, list-collectors, create-admin, register-collector, register-device (veja o cabeçalho de scripts/admin.ts).");
  process.exit(command === "help" ? 0 : 1);
}

run().catch((error: unknown) => {
  console.error(`
Erro: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
