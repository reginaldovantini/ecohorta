import { authenticate } from "@/lib/server/auth";
import { getDatabase } from "@/lib/server/db/pg";
import { reportPost } from "@/lib/server/mission-wall";
import { jsonError, jsonOk, readJson, withErrors } from "@/lib/server/http";

/**
 * Denúncia: tira do mural AGORA e devolve a decisão a um responsável.
 * Remover primeiro é a ordem certa quando o conteúdo é visto por escolas inteiras.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/mural/[id]/report">) {
  return withErrors(async () => {
    const auth = await authenticate();
    if (auth.response) return auth.response;
    const body = await readJson(request);
    if (!body.ok) return body.response;
    const { id } = await ctx.params;
    const result = await reportPost(getDatabase(), auth.actor, id, (body.value as { reason?: unknown })?.reason);
    return result.ok ? jsonOk({ hidden: true }) : jsonError(result.status, result.message);
  });
}
