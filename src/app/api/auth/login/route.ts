import { z } from "zod";
import { getDatabase } from "@/lib/server/db/pg";
import { jsonError, jsonOk, parseBody, withErrors } from "@/lib/server/http";
import { ensureProfile } from "@/lib/server/profile-service";
import { createSupabaseServerClient } from "@/lib/server/supabase-server";

const bodySchema = z.object({ email: z.email(), password: z.string().min(1).max(200) });
const INVALID = "E-mail ou senha incorretos.";

/**
 * Entrada por e-mail e senha — a alternativa para quem não usa Google.
 *
 * A mesma mensagem serve para e-mail inexistente e senha errada: dizer qual dos
 * dois falhou entregaria a lista de quem tem conta na plataforma.
 */
export async function POST(request: Request) {
  return withErrors(async () => {
    const body = await parseBody(request, bodySchema);
    if (body.error) return jsonError(401, INVALID);

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email: body.data.email.trim().toLowerCase(),
      password: body.data.password,
    });
    if (error || !data.user) return jsonError(401, INVALID);

    // Cadastro aberto: a função declarada não decide quem entra. Quem tem conta, entra.
    await ensureProfile(getDatabase(), data.user.id);
    return jsonOk({ ok: true });
  });
}
