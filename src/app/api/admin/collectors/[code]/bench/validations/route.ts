import { calibrationValidationRequestSchema } from "@/lib/iot/api-schema";
import { authenticate } from "@/lib/server/auth";
import { getBenchService } from "@/lib/server/benches";
import { jsonError, jsonOk, parseBody, withErrors } from "@/lib/server/http";

/**
 * Validação experimental: o corpo traz só o volume físico conhecido.
 * Distância e volume calculado vêm do servidor; a calibração não é alterada.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/admin/collectors/[code]/bench/validations">) {
  return withErrors(async () => {
    const auth = await authenticate();
    if (auth.response) return auth.response;
    const { code } = await ctx.params;
    const body = await parseBody(request, calibrationValidationRequestSchema);
    if (body.error) return body.error;
    const result = await getBenchService().recordValidation(auth.actor, code, body.data);
    return result.ok ? jsonOk(result.value, 201) : jsonError(result.status, result.message);
  });
}
