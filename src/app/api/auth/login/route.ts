import { z } from "zod";
import { getDatabase } from "@/lib/server/db/pg";
import { jsonError, jsonOk, parseBody, withErrors } from "@/lib/server/http";
import { findActor } from "@/lib/server/profile-service";
import { createSupabaseServerClient } from "@/lib/server/supabase-server";

const bodySchema = z.object({ email: z.email(), password: z.string().min(1).max(200) });
const INVALID = "E-mail ou senha incorretos.";

/** Login de professores, funcionários e administradores (e-mail + senha). */
export async function POST(request: Request) {
  return withErrors(async () => {
    const body = await parseBody(request, bodySchema);
    if (body.error) return jsonError(401, INVALID);

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email: body.data.email.trim().toLowerCase(), password: body.data.password });
    if (error || !data.user) return jsonError(401, INVALID);

    const actor = await findActor(getDatabase(), data.user.id);
    if (!actor || actor.role === "student") {
      await supabase.auth.signOut();
      return jsonError(401, INVALID);
    }
    return jsonOk({ ok: true });
  });
}
