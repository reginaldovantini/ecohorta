import type { UserRole } from "@/lib/users/types";

/**
 * Usuário autenticado e ativo, com tudo vindo do banco — nunca do navegador.
 *
 * `role` é a função DECLARADA no primeiro acesso e serve para exibição. Ela não
 * concede poder nenhum: com cadastro aberto, qualquer pessoa marcaria
 * "Professor(a)" e passaria a ver a área administrativa.
 *
 * Poder vem de duas fontes, as duas explícitas e as duas lidas do banco a cada
 * requisição:
 *
 *   `adminOfSchool`  o administrador da plataforma autorizou este e-mail a
 *                    administrar uma escola (tabela `admin_grants`);
 *   `stewardOf`      a pessoa digitou o código impresso dentro da caixa
 *                    eletrônica daquele captador.
 *
 * São coisas diferentes de propósito: administrar é cadastrar captadores de uma
 * escola; ser responsável é poder calibrar um tubo específico, que alguém ganha
 * estando fisicamente na frente dele.
 */
export interface Actor {
  profileId: string;
  /** Nulo até a pessoa ler o QR de algum captador: antes disso ela não pertence a escola nenhuma. */
  schoolId: string | null;
  role: UserRole;
  /** Administração da plataforma: cria escolas, autoriza e-mails, alcança todas as escolas. */
  platformAdmin: boolean;
  /** Escola que esta pessoa administra, quando o e-mail dela foi autorizado. */
  adminOfSchool: string | null;
  /** Captadores sob responsabilidade desta pessoa (ids). */
  stewardOf: readonly string[];
}

/**
 * Acompanha a escola e controla a simulação: administração ou quem é responsável
 * por pelo menos um captador. A função declarada no cadastro NÃO entra nesta conta.
 */
export const isEducator = (actor: Actor) =>
  actor.platformAdmin || actor.adminOfSchool !== null || actor.stewardOf.length > 0;

/**
 * Cadastrar captadores e usar a área administrativa.
 *
 * Diz apenas que a pessoa administra ALGUMA escola — para agir sobre uma escola
 * específica, quem decide é `administersSchool`.
 */
export const isAdministrator = (actor: Actor) => actor.platformAdmin || actor.adminOfSchool !== null;

/**
 * Administrar ESTA escola.
 *
 * É o cerco que mantém uma escola invisível para a administração de outra: quem
 * foi autorizado para a escola A não cadastra, não lista e não calibra nada da
 * escola B. Só a administração da plataforma atravessa.
 */
export const administersSchool = (actor: Actor, schoolId: string | null) =>
  actor.platformAdmin || (schoolId !== null && actor.adminOfSchool === schoolId);

/**
 * Calibrar, usar a bancada e trocar o sensor DESTE captador.
 *
 * Quem administra a escola do captador também conduz — por isso o `schoolId` do
 * captador é pedido aqui: sem ele, um administrador de escola alcançaria tubos
 * de qualquer outra.
 */
export const isStewardOf = (actor: Actor, collectorId: string, collectorSchoolId: string | null = null) =>
  actor.platformAdmin || actor.stewardOf.includes(collectorId) || administersSchool(actor, collectorSchoolId);

/** Criar escolas e autorizar administradores: só a administração da plataforma. */
export const isPlatformAdmin = (actor: Actor) => actor.platformAdmin;
