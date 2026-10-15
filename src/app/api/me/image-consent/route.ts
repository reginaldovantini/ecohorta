import { setImageConsent } from "@/lib/server/profile-service";
import { authenticate } from "@/lib/server/auth";
import { getDatabase } from "@/lib/server/db/pg";
import { jsonError, jsonOk, readJson, withErrors } from "@/lib/server/http";

/*
 * Autorizar ou retirar o uso da imagem no mural.
 *
 * Só a própria pessoa decide sobre a própria imagem: a rota age sempre sobre
 * quem está autenticado, e não aceita um identificador de outra pessoa.
 *
 * Retirar não apaga o histórico — a linha fica com a data da retirada. O que
 * some é a permissão de publicar daqui para a frente.
 */
export async function PUT(request: Request) {
  return withErrors(async () => {
    const auth = await authenticate();
    if (auth.response) return auth.response;

    const body = await readJson(request);
    if (!body.ok) return body.response;
    const allowed = (body.value as { allowed?: unknown })?.allowed;

    const result = await setImageConsent(getDatabase(), auth.actor, allowed);
    return result.ok ? jsonOk({ imageConsent: result.value }) : jsonError(result.status, result.message);
  });
}
