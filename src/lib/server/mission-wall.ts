import { findMission } from "@/lib/missions/catalog";
import type { Actor } from "./actor";
import { isUniqueViolation, millis, type Database, type Queryable } from "./db/types";
import { fail, type ServiceResult } from "./errors";

/*
 * O MURAL DAS MISSÕES.
 *
 * A plataforma já prova QUANTA água foi reutilizada. O mural prova O QUE foi
 * feito com ela — e é o que faz a turma do lado querer fazer missão. Sem ele, a
 * missão acaba numa tela de parabéns que ninguém mais vê.
 *
 * Quatro regras carregam o resto:
 *
 *   1. UMA foto por missão executada. O post não existe solto: é evidência de
 *      uma liberação que o sensor mediu. Sem execução não há publicação.
 *   2. CURTIDA NÃO DÁ PONTO. O bônus vem de registrar a própria missão, uma vez.
 *      Se curtida valesse, dois estudantes curtindo um ao outro subiriam no
 *      ranking sem economizar uma gota.
 *   3. Publicar exige AUTORIZAÇÃO DE IMAGEM vigente. São fotos de menores vistas
 *      por outras escolas: é esse limite que torna o mural defensável.
 *   4. Denúncia tira do mural na hora e devolve a decisão a um responsável. O
 *      mural é visto por escolas inteiras; esperar análise para remover seria
 *      deixar no ar justamente o que foi denunciado.
 */

// O valor mora em @/lib/missions/evidence, que a tela também importa: dois
// números seriam dois números para divergir.
export { EVIDENCE_BONUS_XP } from "@/lib/missions/evidence";
import { EVIDENCE_BONUS_XP } from "@/lib/missions/evidence";

export interface WallPost {
  id: string;
  executionId: string;
  /** Caminho no bucket privado. A imagem chega por URL assinada, nunca pública. */
  imagePath: string;
  caption: string | null;
  createdAt: number;
  author: { nickname: string; avatarId: string; isMe: boolean };
  school: { id: string; name: string };
  mission: { id: string; title: string };
  deliveredLiters: number;
  collectorCode: string;
  likes: number;
  likedByMe: boolean;
}

interface PostRow {
  id: string;
  execution_id: string;
  image_path: string;
  caption: string | null;
  created_at: Date | string;
  profile_id: string;
  nickname: string;
  avatar_id: string;
  school_id: string;
  school_name: string;
  mission_id: string;
  delivered_liters: string | number;
  collector_code: string;
  likes: number;
  liked_by_me: boolean;
}

const toPost = (row: PostRow, meId: string): WallPost => ({
  id: row.id,
  executionId: row.execution_id,
  imagePath: row.image_path,
  caption: row.caption,
  createdAt: millis(row.created_at)!,
  author: { nickname: row.nickname, avatarId: row.avatar_id, isMe: row.profile_id === meId },
  school: { id: row.school_id, name: row.school_name },
  mission: { id: row.mission_id, title: findMission(row.mission_id)?.title ?? row.mission_id },
  deliveredLiters: Number(row.delivered_liters),
  collectorCode: row.collector_code,
  likes: Number(row.likes),
  likedByMe: row.liked_by_me,
});

const POST_SELECT = `
  select p.id, p.execution_id, p.image_path, p.caption, p.created_at, p.profile_id,
         pr.nickname, pr.avatar_id, p.school_id, s.name as school_name,
         e.mission_id, e.delivered_liters, c.code as collector_code,
         (select count(*) from public.mission_post_likes l where l.post_id = p.id)::int as likes,
         exists (select 1 from public.mission_post_likes l where l.post_id = p.id and l.profile_id = $1) as liked_by_me
  from public.mission_posts p
  join public.profiles pr on pr.id = p.profile_id
  join public.schools s on s.id = p.school_id
  join public.mission_executions e on e.id = p.execution_id
  join public.collectors c on c.id = p.collector_id`;

/** A autorização de imagem vigente desta pessoa. */
async function hasImageConsent(q: Queryable, profileId: string): Promise<boolean> {
  const { rows } = await q.query(
    "select 1 from public.guardian_consents where profile_id = $1 and purpose = 'uso_de_imagem' and revoked_at is null",
    [profileId],
  );
  return rows.length > 0;
}

export interface PostInput {
  executionId: string;
  /** Caminho já gravado no bucket privado pela rota que recebeu o arquivo. */
  imagePath: string;
  caption?: string | null;
}

/**
 * Publica a evidência de uma missão e credita o bônus.
 *
 * Tudo numa transação: um bônus sem publicação seria ponto do nada, e uma
 * publicação sem bônus faria a pessoa tentar de novo e tomar "já publicada".
 */
export async function createPost(db: Database, actor: Actor, input: PostInput): Promise<ServiceResult<{ postId: string; bonusXp: number }>> {
  const caption = input.caption?.trim() || null;
  if (caption !== null && caption.length > 140) return fail(422, "A legenda passa de 140 caracteres.");

  return db.transaction(async (tx) => {
    const { rows } = await tx.query<{
      id: string;
      profile_id: string;
      collector_id: string;
      school_id: string;
      status: string;
      mission_id: string;
      is_simulated: boolean;
    }>(
      `select e.id, e.profile_id, e.collector_id, c.school_id, e.status, e.mission_id, d.is_simulated
       from public.mission_executions e
       join public.collectors c on c.id = e.collector_id
       join public.device_commands d on d.id = e.command_id
       where e.id = $1`,
      [input.executionId],
    );
    const execucao = rows[0];
    if (!execucao) return fail(404, "Missão não encontrada.");
    if (execucao.profile_id !== actor.profileId) return fail(403, "Esta missão é de outra pessoa.");
    if (execucao.status !== "COMPLETED") return fail(409, "Só missão concluída vira publicação.");
    // Missão de simulação não entra no mural pelo mesmo motivo que não dá XP:
    // o mural é evidência, e evidência de água simulada não é evidência.
    if (execucao.is_simulated) return fail(409, "Missão de simulação não vai para o mural.");
    if (!(await hasImageConsent(tx, actor.profileId))) {
      return fail(403, "Autorize o uso da sua imagem no perfil para publicar no mural.");
    }

    let postId: string;
    try {
      const inserido = await tx.query<{ id: string }>(
        `insert into public.mission_posts (execution_id, profile_id, collector_id, school_id, image_path, caption)
         values ($1, $2, $3, $4, $5, $6) returning id`,
        [execucao.id, actor.profileId, execucao.collector_id, execucao.school_id, input.imagePath, caption],
      );
      postId = inserido.rows[0]!.id;
    } catch (error) {
      if (isUniqueViolation(error)) return fail(409, "Esta missão já foi registrada no mural.");
      throw error;
    }

    // O bônus, uma vez por publicação. `xp_once_per_source` garante no banco.
    await tx.query(
      `insert into public.xp_transactions (profile_id, amount, source_type, source_id, reason)
       values ($1, $2, 'mission_post', $3, $4)
       on conflict on constraint xp_once_per_source do nothing`,
      [actor.profileId, EVIDENCE_BONUS_XP, postId, "Evidência registrada no mural"],
    );

    return { ok: true, value: { postId, bonusXp: EVIDENCE_BONUS_XP } };
  });
}

/**
 * O mural, da publicação mais recente para a mais antiga.
 *
 * Toda a rede, e não só a escola: o mural é justamente onde uma escola vê que
 * não está sozinha. O ranking é que fica dentro da escola, para a comparação
 * ser entre quem tem o mesmo tubo.
 */
export async function listWall(
  q: Queryable,
  actor: Actor,
  { limit = 30, before }: { limit?: number; before?: number } = {},
): Promise<WallPost[]> {
  const tamanho = Math.min(Math.max(limit, 1), 50);
  const { rows } = await q.query<PostRow>(
    `${POST_SELECT}
     where p.hidden_at is null and ($2::timestamptz is null or p.created_at < $2)
     order by p.created_at desc
     limit $3`,
    [actor.profileId, before ? new Date(before) : null, tamanho],
  );
  return rows.map((row) => toPost(row, actor.profileId));
}

/** As publicações de uma pessoa, para o próprio perfil. */
export async function listMyPosts(q: Queryable, actor: Actor, limit = 30): Promise<WallPost[]> {
  const { rows } = await q.query<PostRow>(
    `${POST_SELECT} where p.profile_id = $1 and p.hidden_at is null order by p.created_at desc limit $2`,
    [actor.profileId, Math.min(Math.max(limit, 1), 50)],
  );
  return rows.map((row) => toPost(row, actor.profileId));
}

/** Curte ou descurte. Devolve o estado final, que é o que a tela mostra. */
export async function toggleLike(db: Database, actor: Actor, postId: string): Promise<ServiceResult<{ likes: number; likedByMe: boolean }>> {
  return db.transaction(async (tx) => {
    const { rows } = await tx.query("select 1 from public.mission_posts where id = $1 and hidden_at is null", [postId]);
    if (rows.length === 0) return fail(404, "Publicação não encontrada.");

    const existente = await tx.query("select 1 from public.mission_post_likes where post_id = $1 and profile_id = $2", [
      postId,
      actor.profileId,
    ]);
    if (existente.rows.length > 0) {
      await tx.query("delete from public.mission_post_likes where post_id = $1 and profile_id = $2", [postId, actor.profileId]);
    } else {
      await tx.query(
        "insert into public.mission_post_likes (post_id, profile_id) values ($1, $2) on conflict do nothing",
        [postId, actor.profileId],
      );
    }

    const total = await tx.query<{ n: number }>("select count(*)::int as n from public.mission_post_likes where post_id = $1", [postId]);
    return { ok: true, value: { likes: total.rows[0]!.n, likedByMe: existente.rows.length === 0 } };
  });
}

/**
 * Denúncia: tira do mural AGORA e devolve a decisão a um responsável.
 *
 * Remover primeiro e analisar depois é a ordem certa quando o conteúdo é visto
 * por escolas inteiras — o contrário deixaria no ar exatamente o que alguém
 * apontou como problema.
 */
export async function reportPost(db: Database, actor: Actor, postId: string, reason: unknown): Promise<ServiceResult<void>> {
  const motivo = typeof reason === "string" ? reason.trim() : "";
  if (motivo.length < 2 || motivo.length > 200) return fail(422, "Conte em poucas palavras o que há de errado.");

  return db.transaction(async (tx) => {
    const { rows } = await tx.query("select 1 from public.mission_posts where id = $1", [postId]);
    if (rows.length === 0) return fail(404, "Publicação não encontrada.");

    try {
      await tx.query("insert into public.mission_post_reports (post_id, profile_id, reason) values ($1, $2, $3)", [
        postId,
        actor.profileId,
        motivo,
      ]);
    } catch (error) {
      if (isUniqueViolation(error)) return fail(409, "Você já denunciou esta publicação.");
      throw error;
    }

    await tx.query(
      "update public.mission_posts set hidden_at = now(), hidden_reason = $2 where id = $1 and hidden_at is null",
      [postId, "Em análise após denúncia"],
    );
    return { ok: true, value: undefined };
  });
}

/** Apagar a própria publicação. O bônus já concedido não é retirado. */
export async function deletePost(db: Queryable, actor: Actor, postId: string): Promise<ServiceResult<void>> {
  const { rows } = await db.query<{ id: string }>(
    "delete from public.mission_posts where id = $1 and profile_id = $2 returning id",
    [postId, actor.profileId],
  );
  if (rows.length === 0) return fail(404, "Publicação não encontrada.");
  return { ok: true, value: undefined };
}
