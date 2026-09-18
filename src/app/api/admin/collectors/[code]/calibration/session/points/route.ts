import { calibrationPointRequestSchema } from "@/lib/iot/api-schema";
import { authenticate } from "@/lib/server/auth";
import { getCalibrationService } from "@/lib/server/calibrations";
import { jsonError, jsonOk, parseBody, withErrors } from "@/lib/server/http";

/**
 * Registra uma etapa ({ step }). O corpo NÃO traz distância nem volume:
 * o servidor usa a leitura estabilizada do sensor e recusa (409) se ainda não estiver estável.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/admin/collectors/[code]/calibration/session/points">) {
  return withErrors(async () => {
    const auth = await authenticate();
    if (auth.response) return auth.response;
    const { code } = await ctx.params;
    const body = await parseBody(request, calibrationPointRequestSchema);
    if (body.error) return body.error;
    const result = await getCalibrationService().registerPoint(auth.actor, code, body.data.step);
    return result.ok ? jsonOk(result.value) : jsonError(result.status, result.message);
  });
}
