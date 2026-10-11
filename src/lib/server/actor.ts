import type { UserRole } from "@/lib/users/types";

/**
 * Usuário autenticado e ativo, com tudo vindo do banco — nunca do navegador.
 *
 * `role` é a função DECLARADA no primeiro acesso e serve para exibição. Ela não
 * concede poder nenhum: com cadastro aberto, qualquer pessoa marcaria "Professor(a)".
 * Quem manda num captador é quem é RESPONSÁVEL por ele, e isso se ganha digitando
 * o código impresso dentro da caixa eletrônica.
 */
export interface Actor {
  profileId: string;
  /** Nulo até a pessoa ler o QR de algum captador: antes disso ela não pertence a escola nenhuma. */
  schoolId: string | null;
  role: UserRole;
  /** Administração da plataforma, acima das escolas. Marcada só pelo script de administração. */
  platformAdmin: boolean;
  /** Captadores sob responsabilidade desta pessoa (ids). */
  stewardOf: readonly string[];
}

/**
 * Acompanha a escola e controla a simulação: administração ou quem é responsável
 * por pelo menos um captador. A função declarada no cadastro NÃO entra nesta conta.
 */
export const isEducator = (actor: Actor) =>
  actor.platformAdmin || actor.role === "admin" || actor.stewardOf.length > 0;

/** Calibrar, usar a bancada e trocar o sensor DESTE captador. */
export const isStewardOf = (actor: Actor, collectorId: string) =>
  actor.platformAdmin || actor.role === "admin" || actor.stewardOf.includes(collectorId);

/** Cadastrar captadores e criar escolas: só administração, nunca função autodeclarada. */
export const isAdministrator = (actor: Actor) => actor.platformAdmin || actor.role === "admin";
