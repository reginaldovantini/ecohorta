import { authenticate } from "@/lib/server/auth";
import { getCollectorSetupService } from "@/lib/server/collector-setup";
import { jsonError, jsonOk, withErrors } from "@/lib/server/http";

/*
 * Um código de responsável NOVO para este captador.
 *
 * POST, e não GET, porque isto não é uma consulta: emitir invalida o código
 * anterior no mesmo instante. Um link que fizesse isso ao ser visitado — ou
 * pré-carregado pelo navegador — inutilizaria o papel guardado dentro da caixa
 * eletrônica sem ninguém pedir.
 *
 * Não existe GET aqui, e nunca vai existir: o banco guarda só o hash do código.
 * Perder o papel significa emitir outro, não recuperar o antigo.
 */
export async function POST(_request: Request, ctx: RouteContext<"/api/admin/collectors/[code]/steward">) {
  return withErrors(async () => {
    const auth = await authenticate();
    if (auth.response) return auth.response;
    const pepper = process.env.IOT_TOKEN_PEPPER;
    if (!pepper || pepper.length < 32) return jsonError(503, "IOT_TOKEN_PEPPER não configurado no servidor.");

    const { code } = await ctx.params;
    const result = await getCollectorSetupService().reissueStewardCode(auth.actor, code, pepper);
    if (!result.ok) return jsonError(result.status, result.message);
    // O código em claro vai nesta resposta e em nenhum registro.
    return jsonOk(result.value);
  });
}
