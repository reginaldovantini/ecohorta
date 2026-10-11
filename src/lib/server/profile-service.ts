import type { ExecutionRecord } from "@/lib/missions/history";
import {
  identityUpdateSchema,
  onboardingSchema,
  type DisplayIdentity,
  type GradePhase,
  type StaffSector,
  type UserRole,
} from "@/lib/users/types";
import type { Actor } from "./actor";
import { millis, num, type Database, type Queryable } from "./db/types";
import { fail, type ServiceResult } from "./errors";

/*
 * Perfil do usuário autenticado. XP e histórico vêm SEMPRE do banco
 * (xp_transactions e mission_executions): o navegador só exibe.
 */

export interface MeResponse {
  profileId: string;
  role: UserRole;
  /** Nulos até a pessoa ler o QR de um captador: é a leitura que a liga a uma escola. */
  schoolId: string | null;
  schoolName: string | null;
  /** Nulo até o primeiro acesso ser concluído. */
  identity: DisplayIdentity | null;
  /** Responsável por estes captadores (calibração, bancada, ligações). */
  stewardOf: string[];
  /** Escolas a que a pessoa pertence. A atual é a que o jogo mostra. */
  schools: MySchool[];
  xp: number;
  history: ExecutionRecord[];
}

export interface MySchool {
  id: string;
  name: string;
  current: boolean;
  /** Entrou nesta escola lendo o QR deste captador. */
  joinedVia: { code: string; location: string } | null;
}

interface ProfileRow {
  id: string;
  role: UserRole;
  school_id: string | null;
  school_name: string | null;
  nickname: string | null;
  avatar_id: string | null;
  job_title: string | null;
  staff_sector: StaffSector | null;
  grade_phase: GradePhase | null;
}

/**
 * Garante o perfil de quem acabou de entrar pela primeira vez.
 *
 * Com cadastro aberto, o Supabase Auth cria a conta e o app descobre a pessoa
 * aqui. O perfil nasce SEM ESCOLA (ela vem da primeira leitura de QR) e com a
 * função `student`, que é o padrão seguro: se o primeiro acesso for interrompido
 * no meio, a conta fica sem privilégio nenhum em vez de virar educador.
 *
 * `onboarded_at` continua nulo, então o app leva a pessoa ao primeiro acesso.
 */
export async function ensureProfile(db: Queryable, userId: string): Promise<void> {
  await db.query(
    "insert into public.profiles (id, role, status) values ($1, 'student', 'active') on conflict (id) do nothing",
    [userId],
  );
}

/** Perfil ativo do usuário do Supabase Auth, ou null. */
export async function findActor(db: Queryable, userId: string): Promise<Actor | null> {
  const { rows } = await db.query<{ id: string; school_id: string | null; role: UserRole; platform_admin: boolean }>(
    "select id, school_id, role, platform_admin from public.profiles where id = $1 and status = 'active'",
    [userId],
  );
  const row = rows[0];
  if (!row) return null;
  // Os captadores sob responsabilidade vêm do banco a cada requisição: é deles que
  // sai o poder de calibrar, e não da função declarada no cadastro.
  const stewardships = await db.query<{ collector_id: string }>(
    "select collector_id from public.collector_stewards where profile_id = $1",
    [userId],
  );
  return {
    profileId: row.id,
    schoolId: row.school_id,
    role: row.role,
    platformAdmin: row.platform_admin,
    stewardOf: stewardships.rows.map((item) => item.collector_id),
  };
}

function toIdentity(row: ProfileRow): DisplayIdentity | null {
  if (!row.nickname || !row.avatar_id) return null;
  const base = { nickname: row.nickname, avatarId: row.avatar_id as DisplayIdentity["avatarId"] };
  switch (row.role) {
    case "student":
      return row.grade_phase ? { role: "student", ...base, gradePhase: row.grade_phase } : null;
    case "teacher":
      return { role: "teacher", ...base, jobTitle: row.job_title };
    case "staff":
      return { role: "staff", ...base, jobTitle: row.job_title, sector: row.staff_sector };
    case "admin":
      return { role: "admin", ...base, jobTitle: row.job_title };
  }
}

/**
 * Escolas a que a pessoa pertence, com a atual marcada.
 * Entrar numa escola é físico (ler o QR de um captador de lá); escolher em qual
 * jogar é uma troca de tela, feita no perfil.
 */
export async function listMySchools(db: Queryable, profileId: string, currentSchoolId: string | null): Promise<MySchool[]> {
  const { rows } = await db.query<{ id: string; name: string; code: string | null; location: string | null }>(
    `select s.id, s.name, c.code, c.location
     from public.school_members m
     join public.schools s on s.id = m.school_id
     left join public.collectors c on c.id = m.joined_via_collector
     where m.profile_id = $1
     order by s.name`,
    [profileId],
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    current: row.id === currentSchoolId,
    joinedVia: row.code && row.location ? { code: row.code, location: row.location } : null,
  }));
}

/**
 * Troca a escola que a pessoa está jogando.
 *
 * SÓ entre escolas a que ela já pertence — e pertencer exige ter lido o QR de um
 * captador de lá. Esta checagem é a fronteira de segurança: os serviços filtram
 * tudo por `actor.schoolId` sem passar pelo RLS, então aceitar uma escola
 * qualquer aqui abriria os dados dela.
 */
export async function switchSchool(db: Queryable, actor: Actor, schoolId: unknown): Promise<ServiceResult<void>> {
  if (typeof schoolId !== "string" || schoolId.length === 0) return fail(422, "Escola inválida.");
  const { rows } = await db.query<{ school_id: string }>(
    "select school_id from public.school_members where profile_id = $1 and school_id = $2",
    [actor.profileId, schoolId],
  );
  if (rows.length === 0) {
    return fail(403, "Você ainda não pertence a esta escola. Leia o QR Code de um captador dela.");
  }
  await db.query("update public.profiles set school_id = $2 where id = $1", [actor.profileId, schoolId]);
  return { ok: true, value: undefined };
}

export async function getMe(db: Queryable, actor: Actor): Promise<MeResponse> {
  const profile = await db.query<ProfileRow>(
    `select p.id, p.role, p.school_id, s.name as school_name, p.nickname, p.avatar_id, p.job_title,
            p.staff_sector, p.grade_phase
     from public.profiles p
     left join public.schools s on s.id = p.school_id
     where p.id = $1`,
    [actor.profileId],
  );
  const row = profile.rows[0]!;

  const xp = await db.query<{ xp: string | number }>(
    "select coalesce(sum(amount), 0) as xp from public.xp_transactions where profile_id = $1",
    [actor.profileId],
  );

  const history = await db.query<{
    id: string;
    mission_id: string;
    command_id: string;
    code: string;
    status: ExecutionRecord["status"];
    target_liters: string | number;
    delivered_liters: string | number;
    xp_awarded: number;
    created_at: Date | string;
    started_at: Date | string | null;
    finished_at: Date | string | null;
    is_simulated: boolean;
  }>(
    `select e.id, e.mission_id, e.command_id, c.code, e.status, e.target_liters, e.delivered_liters, e.xp_awarded,
            e.created_at, d.started_at, e.finished_at, d.is_simulated
     from public.mission_executions e
     join public.collectors c on c.id = e.collector_id
     join public.device_commands d on d.id = e.command_id
     where e.profile_id = $1 and e.status in ('COMPLETED', 'FAILED', 'CANCELLED')
     order by e.created_at desc
     limit 100`,
    [actor.profileId],
  );

  return {
    profileId: row.id,
    role: row.role,
    schoolId: row.school_id,
    schoolName: row.school_name,
    identity: toIdentity(row),
    stewardOf: [...actor.stewardOf],
    schools: await listMySchools(db, actor.profileId, row.school_id),
    xp: num(xp.rows[0]?.xp ?? 0),
    history: history.rows.map((item) => ({
      executionId: item.id,
      missionId: item.mission_id,
      commandId: item.command_id,
      collectorCode: item.code,
      status: item.status,
      targetLiters: num(item.target_liters),
      deliveredLiters: num(item.delivered_liters),
      xpAwarded: item.xp_awarded,
      startedAt: millis(item.started_at) ?? millis(item.created_at)!,
      finishedAt: millis(item.finished_at) ?? millis(item.created_at)!,
      origin: item.is_simulated ? "simulation" : "device",
    })),
  };
}

/**
 * Primeiro acesso: nome ou apelido, sexo, nascimento, função e — se estudante —
 * ano/fase. Nada de escola aqui: ela vem da primeira leitura de QR.
 *
 * A função é declarada livremente porque não concede poder: `admin` fica fora do
 * schema justamente para não ser autoatribuível.
 */
export async function completeOnboarding(db: Database, actor: Actor, input: unknown): Promise<ServiceResult<void>> {
  const parsed = onboardingSchema.safeParse(input);
  if (!parsed.success) return fail(422, parsed.error.issues[0]?.message ?? "Dados do cadastro inválidos.");
  const { name, sex, birthDate, role, gradePhase, avatarId } = parsed.data;

  await db.transaction(async (tx) => {
    await tx.query(
      `update public.profiles
       set role = $2, nickname = $3, avatar_id = $4, grade_phase = $5, onboarded_at = coalesce(onboarded_at, now())
       where id = $1`,
      [actor.profileId, role, name, avatarId, role === "student" ? (gradePhase ?? null) : null],
    );
    await tx.query(
      `insert into public.person_records (profile_id, first_name, sex, birth_date) values ($1, $2, $3, $4)
       on conflict (profile_id) do update set first_name = excluded.first_name, sex = excluded.sex, birth_date = excluded.birth_date`,
      [actor.profileId, name, sex, birthDate],
    );
  });
  return { ok: true, value: undefined };
}

/** Depois do primeiro acesso, o usuário ainda troca apelido e avatar quando quiser. */
export async function updateIdentity(db: Queryable, actor: Actor, input: unknown): Promise<ServiceResult<void>> {
  const parsed = identityUpdateSchema.safeParse(input);
  if (!parsed.success) return fail(422, parsed.error.issues[0]?.message ?? "Apelido ou avatar inválido.");
  await db.query(
    `update public.profiles
     set nickname = $2, avatar_id = $3, onboarded_at = coalesce(onboarded_at, now())
     where id = $1`,
    [actor.profileId, parsed.data.nickname, parsed.data.avatarId],
  );
  return { ok: true, value: undefined };
}
