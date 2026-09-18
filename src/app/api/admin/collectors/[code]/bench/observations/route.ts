import { benchObservationRequestSchema } from "@/lib/iot/api-schema";
import { authenticate } from "@/lib/server/auth";
import { getBenchService } from "@/lib/server/benches";
import { jsonError, jsonOk, parseBody, withErrors } from "@/lib/server/http";

/** Registra a leitura atual do sensor (estável ou não) com a condição do ensaio. Sem distância no corpo. */
export async function POST(request: Request, ctx: RouteContext<"/api/admin/collectors/[code]/bench/observations">) {
  return withErrors(async () => {
    const auth = await authenticate();
    if (auth.response) return auth.response;
    const { code } = await ctx.params;
    const body = await parseBody(request, benchObservationRequestSchema);
    if (body.error) return body.error;
    const result = await getBenchService().recordObservation(auth.actor, code, body.data);
    return result.ok ? jsonOk(result.value, 201) : jsonError(result.status, result.message);
  });
}
