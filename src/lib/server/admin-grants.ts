import { isPlatformAdmin, type Actor } from "./actor";
import { isForeignKeyViolation, isUniqueViolation, millis, type Queryable } from "./db/types";
import { fail, type ServiceResult } from "./errors";

/*
 * AUTORIZAR QUEM ADMINISTRA — a única porta por onde o poder entra.
 *
 * Quem administra uma escola cadastra captadores dela, gera o adesivo que vai
 * para o tubo e o programa que vai para a placa. É poder sobre coisa física, e
 * por isso ele não se autoatribui: alguém o concede, e fica registrado quem
 * concedeu e quando.
 *
 * A autorização é por E-MAIL, não por perfil, para poder existir antes de a
 * pessoa entrar. O administrador da plataforma digita o Gmail de quem vai
 * cuidar da escola, e essa pessoa já chega administradora no primeiro acesso —
 * sem a dança de "entre primeiro que depois eu te promovo".
 *
 * Revogar não apaga a linha. O histórico de quem teve acesso a quê é parte da
 * prestação de contas de um projeto que mexe com dados de menores de idade.
 */

export interface AdminGrant {
  email: string;
  schoolId: string | null;
  schoolName: string | null;
  platformAdmin: boolean;
  grantedAt: number;
  revokedAt: number | null;
  note: string | null;
}

interface GrantRow {
  email: string;
  school_id: string | null;
  school_name: string | null;
  platform_admin: boolean;
  granted_at: Date | string;
  revoked_at: Date | string | null;
  note: string | null;
}

const toGrant = (row: GrantRow): AdminGrant => ({
  email: row.email,
  schoolId: row.school_id,
  schoolName: row.school_name,
  platformAdmin: row.platform_admin,
  grantedAt: millis(row.granted_at)!,
  revokedAt: millis(row.revoked_at),
  note: row.note,
});

/** Normaliza como o banco exige: minúsculas, sem espaços nas pontas. */
export const normalizeEmail = (value: string) => value.trim().toLowerCase();

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Todas as autorizações, ativas e revogadas, mais recentes primeiro.
 *
 * As revogadas continuam na lista de propósito: quem administra a plataforma
 * precisa poder responder "quem já teve acesso a esta escola?".
 */
export async function listGrants(db: Queryable, actor: Actor): Promise<ServiceResult<AdminGrant[]>> {
  if (!isPlatformAdmin(actor)) return fail(403, "Somente a administração da plataforma vê as autorizações.");
  const { rows } = await db.query<GrantRow>(
    `select g.email, g.school_id, s.name as school_name, g.platform_admin, g.granted_at, g.revoked_at, g.note
     from public.admin_grants g
     left join public.schools s on s.id = g.school_id
     order by g.revoked_at nulls first, g.granted_at desc`,
  );
  return { ok: true, value: rows.map(toGrant) };
}

export interface GrantInput {
  email: string;
  /** Escola que esta pessoa vai administrar. */
  schoolId: string;
  note?: string | null;
}

/**
 * Autoriza um e-mail a administrar uma escola.
 *
 * Reautorizar alguém revogado reaproveita a mesma linha: o e-mail é a chave, e
 * duas linhas para a mesma pessoa só criariam dúvida sobre qual vale.
 */
export async function grantAdmin(db: Queryable, actor: Actor, input: GrantInput): Promise<ServiceResult<AdminGrant>> {
  if (!isPlatformAdmin(actor)) return fail(403, "Somente a administração da plataforma autoriza administradores.");

  const email = normalizeEmail(input.email);
  if (!EMAIL.test(email)) return fail(422, "Informe um e-mail válido.");
  // A pessoa entra pelo Google: um e-mail que não seja de conta Google nunca
  // chegaria a logar, e a autorização ficaria pendurada sem dono.
  const nota = input.note?.trim() || null;
  if (nota && nota.length > 200) return fail(422, "A observação é longa demais.");

  try {
    const { rows } = await db.query<GrantRow>(
      `insert into public.admin_grants (email, school_id, platform_admin, granted_by, note)
       values ($1, $2, false, $3, $4)
       on conflict (email) do update
         set school_id = excluded.school_id, platform_admin = false, granted_by = excluded.granted_by,
             granted_at = now(), revoked_at = null, note = excluded.note
       returning email, school_id, platform_admin, granted_at, revoked_at, note,
                 (select name from public.schools where id = admin_grants.school_id) as school_name`,
      [email, input.schoolId, actor.profileId, nota],
    );
    return { ok: true, value: toGrant(rows[0]!) };
  } catch (error) {
    if (isUniqueViolation(error)) return fail(409, "Este e-mail já está autorizado.");
    if (isForeignKeyViolation(error)) return fail(422, "Escolha uma escola válida.");
    // Qualquer outra falha é defeito nosso: vira 500 e aparece no log, em vez de
    // se disfarçar de recusa amigável e esconder o problema.
    throw error;
  }
}

/**
 * Revoga a autorização. A linha fica, com a data — o acesso termina na próxima
 * requisição da pessoa, porque a autoridade é lida ao vivo.
 */
export async function revokeAdmin(db: Queryable, actor: Actor, email: string): Promise<ServiceResult<void>> {
  if (!isPlatformAdmin(actor)) return fail(403, "Somente a administração da plataforma revoga autorizações.");

  const alvo = normalizeEmail(email);
  const { rows } = await db.query<{ email: string; platform_admin: boolean }>(
    "select email, platform_admin from public.admin_grants where email = $1 and revoked_at is null",
    [alvo],
  );
  const grant = rows[0];
  if (!grant) return fail(404, "Esta autorização não existe ou já foi revogada.");
  // Tirar a administração da plataforma de dentro do app deixaria o sistema sem
  // dono. Isso se faz na configuração do servidor, com acesso ao ambiente.
  if (grant.platform_admin) return fail(409, "A administração da plataforma não se revoga por aqui.");

  await db.query("update public.admin_grants set revoked_at = now() where email = $1", [alvo]);
  return { ok: true, value: undefined };
}
