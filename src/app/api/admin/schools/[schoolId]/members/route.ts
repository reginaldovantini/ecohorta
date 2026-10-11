import { authenticate } from "@/lib/server/auth";
import { getDatabase } from "@/lib/server/db/pg";
import { jsonError, jsonOk, readJson, withErrors } from "@/lib/server/http";
import { addSchoolMember } from "@/lib/server/profile-service";

/**
 * Administração vincula uma pessoa a uma escola — o caso que a leitura do QR não
 * cobre: quem se transfere e precisa de acesso antes de pisar na escola nova.
 *
 * Dá acesso à escola, não ao captador: ele continua apagado até a primeira leitura.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/admin/schools/[schoolId]/members">) {
  return withErrors(async () => {
    const auth = await authenticate();
    if (auth.response) return auth.response;
    const body = await readJson(request);
    if (!body.ok) return body.response;

    const { schoolId } = await ctx.params;
    const profileId = (body.value as { profileId?: unknown })?.profileId;
    if (typeof profileId !== "string") return jsonError(422, "Informe quem será vinculado.");

    const result = await addSchoolMember(getDatabase(), auth.actor, { profileId, schoolId });
    return result.ok ? jsonOk({ ok: true }, 201) : jsonError(result.status, result.message);
  });
}
