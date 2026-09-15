import type { UserRole } from "@/lib/users/types";

/** Usuário autenticado e ativo, com o perfil vindo do banco (nunca do navegador). */
export interface Actor {
  profileId: string;
  schoolId: string;
  role: UserRole;
}

/** Professores e administradores acompanham a escola e controlam a simulação. */
export const isEducator = (actor: Actor) => actor.role === "teacher" || actor.role === "admin";
