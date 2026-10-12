import type { z } from "zod";
import { ConfigError } from "./errors";

export function jsonError(status: number, message: string) {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

export function jsonOk(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** Erros inesperados viram 500 genérico (detalhes só no log); configuração ausente vira 503. */
export async function withErrors(handler: () => Promise<Response>): Promise<Response> {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof ConfigError) return jsonError(503, error.message);
    console.error("[api]", error);
    return jsonError(500, "Erro interno. Tente novamente.");
  }
}

export async function readJson(request: Request): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> {
  try {
    return { ok: true, value: await request.json() };
  } catch {
    return { ok: false, response: jsonError(400, "Corpo JSON inválido.") };
  }
}

export function validate<T extends z.ZodType>(schema: T, value: unknown): { data: z.infer<T>; error?: never } | { data?: never; error: Response } {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    return { error: jsonError(422, parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")) };
  }
  return { data: parsed.data };
}

/** Lê e valida o corpo JSON. Retorna a resposta de erro pronta quando inválido. */
export async function parseBody<T extends z.ZodType>(
  request: Request,
  schema: T,
): Promise<{ data: z.infer<T>; error?: never } | { data?: never; error: Response }> {
  const body = await readJson(request);
  if (!body.ok) return { error: body.response };
  return validate(schema, body.value);
}

/*
 * A URL pública da plataforma — e por que ela não pode ser `localhost`.
 *
 * Esta URL não fica só no navegador. Ela é gravada em duas coisas que saem do
 * computador e não voltam:
 *
 *   o QR do adesivo, impresso em vinil e colado num tubo de PVC;
 *   o `secrets.h` de um ESP32, que depois é gravado na placa.
 *
 * Gerar qualquer um dos dois a partir do preview local produziria um adesivo com
 * `http://localhost:3000` dentro — que não abre em celular nenhum — e uma placa
 * que nunca alcança a plataforma, porque `localhost`, para o ESP32, é ele mesmo.
 * São erros que só aparecem depois da gráfica e da gravação. Melhor recusar.
 */

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "0.0.0.0", "[::1]", "::1"];

/**
 * Base para artefatos permanentes (QR impresso, firmware gravado).
 * `NEXT_PUBLIC_APP_URL` quando definida; senão a origem da requisição.
 */
export function publicBaseUrl(request: Request): { url: string; error?: never } | { url?: never; error: Response } {
  const raw = (process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/$/, "");
  let host: string;
  try {
    host = new URL(raw).hostname;
  } catch {
    return { error: jsonError(503, `NEXT_PUBLIC_APP_URL inválida no servidor: "${raw}".`) };
  }
  if (LOCAL_HOSTS.includes(host)) {
    return {
      error: jsonError(
        503,
        "A plataforma está respondendo em localhost. O QR do adesivo e o programa do ESP32 levam esta URL para " +
          "dentro do vinil e da placa, então defina NEXT_PUBLIC_APP_URL com o endereço público antes de gerar.",
      ),
    };
  }
  return { url: raw };
}
