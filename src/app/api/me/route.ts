import { authenticate } from "@/lib/server/auth";
import { getDatabase } from "@/lib/server/db/pg";
import { jsonError, jsonOk, readJson, withErrors } from "@/lib/server/http";
import { getMe, updateIdentity } from "@/lib/server/profile-service";

/** Perfil, XP e histórico do usuário autenticado — calculados no servidor. */
export async function GET() {
  return withErrors(async () => {
    const auth = await authenticate();
    if (auth.response) return auth.response;
    return jsonOk(await getMe(getDatabase(), auth.actor));
  });
}

/** O próprio usuário define apelido e avatar. */
export async function PATCH(request: Request) {
  return withErrors(async () => {
    const auth = await authenticate();
    if (auth.response) return auth.response;
    const body = await readJson(request);
    if (!body.ok) return body.response;
    const result = await updateIdentity(getDatabase(), auth.actor, body.value);
    return result.ok ? jsonOk(await getMe(getDatabase(), auth.actor)) : jsonError(result.status, result.message);
  });
}
