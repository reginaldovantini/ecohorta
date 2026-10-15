import { authenticate } from "@/lib/server/auth";
import { getDatabase } from "@/lib/server/db/pg";
import { toggleLike } from "@/lib/server/mission-wall";
import { jsonError, jsonOk, withErrors } from "@/lib/server/http";

/** Curtir ou descurtir. Curtida é reconhecimento: ela nunca vale ponto. */
export async function PUT(_request: Request, ctx: RouteContext<"/api/mural/[id]/like">) {
  return withErrors(async () => {
    const auth = await authenticate();
    if (auth.response) return auth.response;
    const { id } = await ctx.params;
    const result = await toggleLike(getDatabase(), auth.actor, id);
    return result.ok ? jsonOk(result.value) : jsonError(result.status, result.message);
  });
}
