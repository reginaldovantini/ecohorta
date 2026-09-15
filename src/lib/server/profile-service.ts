import type { ExecutionRecord } from "@/lib/missions/history";
import { identityUpdateSchema, type DisplayIdentity, type EducationLevel, type StaffSector, type UserRole } from "@/lib/users/types";
import type { Actor } from "./actor";
import { millis, num, type Queryable } from "./db/types";
import { fail, type ServiceResult } from "./errors";

/*
 * Perfil do usuário autenticado. XP e histórico vêm SEMPRE do banco
 * (xp_transactions e mission_executions): o navegador só exibe.
 */

export interface MeResponse {
  profileId: string;
  role: UserRole;
  schoolId: string;
  schoolName: string;
  /** Nulo até o primeiro acesso (apelido e avatar ainda não escolhidos). */
  identity: DisplayIdentity | null;
  xp: number;
  history: ExecutionRecord[];
}

interface ProfileRow {
  id: string;
  role: UserRole;
  school_id: string;
  school_name: string;
  nickname: string | null;
  avatar_id: string | null;
  job_title: string | null;
  staff_sector: StaffSector | null;
  class_id: string | null;
  class_name: string | null;
  education_level: EducationLevel | null;
}

/** Perfil ativo do usuário do Supabase Auth, ou null. */
export async function findActor(db: Queryable, userId: string): Promise<Actor | null> {
  const { rows } = await db.query<{ id: string; school_id: string; role: UserRole }>(
    "select id, school_id, role from public.profiles where id = $1 and status = 'active'",
    [userId],
  );
  const row = rows[0];
  return row ? { profileId: row.id, schoolId: row.school_id, role: row.role } : null;
}

function toIdentity(row: ProfileRow): DisplayIdentity | null {
  if (!row.nickname || !row.avatar_id) return null;
  const base = { nickname: row.nickname, avatarId: row.avatar_id as DisplayIdentity["avatarId"] };
  switch (row.role) {
    case "student":
      return row.class_id && row.class_name && row.education_level
        ? { role: "student", ...base, classId: row.class_id, className: row.class_name, educationLevel: row.education_level }
        : null;
    case "teacher":
      return { role: "teacher", ...base, jobTitle: row.job_title ?? "Professor(a)" };
    case "staff":
      return row.staff_sector ? { role: "staff", ...base, jobTitle: row.job_title ?? "Funcionário(a)", sector: row.staff_sector } : null;
    case "admin":
      return { role: "admin", ...base, jobTitle: row.job_title };
  }
}

export async function getMe(db: Queryable, actor: Actor): Promise<MeResponse> {
  const profile = await db.query<ProfileRow>(
    `select p.id, p.role, p.school_id, s.name as school_name, p.nickname, p.avatar_id, p.job_title, p.staff_sector,
            p.class_id, c.name as class_name, c.education_level
     from public.profiles p
     join public.schools s on s.id = p.school_id
     left join public.school_classes c on c.id = p.class_id
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

/** O próprio usuário escolhe apelido e avatar (primeiro acesso ou edição). */
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
