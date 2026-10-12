import { authenticate } from "@/lib/server/auth";
import { getDatabase } from "@/lib/server/db/pg";
import { jsonError, jsonOk, withErrors } from "@/lib/server/http";
import { listPartnershipRequests } from "@/lib/server/partnership-service";

/** Pedidos de parceria, pendentes primeiro. Administração da plataforma. */
export async function GET() {
  return withErrors(async () => {
    const auth = await authenticate();
    if (auth.response) return auth.response;
    const result = await listPartnershipRequests(getDatabase(), auth.actor);
    return result.ok ? jsonOk({ requests: result.value }) : jsonError(result.status, result.message);
  });
}
