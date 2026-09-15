import { authenticate } from "@/lib/server/auth";
import { getCollectorService } from "@/lib/server/collectors";
import { jsonError, jsonOk, withErrors } from "@/lib/server/http";

/** Pede o fechamento da válvula. Somente quem pediu ou educadores da escola. */
export async function POST(_request: Request, ctx: RouteContext<"/api/collectors/[code]/commands/[commandId]/cancel">) {
  return withErrors(async () => {
    const auth = await authenticate();
    if (auth.response) return auth.response;
    const { code, commandId } = await ctx.params;
    const result = await getCollectorService().requestCancel(auth.actor, code, commandId);
    return result.ok ? jsonOk(result.value) : jsonError(result.status, result.message);
  });
}
