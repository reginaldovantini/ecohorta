import { isPlatformAdmin, type Actor } from "./actor";
import { grantAdmin } from "./admin-grants";
import { isUniqueViolation, millis, type Database, type Queryable } from "./db/types";
import { fail, type ServiceResult } from "./errors";
import { isUf, registerSchool } from "./school-registry";

/*
 * A PORTA DA FRENTE DA REDE.
 *
 * A EcoHorta só cresce se outra escola montar um tubo. Enquanto entrar na rede
 * dependesse de o administrador conhecer a pessoa e digitar o e-mail dela, a
 * coisa funcionava para a primeira escola e travava na terceira.
 *
 * Aqui um professor se candidata: quem é, qual escola, onde fica. O pedido não
 * concede nada — é um recado com formulário. Quem abre a porta continua sendo
 * uma pessoa decidindo, e é ela que, com um toque, cria a escola e a
 * autorização de uma vez.
 *
 * Criar as duas juntas é de propósito: separadas, sobraria a chance de
 * autorizar alguém para uma escola que ninguém cadastrou.
 */

export interface PartnershipRequest {
  id: string;
  name: string;
  email: string;
  jobTitle: string | null;
  schoolName: string;
  city: string;
  state: string;
  message: string | null;
  status: "pending" | "approved" | "declined";
  createdAt: number;
  handledAt: number | null;
  schoolId: string | null;
}

interface RequestRow {
  id: string;
  name: string;
  email: string;
  job_title: string | null;
  school_name: string;
  city: string;
  state: string;
  message: string | null;
  status: PartnershipRequest["status"];
  created_at: Date | string;
  handled_at: Date | string | null;
  school_id: string | null;
}

const toRequest = (row: RequestRow): PartnershipRequest => ({
  id: row.id,
  name: row.name,
  email: row.email,
  jobTitle: row.job_title,
  schoolName: row.school_name,
  city: row.city,
  state: row.state,
  message: row.message,
  status: row.status,
  createdAt: millis(row.created_at)!,
  handledAt: millis(row.handled_at),
  schoolId: row.school_id,
});

const COLUMNS = `id, name, email, job_title, school_name, city, state, message, status, created_at, handled_at, school_id`;

export interface PartnershipInput {
  name: string;
  email: string;
  jobTitle?: string | null;
  schoolName: string;
  city: string;
  state: string;
  message?: string | null;
}

/**
 * Registra a candidatura. Rota PÚBLICA: quem preenche ainda não tem conta.
 *
 * Por ser pública, tudo é limpo e medido aqui — e o banco repete as mesmas
 * regras, porque validação que mora só na aplicação é validação que um dia
 * falta.
 */
export async function requestPartnership(db: Queryable, input: PartnershipInput): Promise<ServiceResult<{ id: string }>> {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  const schoolName = input.schoolName.trim();
  const city = input.city.trim();
  const state = input.state.trim().toUpperCase();

  if (name.length < 2) return fail(422, "Informe o seu nome.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail(422, "Informe um e-mail válido.");
  if (schoolName.length < 3) return fail(422, "Informe o nome da escola.");
  if (city.length < 2) return fail(422, "Informe o município.");
  if (!isUf(state)) return fail(422, "Escolha o estado.");

  try {
    const { rows } = await db.query<{ id: string }>(
      `insert into public.partnership_requests (name, email, job_title, school_name, city, state, message)
       values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [name, email, input.jobTitle?.trim() || null, schoolName, city, state, input.message?.trim() || null],
    );
    return { ok: true, value: { id: rows[0]!.id } };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return fail(409, "Já recebemos um pedido com este e-mail. Vamos responder em breve.");
    }
    throw error;
  }
}

/** Os pedidos, pendentes primeiro. Só a administração da plataforma. */
export async function listPartnershipRequests(db: Queryable, actor: Actor): Promise<ServiceResult<PartnershipRequest[]>> {
  if (!isPlatformAdmin(actor)) return fail(403, "Somente a administração da plataforma vê os pedidos de parceria.");
  const { rows } = await db.query<RequestRow>(
    `select ${COLUMNS} from public.partnership_requests
     order by (status = 'pending') desc, created_at desc
     limit 200`,
  );
  return { ok: true, value: rows.map(toRequest) };
}

/**
 * Aprova: cria a escola, autoriza o e-mail e marca o pedido — tudo ou nada.
 *
 * Numa transação porque meio caminho aqui é pior do que nenhum: uma escola sem
 * ninguém que a administre, ou uma autorização apontando para o vazio.
 */
export async function approvePartnership(db: Database, actor: Actor, id: string): Promise<ServiceResult<PartnershipRequest>> {
  if (!isPlatformAdmin(actor)) return fail(403, "Somente a administração da plataforma aprova parcerias.");

  return db.transaction(async (tx) => {
    const { rows } = await tx.query<RequestRow>(
      `select ${COLUMNS} from public.partnership_requests where id = $1 and status = 'pending' for update`,
      [id],
    );
    const pedido = rows[0];
    if (!pedido) return fail(404, "Este pedido não existe ou já foi respondido.");

    const escola = await registerSchool(tx, { name: pedido.school_name, city: pedido.city, state: pedido.state as never });
    const grant = await grantAdmin(tx, actor, { email: pedido.email, schoolId: escola.id, note: `Parceria · ${pedido.name}` });
    if (!grant.ok) return grant;

    const atualizado = await tx.query<RequestRow>(
      `update public.partnership_requests
       set status = 'approved', handled_by = $2, handled_at = now(), school_id = $3
       where id = $1 returning ${COLUMNS}`,
      [id, actor.profileId, escola.id],
    );
    return { ok: true, value: toRequest(atualizado.rows[0]!) };
  });
}

/** Recusa o pedido. A linha fica: o histórico de quem procurou o projeto importa. */
export async function declinePartnership(db: Queryable, actor: Actor, id: string): Promise<ServiceResult<PartnershipRequest>> {
  if (!isPlatformAdmin(actor)) return fail(403, "Somente a administração da plataforma responde pedidos de parceria.");
  const { rows } = await db.query<RequestRow>(
    `update public.partnership_requests
     set status = 'declined', handled_by = $2, handled_at = now()
     where id = $1 and status = 'pending' returning ${COLUMNS}`,
    [id, actor.profileId],
  );
  const pedido = rows[0];
  if (!pedido) return fail(404, "Este pedido não existe ou já foi respondido.");
  return { ok: true, value: toRequest(pedido) };
}
