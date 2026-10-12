import { z } from "zod";
import { MANUAL_STEPS } from "@/lib/collector/setup-journey";
import { authenticate } from "@/lib/server/auth";
import { getCollectorSetupService } from "@/lib/server/collector-setup";
import { jsonError, jsonOk, parseBody, withErrors } from "@/lib/server/http";

/**
 * A jornada de um captador em construção: as seis etapas, qual está acesa, o
 * material de cada uma e a frase do que fazer agora.
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/admin/collectors/[code]/setup">) {
  return withErrors(async () => {
    const auth = await authenticate();
    if (auth.response) return auth.response;
    const { code } = await ctx.params;
    const result = await getCollectorSetupService().journey(auth.actor, code);
    return result.ok ? jsonOk(result.value) : jsonError(result.status, result.message);
  });
}

/*
 * Marca uma etapa feita à mão.
 *
 * Só montagem e personalização: a plataforma não enxerga um tubo pintado, mas
 * enxerga perfeitamente se o sensor mediu. Conexão e calibração não têm botão —
 * e o serviço recusa, não só esta validação.
 */
const bodySchema = z.object({
  step: z.enum(MANUAL_STEPS),
  done: z.boolean(),
});

export async function POST(request: Request, ctx: RouteContext<"/api/admin/collectors/[code]/setup">) {
  return withErrors(async () => {
    const auth = await authenticate();
    if (auth.response) return auth.response;
    const body = await parseBody(request, bodySchema);
    if (body.error) return body.error;
    const { code } = await ctx.params;
    const result = await getCollectorSetupService().markStep(auth.actor, code, body.data.step, body.data.done);
    return result.ok ? jsonOk(result.value) : jsonError(result.status, result.message);
  });
}
