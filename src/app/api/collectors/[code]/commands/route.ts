import { dispenseRequestSchema } from "@/lib/iot/api-schema";
import { authenticate } from "@/lib/server/auth";
import { getCollectorService } from "@/lib/server/collectors";
import { jsonError, jsonOk, parseBody, withErrors } from "@/lib/server/http";

/**
 * App → plataforma: pede uma liberação para uma missão. Exige login.
 * O volume vem da missão (servidor). Idempotente por command_id.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/collectors/[code]/commands">) {
  return withErrors(async () => {
    const auth = await authenticate();
    if (auth.response) return auth.response;
    const { code } = await ctx.params;
    const body = await parseBody(request, dispenseRequestSchema);
    if (body.error) return body.error;

    const result = await getCollectorService().requestDispense(auth.actor, code, body.data);
    return result.ok ? jsonOk(result.value, 201) : jsonError(result.status, result.message);
  });
}
