import { authenticate } from "@/lib/server/auth";
import { getCalibrationService } from "@/lib/server/calibrations";
import { jsonError, jsonOk, withErrors } from "@/lib/server/http";

/** Inicia um novo procedimento de calibração (o anterior não concluído é cancelado, nunca apagado). */
export async function POST(_request: Request, ctx: RouteContext<"/api/admin/collectors/[code]/calibration/session">) {
  return withErrors(async () => {
    const auth = await authenticate();
    if (auth.response) return auth.response;
    const { code } = await ctx.params;
    const result = await getCalibrationService().startSession(auth.actor, code);
    return result.ok ? jsonOk(result.value, 201) : jsonError(result.status, result.message);
  });
}

/** Cancela o procedimento em andamento. */
export async function DELETE(_request: Request, ctx: RouteContext<"/api/admin/collectors/[code]/calibration/session">) {
  return withErrors(async () => {
    const auth = await authenticate();
    if (auth.response) return auth.response;
    const { code } = await ctx.params;
    const result = await getCalibrationService().cancelSession(auth.actor, code);
    return result.ok ? jsonOk(result.value) : jsonError(result.status, result.message);
  });
}
