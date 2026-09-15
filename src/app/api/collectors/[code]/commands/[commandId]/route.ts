import { authenticate } from "@/lib/server/auth";
import { getCollectorService } from "@/lib/server/collectors";
import { jsonError, jsonOk, withErrors } from "@/lib/server/http";

/** Andamento do comando: visível a quem pediu e a educadores da escola. */
export async function GET(_request: Request, ctx: RouteContext<"/api/collectors/[code]/commands/[commandId]">) {
  return withErrors(async () => {
    const auth = await authenticate();
    if (auth.response) return auth.response;
    const { code, commandId } = await ctx.params;
    const progress = await getCollectorService().getProgress(auth.actor, code, commandId);
    return progress ? jsonOk(progress) : jsonError(404, "Comando não encontrado.");
  });
}
