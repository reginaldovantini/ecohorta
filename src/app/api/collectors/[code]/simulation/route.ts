import { simulationRequestSchema } from "@/lib/iot/api-schema";
import { authenticate } from "@/lib/server/auth";
import { getCollectorService } from "@/lib/server/collectors";
import { jsonError, jsonOk, parseBody, withErrors } from "@/lib/server/http";

/** Painel da simulação. Somente professores e administradores; recusado para captadores reais. */
export async function POST(request: Request, ctx: RouteContext<"/api/collectors/[code]/simulation">) {
  return withErrors(async () => {
    const auth = await authenticate();
    if (auth.response) return auth.response;
    const { code } = await ctx.params;
    const body = await parseBody(request, simulationRequestSchema);
    if (body.error) return body.error;

    const result = await getCollectorService().updateSimulation(auth.actor, code, body.data);
    return result.ok ? jsonOk({ settings: result.value }) : jsonError(result.status, result.message);
  });
}
