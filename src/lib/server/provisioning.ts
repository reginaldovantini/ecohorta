import { createHash, randomBytes, randomInt } from "node:crypto";
import { normalizeCollectorCode } from "@/lib/collector/code";
import { DEFAULT_DISTANCE_SENSOR, type DistanceSensorModel } from "@/lib/collector/distance-sensors";
import { DEFAULT_SIMULATION_SETTINGS } from "@/lib/iot/simulation-config";
import { ACCESS_CODE_ALPHABET, accessCodePrefix, studentEmail } from "@/lib/users/access";
import {
  adminRecordSchema,
  staffRecordSchema,
  studentRecordSchema,
  teacherRecordSchema,
  type EducationLevel,
  type StaffSector,
} from "@/lib/users/types";
import { isUniqueViolation, type Database, type Queryable } from "./db/types";

/*
 * Provisionamento (escola, turmas, captadores e participantes).
 * Usado pelos scripts de administração e pela API de administração.
 */

export interface AuthAdmin {
  createUser(input: { email: string; password: string; role: string }): Promise<string>;
  deleteUser(userId: string): Promise<void>;
}

export const hashDeviceToken = (token: string, pepper: string) => createHash("sha256").update(`${pepper}:${token}`).digest("hex");
export const generateSecret = (bytes = 32) => randomBytes(bytes).toString("hex");

export function generatePin() {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function generateAccessCode(prefix: string) {
  let suffix = "";
  for (let i = 0; i < 4; i++) suffix += ACCESS_CODE_ALPHABET[randomInt(0, ACCESS_CODE_ALPHABET.length)];
  return `${prefix}-${suffix}`;
}

export async function ensureSchool(db: Queryable, name: string) {
  const { rows } = await db.query<{ id: string }>(
    "insert into public.schools (name) values ($1) on conflict (name) do update set name = excluded.name returning id",
    [name],
  );
  return rows[0]!.id;
}

export async function ensureClass(
  db: Queryable,
  schoolId: string,
  input: { name: string; educationLevel: EducationLevel; grade: number; section: string; schoolYear: number },
) {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.school_classes (school_id, name, education_level, grade, section, school_year)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (school_id, school_year, education_level, grade, section) do update set name = excluded.name
     returning id`,
    [schoolId, input.name, input.educationLevel, input.grade, input.section, input.schoolYear],
  );
  return rows[0]!.id;
}

/**
 * Cria ou atualiza o captador e seu dispositivo. O token é recebido em claro
 * apenas para gerar o hash — nunca é salvo.
 */
export async function ensureCollector(
  db: Database,
  input: {
    schoolId: string;
    code: string;
    name: string;
    location: string;
    capacityLiters: number;
    reserveLiters: number;
    /** Dimensões de projeto do tubo (ex.: DN100 e 1.500 mm), referência da calibração. */
    nominalDiameterMm?: number | null;
    nominalUsefulHeightMm?: number | null;
    /**
     * Sensor de distância de um captador NOVO. Em um captador existente não é alterado aqui:
     * a troca é feita na plataforma (Ligações), com confirmação e histórico.
     */
    distanceSensor?: DistanceSensorModel;
    device: { deviceKey: string; isSimulated: boolean; token: string; pepper: string };
  },
) {
  const code = normalizeCollectorCode(input.code);
  if (!code) throw new Error(`Código de captador inválido: ${input.code}`);
  return db.transaction(async (tx) => {
    const collector = await tx.query<{ id: string }>(
      `insert into public.collectors (school_id, code, name, location, capacity_liters, reserve_liters, nominal_diameter_mm, nominal_useful_height_mm,
         distance_sensor)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (code) do update set name = excluded.name, location = excluded.location,
         capacity_liters = excluded.capacity_liters, reserve_liters = excluded.reserve_liters,
         nominal_diameter_mm = coalesce(excluded.nominal_diameter_mm, public.collectors.nominal_diameter_mm),
         nominal_useful_height_mm = coalesce(excluded.nominal_useful_height_mm, public.collectors.nominal_useful_height_mm)
       returning id`,
      [
        input.schoolId,
        code,
        input.name,
        input.location,
        input.capacityLiters,
        input.reserveLiters,
        input.nominalDiameterMm ?? null,
        input.nominalUsefulHeightMm ?? null,
        input.distanceSensor ?? DEFAULT_DISTANCE_SENSOR,
      ],
    );
    const collectorId = collector.rows[0]!.id;
    // Tipo do dispositivo que alimentava este captador até agora (REAL ou SIMULAÇÃO).
    const previous = await tx.query<{ is_simulated: boolean | null }>(
      `select d.is_simulated from public.collector_state s left join public.devices d on d.id = s.device_id where s.collector_id = $1`,
      [collectorId],
    );
    const previousKind = previous.rows[0]?.is_simulated ?? null;
    const device = await tx.query<{ id: string }>(
      `insert into public.devices (collector_id, device_key, is_simulated, token_hash)
       values ($1, $2, $3, $4)
       on conflict (device_key) do update set collector_id = excluded.collector_id, is_simulated = excluded.is_simulated,
         token_hash = excluded.token_hash, active = true
       returning id`,
      [collectorId, input.device.deviceKey, input.device.isSimulated, hashDeviceToken(input.device.token, input.device.pepper)],
    );
    const deviceId = device.rows[0]!.id;
    const simulation = input.device.isSimulated
      ? JSON.stringify({ settings: DEFAULT_SIMULATION_SETTINGS, pendingAction: null, nextActionId: 1 })
      : null;
    await tx.query(
      `insert into public.collector_state (collector_id, device_id, simulation) values ($1, $2, $3::jsonb)
       on conflict (collector_id) do update set device_id = excluded.device_id,
         simulation = case when $4 then coalesce(public.collector_state.simulation, excluded.simulation) else null end`,
      [collectorId, deviceId, simulation, input.device.isSimulated],
    );

    if (previousKind !== null && previousKind !== input.device.isSimulated) {
      // Troca entre SIMULAÇÃO e REAL: nada do outro tipo continua valendo neste captador.
      // Estado, leituras e balanço recomeçam; a calibração ativa é substituída (o histórico fica).
      await tx.query(
        `update public.collector_state
         set accounting = '{}'::jsonb, volume_liters = null, volume_source = 'none', calibration_id = null, height_mm = null,
             distance_mm = null, distance_samples = '[]'::jsonb, sensor_diagnostics = null, sensor_model = null,
             reported_hardware_revision = null,
             last_seen_at = null, uptime_ms = null, seq = null, status = 'OFFLINE', valve = 'unknown',
             last_telemetry_at = null, last_telemetry_volume = null,
             bench_mode_until = null, bench_started_at = null, bench_started_by = null, calibration_mode_until = null
         where collector_id = $1`,
        [collectorId],
      );
      await tx.query(
        "update public.collector_calibrations set status = 'superseded', superseded_at = now() where collector_id = $1 and status = 'active'",
        [collectorId],
      );
      await tx.query("update public.collector_calibrations set status = 'cancelled' where collector_id = $1 and status = 'draft'", [collectorId]);
    }
    return { collectorId, deviceId };
  });
}

export type ParticipantInput =
  | { role: "student"; schoolId: string; classId: string; firstName: string; lastName: string; birthDate: string }
  | { role: "teacher"; schoolId: string; firstName: string; lastName: string; jobTitle: string; email: string; password: string }
  | {
      role: "staff";
      schoolId: string;
      firstName: string;
      lastName: string;
      jobTitle: string;
      sector: StaffSector;
      email: string;
      password: string;
    }
  | { role: "admin"; schoolId: string; firstName: string; lastName: string; jobTitle: string | null; email: string; password: string };

export interface CreatedParticipant {
  profileId: string;
  role: ParticipantInput["role"];
  email: string;
  /** Somente estudantes: entregar ao estudante uma única vez. */
  accessCode?: string;
  pin?: string;
}

function validate(input: ParticipantInput) {
  switch (input.role) {
    case "student":
      return studentRecordSchema.safeParse(input);
    case "teacher":
      return teacherRecordSchema.safeParse(input);
    case "staff":
      return staffRecordSchema.safeParse(input);
    case "admin":
      return adminRecordSchema.safeParse(input);
  }
}

/**
 * Cria o participante: conta no Supabase Auth + perfil de exibição + registro cadastral.
 * Se a parte do banco falhar, a conta criada no Auth é removida.
 */
export async function createParticipant(db: Database, auth: AuthAdmin, input: ParticipantInput): Promise<CreatedParticipant> {
  const parsed = validate(input);
  if (!parsed.success) throw new Error(`Dados inválidos: ${parsed.error.issues.map((issue) => issue.path.join(".") + " " + issue.message).join("; ")}`);
  if (input.role !== "student" && input.password.length < 10) throw new Error("A senha precisa ter pelo menos 10 caracteres.");

  let accessCode: string | undefined;
  let pin: string | undefined;
  let email: string;
  let password: string;

  if (input.role === "student") {
    const { rows } = await db.query<{ grade: number; section: string; school_id: string }>(
      "select grade, section, school_id from public.school_classes where id = $1",
      [input.classId],
    );
    const schoolClass = rows[0];
    if (!schoolClass || schoolClass.school_id !== input.schoolId) throw new Error("Turma não encontrada nesta escola.");
    const prefix = accessCodePrefix(schoolClass.grade, schoolClass.section);
    for (let attempt = 0; attempt < 10 && !accessCode; attempt++) {
      const candidate = generateAccessCode(prefix);
      const taken = await db.query("select 1 from public.profiles where access_code = $1", [candidate]);
      if (taken.rows.length === 0) accessCode = candidate;
    }
    if (!accessCode) throw new Error("Não foi possível gerar um código de acesso único.");
    pin = generatePin();
    email = studentEmail(accessCode);
    password = pin;
  } else {
    email = input.email.trim().toLowerCase();
    password = input.password;
  }

  const userId = await auth.createUser({ email, password, role: input.role });
  try {
    await db.transaction(async (tx) => {
      await tx.query(
        `insert into public.profiles (id, school_id, role, class_id, job_title, staff_sector, access_code, status)
         values ($1, $2, $3, $4, $5, $6, $7, 'active')`,
        [
          userId,
          input.schoolId,
          input.role,
          input.role === "student" ? input.classId : null,
          input.role === "student" ? null : input.jobTitle,
          input.role === "staff" ? input.sector : null,
          accessCode ?? null,
        ],
      );
      await tx.query("insert into public.person_records (profile_id, first_name, last_name, birth_date) values ($1, $2, $3, $4)", [
        userId,
        input.firstName.trim(),
        input.lastName.trim(),
        input.role === "student" ? input.birthDate : null,
      ]);
    });
  } catch (error) {
    await auth.deleteUser(userId).catch(() => undefined);
    if (isUniqueViolation(error)) throw new Error("Já existe um participante com este identificador.");
    throw error;
  }

  return { profileId: userId, role: input.role, email, accessCode, pin };
}

/** Registro do consentimento do responsável (LGPD art. 14). */
export async function recordGuardianConsent(
  db: Queryable,
  input: { studentId: string; recordedBy: string | null; method: "termo_impresso" | "termo_digital" | "outro"; consentedAt?: Date },
) {
  await db.query(
    `insert into public.guardian_consents (profile_id, recorded_by, consented_at, method) values ($1, $2, $3, $4)
     on conflict (profile_id) do update set recorded_by = excluded.recorded_by, consented_at = excluded.consented_at, method = excluded.method`,
    [input.studentId, input.recordedBy, input.consentedAt ?? new Date(), input.method],
  );
}
