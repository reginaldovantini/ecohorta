import { authenticate } from "@/lib/server/auth";
import { getDatabase } from "@/lib/server/db/pg";
import { pushConfigured, removeSubscription, saveSubscription } from "@/lib/server/notifications";
import { jsonError, jsonOk, readJson, withErrors } from "@/lib/server/http";

/*
 * Inscrever e desinscrever este aparelho nos avisos.
 *
 * O endereço do serviço de push identifica o APARELHO, não a pessoa: alguém
 * com celular e computador tem dois, e cada um se inscreve e se desinscreve
 * sozinho.
 */
export async function POST(request: Request) {
  return withErrors(async () => {
    const auth = await authenticate();
    if (auth.response) return auth.response;
    if (!pushConfigured()) return jsonError(503, "As notificações ainda não foram configuradas no servidor.");

    const body = await readJson(request);
    if (!body.ok) return body.response;
    const result = await saveSubscription(getDatabase(), auth.actor, body.value);
    return result.ok ? jsonOk({ subscribed: true }, 201) : jsonError(result.status, result.message);
  });
}

export async function DELETE(request: Request) {
  return withErrors(async () => {
    const auth = await authenticate();
    if (auth.response) return auth.response;
    const body = await readJson(request);
    if (!body.ok) return body.response;
    const result = await removeSubscription(getDatabase(), auth.actor, (body.value as { endpoint?: unknown })?.endpoint);
    return result.ok ? jsonOk({ subscribed: false }) : jsonError(result.status, result.message);
  });
}
