import { getCollectorService } from "@/lib/server/collectors";
import { jsonError, jsonOk } from "@/lib/server/http";

export async function GET(_request: Request, ctx: RouteContext<"/api/collectors/[code]">) {
  const { code } = await ctx.params;
  const snapshot = getCollectorService().getSnapshot(code);
  return snapshot ? jsonOk(snapshot) : jsonError(404, "Captador não encontrado.");
}
