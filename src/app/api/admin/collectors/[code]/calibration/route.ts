import { authenticate } from "@/lib/server/auth";
import { getCalibrationService } from "@/lib/server/calibrations";
import { jsonError, jsonOk, withErrors } from "@/lib/server/http";

/**
 * Tela de calibração: leitura ao vivo (estabilizada), procedimento em andamento e versões.
 * Somente professores e administradores. Mantém o dispositivo enviando leituras a cada 1 s.
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/admin/collectors/[code]/calibration">) {
  return withErrors(async () => {
    const auth = await authenticate();
    if (auth.response) return auth.response;
    const { code } = await ctx.params;
    const result = await getCalibrationService().getView(auth.actor, code);
    return result.ok ? jsonOk(result.value) : jsonError(result.status, result.message);
  });
}
