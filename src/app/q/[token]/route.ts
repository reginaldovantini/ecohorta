import { getDatabase } from "@/lib/server/db/pg";
import { scanCollector } from "@/lib/server/collector-registry";
import { authenticate } from "@/lib/server/auth";
import { withErrors } from "@/lib/server/http";

/**
 * Endereço que o QR do adesivo carrega.
 *
 * Quem lê com a câmera do celular cai aqui, muitas vezes sem o app aberto e às
 * vezes sem conta. Por isso esta rota redireciona em vez de responder JSON: do
 * outro lado está uma pessoa em pé na frente do tubo, não um programa.
 *
 * Quem ainda não entrou vai para o login levando o destino junto, e volta para
 * cá depois — a leitura não se perde no caminho.
 */
export async function GET(request: Request, ctx: RouteContext<"/q/[token]">) {
  return withErrors(async () => {
    const { token } = await ctx.params;
    const origin = new URL(request.url).origin;
    const paraLogin = () => {
      const destino = new URL("/entrar", origin);
      destino.searchParams.set("proximo", `/q/${token}`);
      return Response.redirect(destino, 303);
    };

    const auth = await authenticate();
    if (auth.response) return paraLogin();

    const leitura = await getDatabase().transaction((tx) => scanCollector(tx, auth.actor.profileId, token));
    if (!leitura) {
      const destino = new URL("/", origin);
      destino.searchParams.set("erro", "qr_desconhecido");
      return Response.redirect(destino, 303);
    }

    // A tela de missões sabe o que fazer com a leitura: destravar o captador e,
    // se houver missão em curso, autorizar a liberação.
    const destino = new URL("/missoes", origin);
    destino.searchParams.set("captador", leitura.code);
    destino.searchParams.set("leitura", leitura.scanId);
    if (leitura.joinedSchool) destino.searchParams.set("entrou", "1");
    return Response.redirect(destino, 303);
  });
}
