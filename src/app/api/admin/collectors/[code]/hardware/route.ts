import { hardwareChangeRequestSchema } from "@/lib/iot/api-schema";
import { authenticate } from "@/lib/server/auth";
import { getHardwareService } from "@/lib/server/hardware";
import { jsonError, jsonOk, parseBody, withErrors } from "@/lib/server/http";

/** Ligações: configuração de hardware, sensor reportado pelo firmware e histórico. Professores e administradores. */
export async function GET(_request: Request, ctx: RouteContext<"/api/admin/collectors/[code]/hardware">) {
  return withErrors(async () => {
    const auth = await authenticate();
    if (auth.response) return auth.response;
    const { code } = await ctx.params;
    const result = await getHardwareService().getView(auth.actor, code);
    return result.ok ? jsonOk(result.value) : jsonError(result.status, result.message);
  });
}

/** Troca o sensor de distância. Exige confirm_physical_match = true. */
export async function PUT(request: Request, ctx: RouteContext<"/api/admin/collectors/[code]/hardware">) {
  return withErrors(async () => {
    const auth = await authenticate();
    if (auth.response) return auth.response;
    const body = await parseBody(request, hardwareChangeRequestSchema);
    if (body.error) return body.error;
    const { code } = await ctx.params;
    const result = await getHardwareService().changeSensor(auth.actor, code, {
      distanceSensor: body.data.distance_sensor,
      confirmPhysicalMatch: body.data.confirm_physical_match,
      note: body.data.note,
    });
    return result.ok ? jsonOk(result.value) : jsonError(result.status, result.message);
  });
}
