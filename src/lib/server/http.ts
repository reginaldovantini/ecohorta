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
