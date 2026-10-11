import type { Actor } from "./actor";
import { num, type Queryable } from "./db/types";

/*
 * RANKING E IMPACTO COLETIVO.
 *
 * Tudo aqui sai de `mission_executions.delivered_liters`, que é o volume MEDIDO
 * pelo sensor durante a liberação — nunca o volume que a missão pediu, e nunca o
 * tempo de válvula aberta. Missão só conta quando terminou em `COMPLETED`.
 *
 * Litros de captador simulado ficam de fora de tudo. O captador virtual existe
 * para desenvolver e demonstrar a plataforma; somar a água dele ao indicador do
 * projeto seria somar água que não existiu.
 *
 * Alcance de cada lista:
 *   escolas       → todas as da plataforma: é a comparação que interessa
 *   participantes → a escola ATUAL de quem olha, porque "colega" é quem está na
 *                   mesma escola. Para ver as outras existe o mural.
 */

const round2 = (value: number) => Math.round(value * 100) / 100;

/*
 * Cada consulta escreve o próprio SQL por extenso. Um fragmento compartilhado
 * terminaria no WHERE e não comportaria os JOINs que cada uma precisa depois;
 * montar SQL com substituição de texto é como se erra silenciosamente.
 *
 * As três condições que valem para todas: missão concluída, água medida maior
 * que zero, e captador físico.
 */

export interface ImpactTotals {
  /** Água reutilizada por todo mundo, somada. É o número do projeto. */
  liters: number;
  missions: number;
  participants: number;
  schools: number;
}

/** Quanto todo mundo, junto, já reutilizou. */
export async function collectiveImpact(db: Queryable): Promise<ImpactTotals> {
  const { rows } = await db.query<{
    liters: string | number;
    missions: string | number;
    participants: string | number;
    schools: string | number;
  }>(
    `select coalesce(sum(e.delivered_liters), 0) as liters,
            count(*) as missions,
            count(distinct e.profile_id) as participants,
            count(distinct c.school_id) as schools
     from public.mission_executions e
     join public.device_commands d on d.id = e.command_id
     join public.collectors c on c.id = e.collector_id
     where e.status = 'COMPLETED' and e.delivered_liters > 0 and not d.is_simulated`,
  );
  const row = rows[0];
  return {
    liters: round2(num(row?.liters ?? 0)),
    missions: Number(row?.missions ?? 0),
    participants: Number(row?.participants ?? 0),
    schools: Number(row?.schools ?? 0),
  };
}

export interface SchoolStanding {
  position: number;
  schoolId: string;
  name: string;
  liters: number;
  missions: number;
  participants: number;
  /** É a escola de quem está olhando. */
  mine: boolean;
}

/** Escolas por água reutilizada. */
export async function schoolRanking(db: Queryable, actor: Actor, { limit = 20 } = {}): Promise<SchoolStanding[]> {
  const { rows } = await db.query<{
    school_id: string;
    name: string;
    liters: string | number;
    missions: string | number;
    participants: string | number;
  }>(
    `select c.school_id, s.name,
            sum(e.delivered_liters) as liters,
            count(*) as missions,
            count(distinct e.profile_id) as participants
     from public.mission_executions e
     join public.device_commands d on d.id = e.command_id
     join public.collectors c on c.id = e.collector_id
     join public.schools s on s.id = c.school_id
     where e.status = 'COMPLETED' and e.delivered_liters > 0 and not d.is_simulated
     group by c.school_id, s.name
     order by sum(e.delivered_liters) desc, s.name
     limit $1`,
    [limit],
  );
  return rows.map((row, index) => ({
    position: index + 1,
    schoolId: row.school_id,
    name: row.name,
    liters: round2(num(row.liters)),
    missions: Number(row.missions),
    participants: Number(row.participants),
    mine: row.school_id === actor.schoolId,
  }));
}

export interface ParticipantStanding {
  position: number;
  profileId: string;
  nickname: string;
  avatarId: string;
  gradePhase: string | null;
  liters: number;
  missions: number;
  /** É quem está olhando. */
  mine: boolean;
}

/**
 * Colegas da escola atual, por água reutilizada. Só dado de exibição — apelido,
 * avatar e ano/fase. Nome, sexo e data de nascimento nunca entram num ranking.
 * Quem ainda não escolheu apelido fica de fora: não dá para identificar alguém
 * numa lista sem nome, e inventar um seria pior.
 */
export async function participantRanking(db: Queryable, actor: Actor, { limit = 50 } = {}): Promise<ParticipantStanding[]> {
  if (!actor.schoolId) return [];
  const { rows } = await db.query<{
    profile_id: string;
    nickname: string;
    avatar_id: string | null;
    grade_phase: string | null;
    liters: string | number;
    missions: string | number;
  }>(
    `select e.profile_id, p.nickname, p.avatar_id, p.grade_phase,
            sum(e.delivered_liters) as liters,
            count(*) as missions
     from public.mission_executions e
     join public.device_commands d on d.id = e.command_id
     join public.collectors c on c.id = e.collector_id
     join public.profiles p on p.id = e.profile_id
     where e.status = 'COMPLETED' and e.delivered_liters > 0 and not d.is_simulated
       and c.school_id = $1 and p.nickname is not null
     group by e.profile_id, p.nickname, p.avatar_id, p.grade_phase
     order by sum(e.delivered_liters) desc, p.nickname
     limit $2`,
    [actor.schoolId, limit],
  );
  return rows.map((row, index) => ({
    position: index + 1,
    profileId: row.profile_id,
    nickname: row.nickname,
    avatarId: row.avatar_id ?? "broto",
    gradePhase: row.grade_phase,
    liters: round2(num(row.liters)),
    missions: Number(row.missions),
    mine: row.profile_id === actor.profileId,
  }));
}

export interface RankingView {
  impact: ImpactTotals;
  schools: SchoolStanding[];
  participants: ParticipantStanding[];
  /** Posição de quem olha entre os colegas. `null` sem nenhuma missão concluída. */
  myPosition: number | null;
}

export async function getRanking(db: Queryable, actor: Actor): Promise<RankingView> {
  const [impact, schools, participants] = await Promise.all([
    collectiveImpact(db),
    schoolRanking(db, actor),
    participantRanking(db, actor),
  ]);
  return {
    impact,
    schools,
    participants,
    myPosition: participants.find((item) => item.mine)?.position ?? null,
  };
}
