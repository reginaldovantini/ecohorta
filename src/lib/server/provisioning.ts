import { createHash, randomBytes } from "node:crypto";
import { DEFAULT_SIMULATION_SETTINGS } from "@/lib/iot/simulation-config";
import { isUniqueViolation, type Database, type Queryable } from "./db/types";

/*
 * Provisionamento — o que NÃO nasce dentro do app.
 *
 * Desde que o cadastro passou a ser aberto (Google), pessoas não são mais criadas
 * por script: elas entram sozinhas e declaram a função. Sobrou aqui o que exige
 * acesso de fora do app:
 *
 *   escola        — criada antes de existir qualquer captador nela;
 *   dispositivo   — o ESP32 (ou o virtual) ligado a um captador já cadastrado;
 *   administração — a única conta que ninguém pode se autoatribuir, porque é ela
 *                   que cadastra captadores e, com platform_admin, cria escolas.
 *
 * Captador não se cadastra aqui: isso é operação de administração dentro da
 * plataforma, com QR e código de responsável (src/lib/server/collector-registry.ts).
 */

export interface AuthAdmin {
  createUser(input: { email: string; password: string; role: string }): Promise<string>;
  deleteUser(userId: string): Promise<void>;
}

export const hashDeviceToken = (token: string, pepper: string) => createHash("sha256").update(`${pepper}:${token}`).digest("hex");
export const generateSecret = (bytes = 32) => randomBytes(bytes).toString("hex");

export async function ensureSchool(db: Queryable, name: string) {
  const { rows } = await db.query<{ id: string }>(
    "insert into public.schools (name) values ($1) on conflict (name) do update set name = excluded.name returning id",
    [name],
  );
  return rows[0]!.id;
}

/**
 * Liga um dispositivo a um captador já cadastrado. O token chega em claro só para
 * virar hash — nunca é salvo, e não há como recuperá-lo depois.
 *
 * Trocar entre REAL e SIMULAÇÃO no mesmo captador recomeça estado, leituras e
 * balanço, e substitui a calibração ativa: medição de um dispositivo não vale para
 * outro (docs/CALIBRACAO.md).
 */
export async function ensureDevice(
  db: Database,
  input: { collectorId: string; deviceKey: string; isSimulated: boolean; token: string; pepper: string },
) {
  return db.transaction(async (tx) => {
    const previous = await tx.query<{ is_simulated: boolean | null }>(
      "select d.is_simulated from public.collector_state s left join public.devices d on d.id = s.device_id where s.collector_id = $1",
      [input.collectorId],
    );
    const previousKind = previous.rows[0]?.is_simulated ?? null;

    // Um captador tem um dispositivo ativo por vez (índice único no banco):
    // trocar o ESP32 desativa o anterior em vez de esbarrar na restrição.
    await tx.query("update public.devices set active = false where collector_id = $1 and device_key <> $2 and active", [
      input.collectorId,
      input.deviceKey,
    ]);
    const device = await tx.query<{ id: string }>(
      `insert into public.devices (collector_id, device_key, is_simulated, token_hash)
       values ($1, $2, $3, $4)
       on conflict (device_key) do update set collector_id = excluded.collector_id, is_simulated = excluded.is_simulated,
         token_hash = excluded.token_hash, active = true
       returning id`,
      [input.collectorId, input.deviceKey, input.isSimulated, hashDeviceToken(input.token, input.pepper)],
    );
    const deviceId = device.rows[0]!.id;
    const simulation = input.isSimulated
      ? JSON.stringify({ settings: DEFAULT_SIMULATION_SETTINGS, pendingAction: null, nextActionId: 1 })
      : null;

    await tx.query(
      `insert into public.collector_state (collector_id, device_id, simulation) values ($1, $2, $3::jsonb)
       on conflict (collector_id) do update set device_id = excluded.device_id,
         simulation = case when $4 then coalesce(public.collector_state.simulation, excluded.simulation) else null end`,
      [input.collectorId, deviceId, simulation, input.isSimulated],
    );

    if (previousKind !== null && previousKind !== input.isSimulated) {
      await tx.query(
        `update public.collector_state
         set accounting = '{}'::jsonb, volume_liters = null, volume_source = 'none', calibration_id = null, height_mm = null,
             distance_mm = null, distance_samples = '[]'::jsonb, sensor_diagnostics = null, sensor_model = null,
             reported_hardware_revision = null,
             last_seen_at = null, uptime_ms = null, seq = null, status = 'OFFLINE', valve = 'unknown',
             last_telemetry_at = null, last_telemetry_volume = null,
             bench_mode_until = null, bench_started_at = null, bench_started_by = null, calibration_mode_until = null
         where collector_id = $1`,
        [input.collectorId],
      );
      await tx.query(
        "update public.collector_calibrations set status = 'superseded', superseded_at = now() where collector_id = $1 and status = 'active'",
        [input.collectorId],
      );
      await tx.query("update public.collector_calibrations set status = 'cancelled' where collector_id = $1 and status = 'draft'", [input.collectorId]);
    }
    return deviceId;
  });
}

export interface AdministratorInput {
  email: string;
  password: string;
  /** Primeiro nome ou apelido; é o que aparece na saudação. */
  name: string;
  schoolId: string | null;
  /** Administração da plataforma: cria escolas e cadastra captadores de qualquer escola. */
  platformAdmin?: boolean;
}

/**
 * Cria uma conta de administração. É a única função de criação de pessoa que
 * sobrou fora do app, exatamente porque `admin` não está entre as funções que
 * alguém pode declarar no primeiro acesso.
 *
 * Se a parte do banco falhar, a conta criada no Auth é removida: nunca fica uma
 * conta capaz de entrar sem perfil correspondente.
 */
export async function createAdministrator(db: Database, auth: AuthAdmin, input: AdministratorInput) {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  if (!email.includes("@")) throw new Error("Informe um e-mail válido.");
  if (input.password.length < 10) throw new Error("A senha precisa ter pelo menos 10 caracteres.");
  if (name.length < 2) throw new Error("Informe o nome.");

  const userId = await auth.createUser({ email, password: input.password, role: "admin" });
  try {
    await db.transaction(async (tx) => {
      await tx.query(
        `insert into public.profiles (id, school_id, role, nickname, avatar_id, platform_admin, status, onboarded_at)
         values ($1, $2, 'admin', $3, 'cientista', $4, 'active', now())`,
        [userId, input.schoolId, name.slice(0, 20), input.platformAdmin ?? false],
      );
      await tx.query("insert into public.person_records (profile_id, first_name) values ($1, $2)", [userId, name]);
    });
  } catch (error) {
    await auth.deleteUser(userId).catch(() => undefined);
    if (isUniqueViolation(error)) throw new Error("Já existe uma conta com este e-mail.");
    throw error;
  }
  return { profileId: userId, email };
}

export type ConsentPurpose = "participacao" | "uso_de_imagem";
export type ConsentMethod = "termo_impresso" | "termo_digital" | "outro";

/**
 * Consentimento do responsável (LGPD art. 14), por finalidade.
 * Participar do projeto e ter a imagem no mural são autorizações diferentes:
 * a segunda pode ser retirada sem derrubar a primeira.
 */
export async function recordGuardianConsent(
  db: Queryable,
  input: { profileId: string; purpose: ConsentPurpose; recordedBy: string | null; method: ConsentMethod; consentedAt?: Date },
) {
  await db.query(
    `insert into public.guardian_consents (profile_id, purpose, recorded_by, consented_at, method)
     values ($1, $2, $3, $4, $5)
     on conflict (profile_id, purpose) do update set recorded_by = excluded.recorded_by,
       consented_at = excluded.consented_at, method = excluded.method, revoked_at = null`,
    [input.profileId, input.purpose, input.recordedBy, input.consentedAt ?? new Date(), input.method],
  );
}

/** Retirada do consentimento. A linha fica: o histórico de que houve autorização não se apaga. */
export async function revokeGuardianConsent(db: Queryable, profileId: string, purpose: ConsentPurpose) {
  await db.query(
    "update public.guardian_consents set revoked_at = now() where profile_id = $1 and purpose = $2 and revoked_at is null",
    [profileId, purpose],
  );
}
