import { z } from "zod";
import { authenticate } from "@/lib/server/auth";
import { getDatabase } from "@/lib/server/db/pg";
import { jsonError, jsonOk, parseBody, withErrors } from "@/lib/server/http";
import { approvePartnership, declinePartnership } from "@/lib/server/partnership-service";

const bodySchema = z.object({ decision: z.enum(["approve", "decline"]) });

/**
 * Responde o pedido.
 *
 * Aprovar cria a escola e autoriza o e-mail na mesma transação: separados,
 * sobraria a chance de autorizar alguém para uma escola que ninguém cadastrou.
 */
export async function PATCH(request: Request, ctx: RouteContext<"/api/admin/partnerships/[id]">) {
  return withErrors(async () => {
    const auth = await authenticate();
    if (auth.response) return auth.response;
    const body = await parseBody(request, bodySchema);
    if (body.error) return body.error;
    const { id } = await ctx.params;

    const db = getDatabase();
    const result =
      body.data.decision === "approve"
        ? await approvePartnership(db, auth.actor, id)
        : await declinePartnership(db, auth.actor, id);
    return result.ok ? jsonOk(result.value) : jsonError(result.status, result.message);
  });
}
