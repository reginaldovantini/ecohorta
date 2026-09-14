import { dispenseRequestSchema } from "@/lib/iot/api-schema";
import { getCollectorService } from "@/lib/server/collectors";
import { jsonError, jsonOk, parseBody } from "@/lib/server/http";

/**
 * App → plataforma: pede uma liberação. A plataforma valida disponibilidade e
 * exclusividade; o dispositivo busca o comando na próxima telemetria.
 * Idempotente por command_id.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/collectors/[code]/commands">) {
  const { code } = await ctx.params;
  const body = await parseBody(request, dispenseRequestSchema);
  if (body.error) return body.error;

  const result = getCollectorService().requestDispense(code, body.data);
  return result.ok ? jsonOk(result.value, 201) : jsonError(result.status, result.message);
}
