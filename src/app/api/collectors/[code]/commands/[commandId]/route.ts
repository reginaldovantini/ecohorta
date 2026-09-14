import { getCollectorService } from "@/lib/server/collectors";
import { jsonError, jsonOk } from "@/lib/server/http";

export async function GET(_request: Request, ctx: RouteContext<"/api/collectors/[code]/commands/[commandId]">) {
  const { code, commandId } = await ctx.params;
  const progress = getCollectorService().getProgress(code, commandId);
  return progress ? jsonOk(progress) : jsonError(404, "Comando não encontrado.");
}
