import { authenticate } from "@/lib/server/auth";
import { getBenchService } from "@/lib/server/benches";
import { jsonError, jsonOk, withErrors } from "@/lib/server/http";

/** Bancada: diagnóstico ao vivo do sensor, observações e validações. Professores e administradores. */
export async function GET(_request: Request, ctx: RouteContext<"/api/admin/collectors/[code]/bench">) {
  return withErrors(async () => {
    const auth = await authenticate();
    if (auth.response) return auth.response;
    const { code } = await ctx.params;
    const result = await getBenchService().getView(auth.actor, code);
    return result.ok ? jsonOk(result.value) : jsonError(result.status, result.message);
  });
}

/** Inicia o ensaio de bancada. */
export async function POST(_request: Request, ctx: RouteContext<"/api/admin/collectors/[code]/bench">) {
  return withErrors(async () => {
    const auth = await authenticate();
    if (auth.response) return auth.response;
    const { code } = await ctx.params;
    const result = await getBenchService().startBench(auth.actor, code);
    return result.ok ? jsonOk(result.value, 201) : jsonError(result.status, result.message);
  });
}

/** Encerra o ensaio de bancada. */
export async function DELETE(_request: Request, ctx: RouteContext<"/api/admin/collectors/[code]/bench">) {
  return withErrors(async () => {
    const auth = await authenticate();
    if (auth.response) return auth.response;
    const { code } = await ctx.params;
    const result = await getBenchService().endBench(auth.actor, code);
    return result.ok ? jsonOk(result.value) : jsonError(result.status, result.message);
  });
}
