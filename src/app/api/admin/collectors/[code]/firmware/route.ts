import { z } from "zod";
import { authenticate } from "@/lib/server/auth";
import { getCollectorSetupService } from "@/lib/server/collector-setup";
import { jsonError, jsonOk, parseBody, publicBaseUrl, withErrors } from "@/lib/server/http";

/*
 * O programa daquele captador.
 *
 * POST, e não GET, porque isto NÃO é só uma leitura: gerar o arquivo cria um
 * token novo para a placa, e o anterior deixa de valer no mesmo instante. Um
 * link que faz isso ao ser visitado — ou pré-carregado pelo navegador — calaria
 * um captador em funcionamento sem ninguém pedir.
 *
 * Quando já existe placa enviando dados, o serviço recusa e exige
 * `confirmReplacement`: a tela pergunta antes, com todas as letras.
 */
const bodySchema = z.object({ confirmReplacement: z.boolean().optional() });

export async function POST(request: Request, ctx: RouteContext<"/api/admin/collectors/[code]/firmware">) {
  return withErrors(async () => {
    const auth = await authenticate();
    if (auth.response) return auth.response;
    const pepper = process.env.IOT_TOKEN_PEPPER;
    if (!pepper || pepper.length < 32) return jsonError(503, "IOT_TOKEN_PEPPER não configurado no servidor.");

    const body = await parseBody(request, bodySchema);
    if (body.error) return body.error;
    const { code } = await ctx.params;
    // Esta URL é gravada na placa: localhost, para o ESP32, é ele mesmo.
    const base = publicBaseUrl(request);
    if (base.error) return base.error;

    const result = await getCollectorSetupService().issueFirmware(auth.actor, code, {
      apiBaseUrl: base.url,
      pepper,
      confirmReplacement: body.data.confirmReplacement,
    });
    if (!result.ok) return jsonError(result.status, result.message);
    // O token em claro vai nesta resposta e em nenhum registro: o banco guarda só
    // o hash. Quem fechar a tela sem salvar o arquivo gera outro.
    return jsonOk(result.value);
  });
}
