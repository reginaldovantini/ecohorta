import type { z } from "zod";

export function jsonError(status: number, message: string) {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

export function jsonOk(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** Lê e valida o corpo JSON. Retorna a resposta de erro pronta quando inválido. */
export async function parseBody<T extends z.ZodType>(
  request: Request,
  schema: T,
): Promise<{ data: z.infer<T>; error?: never } | { data?: never; error: Response }> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { error: jsonError(400, "Corpo JSON inválido.") };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { error: jsonError(422, parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")) };
  }
  return { data: parsed.data };
}
