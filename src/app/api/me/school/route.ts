import { authenticate } from "@/lib/server/auth";
import { getDatabase } from "@/lib/server/db/pg";
import { jsonError, jsonOk, readJson, withErrors } from "@/lib/server/http";
import { getMe, switchSchool } from "@/lib/server/profile-service";

/**
 * Troca a escola em que a pessoa está jogando.
 *
 * Só entre as escolas a que ela já pertence. Entrar numa escola continua sendo
 * presencial: ler o QR de um captador de lá.
 */
export async function PUT(request: Request) {
  return withErrors(async () => {
    const auth = await authenticate();
    if (auth.response) return auth.response;
    const body = await readJson(request);
    if (!body.ok) return body.response;

    const schoolId = (body.value as { schoolId?: unknown })?.schoolId;
    const result = await switchSchool(getDatabase(), auth.actor, schoolId);
    if (!result.ok) return jsonError(result.status, result.message);

    // A escola mudou, então o perfil é relido: é ela que define o que o app mostra.
    const atualizado = await authenticate();
    return atualizado.response ?? jsonOk(await getMe(getDatabase(), atualizado.actor));
  });
}
