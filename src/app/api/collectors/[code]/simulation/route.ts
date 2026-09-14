import { simulationRequestSchema } from "@/lib/iot/api-schema";
import { getCollectorService } from "@/lib/server/collectors";
import { jsonError, jsonOk, parseBody } from "@/lib/server/http";

/** Painel da simulação → plataforma. Recusado para captadores reais. */
export async function POST(request: Request, ctx: RouteContext<"/api/collectors/[code]/simulation">) {
  const { code } = await ctx.params;
  const body = await parseBody(request, simulationRequestSchema);
  if (body.error) return body.error;

  const result = getCollectorService().updateSimulation(code, body.data);
  return result.ok ? jsonOk({ settings: result.value }) : jsonError(result.status, result.message);
}
