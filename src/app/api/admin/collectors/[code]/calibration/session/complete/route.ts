import { authenticate } from "@/lib/server/auth";
import { getCalibrationService } from "@/lib/server/calibrations";
import { jsonError, jsonOk, withErrors } from "@/lib/server/http";

/** Conclui: calcula, valida e grava uma nova versão (ativa se consistente, recusada se não). */
export async function POST(_request: Request, ctx: RouteContext<"/api/admin/collectors/[code]/calibration/session/complete">) {
  return withErrors(async () => {
    const auth = await authenticate();
    if (auth.response) return auth.response;
    const { code } = await ctx.params;
    const result = await getCalibrationService().completeSession(auth.actor, code);
    return result.ok ? jsonOk(result.value) : jsonError(result.status, result.message);
  });
}
