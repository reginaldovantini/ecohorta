import type { Actor } from "./actor";
import { getDatabase } from "./db/pg";
import { ConfigError } from "./errors";
import { jsonError } from "./http";
import { findActor } from "./profile-service";
import { createSupabaseServerClient } from "./supabase-server";

/**
 * Identifica o usuário da requisição pela sessão do Supabase (JWT verificado)
 * e carrega o perfil ativo do banco. Nunca confia em dados enviados pelo navegador.
 */
export async function authenticate(): Promise<{ actor: Actor; response?: undefined } | { actor?: undefined; response: Response }> {
  let userId: string | undefined;
  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getClaims();
    userId = typeof data?.claims?.sub === "string" ? data.claims.sub : undefined;
  } catch (error) {
    if (error instanceof ConfigError) return { response: jsonError(503, error.message) };
    return { response: jsonError(503, "Autenticação indisponível no momento.") };
  }
  if (!userId) return { response: jsonError(401, "Faça login para continuar.") };

  const actor = await findActor(getDatabase(), userId);
  if (!actor) return { response: jsonError(403, "Conta sem perfil ativo.") };
  return { actor };
}
