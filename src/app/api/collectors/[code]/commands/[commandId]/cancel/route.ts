import { getCollectorService } from "@/lib/server/collectors";
import { jsonError, jsonOk } from "@/lib/server/http";

/** Pede o fechamento da válvula. Na fila, cancela na hora; em execução, o dispositivo confirma. */
export async function POST(_request: Request, ctx: RouteContext<"/api/collectors/[code]/commands/[commandId]/cancel">) {
  const { code, commandId } = await ctx.params;
  const result = getCollectorService().requestCancel(code, commandId);
  return result.ok ? jsonOk(result.value) : jsonError(result.status, result.message);
}
