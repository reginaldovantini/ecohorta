import { authenticate } from "@/lib/server/auth";
import { getCollectorService } from "@/lib/server/collectors";
import { jsonError, jsonOk, withErrors } from "@/lib/server/http";

export async function GET(_request: Request, ctx: RouteContext<"/api/collectors/[code]">) {
  return withErrors(async () => {
    const auth = await authenticate();
    if (auth.response) return auth.response;
    const { code } = await ctx.params;
    const snapshot = await getCollectorService().getSnapshot(auth.actor, code);
    return snapshot ? jsonOk(snapshot) : jsonError(404, "Captador não encontrado.");
  });
}
