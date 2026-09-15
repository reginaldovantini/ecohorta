import { z } from "zod";
import { normalizeAccessCode, pinSchema, studentEmail } from "@/lib/users/access";
import { getDatabase } from "@/lib/server/db/pg";
import { jsonError, jsonOk, parseBody, withErrors } from "@/lib/server/http";
import { findActor } from "@/lib/server/profile-service";
import { createSupabaseServerClient } from "@/lib/server/supabase-server";

const bodySchema = z.object({ code: z.string().min(4).max(20), pin: pinSchema });
const INVALID = "Código ou PIN incorretos.";

/** Login do estudante: código de acesso + PIN (sem e-mail pessoal). */
export async function POST(request: Request) {
  return withErrors(async () => {
    const body = await parseBody(request, bodySchema);
    if (body.error) return jsonError(401, INVALID);

    const code = normalizeAccessCode(body.data.code);
    if (!code) return jsonError(401, INVALID);

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email: studentEmail(code), password: body.data.pin });
    if (error || !data.user) return jsonError(401, INVALID);

    const actor = await findActor(getDatabase(), data.user.id);
    if (!actor || actor.role !== "student") {
      await supabase.auth.signOut();
      return jsonError(401, INVALID);
    }
    return jsonOk({ ok: true });
  });
}
