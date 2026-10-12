import { z } from "zod";
import { isPlatformAdmin } from "@/lib/server/actor";
import { authenticate } from "@/lib/server/auth";
import { getDatabase } from "@/lib/server/db/pg";
import { isUniqueViolation } from "@/lib/server/db/types";
import { jsonError, jsonOk, parseBody, withErrors } from "@/lib/server/http";
import { updateSchool, UF_LIST } from "@/lib/server/school-registry";

const bodySchema = z.object({
  name: z.string().trim().min(3).max(120),
  city: z.string().trim().min(2).max(80),
  state: z.enum(UF_LIST),
});

/**
 * Corrige nome, município e estado de uma escola.
 *
 * Só a administração da plataforma: é ela que define município e estado em um
 * lugar só, para o indicador de replicabilidade não nascer com três grafias da
 * mesma cidade.
 */
export async function PATCH(request: Request, ctx: RouteContext<"/api/admin/schools/[schoolId]">) {
  return withErrors(async () => {
    const auth = await authenticate();
    if (auth.response) return auth.response;
    if (!isPlatformAdmin(auth.actor)) return jsonError(403, "Somente a administração da plataforma edita escolas.");

    const body = await parseBody(request, bodySchema);
    if (body.error) return body.error;
    const { schoolId } = await ctx.params;

    try {
      return jsonOk(await getDatabase().transaction((tx) => updateSchool(tx, schoolId, body.data)));
    } catch (error) {
      if (isUniqueViolation(error)) return jsonError(409, "Já existe uma escola com este nome.");
      return jsonError(422, error instanceof Error ? error.message : "Não foi possível salvar a escola.");
    }
  });
}
