import { authenticate } from "@/lib/server/auth";
import { getDatabase } from "@/lib/server/db/pg";
import { revokeAdmin } from "@/lib/server/admin-grants";
import { jsonError, jsonOk, withErrors } from "@/lib/server/http";

/**
 * Revoga a autorização. A linha fica no banco com a data: o histórico de quem
 * teve acesso é parte da prestação de contas de um projeto com dados de menores.
 */
export async function DELETE(_request: Request, ctx: RouteContext<"/api/admin/grants/[email]">) {
  return withErrors(async () => {
    const auth = await authenticate();
    if (auth.response) return auth.response;
    const { email } = await ctx.params;
    const result = await revokeAdmin(getDatabase(), auth.actor, decodeURIComponent(email));
    return result.ok ? jsonOk({ ok: true }) : jsonError(result.status, result.message);
  });
}
