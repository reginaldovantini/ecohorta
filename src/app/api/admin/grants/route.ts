import { z } from "zod";
import { authenticate } from "@/lib/server/auth";
import { getDatabase } from "@/lib/server/db/pg";
import { grantAdmin, listGrants } from "@/lib/server/admin-grants";
import { jsonError, jsonOk, parseBody, withErrors } from "@/lib/server/http";

/**
 * Autorizações de administração — quem pode cadastrar captadores, e de que escola.
 *
 * Só a administração da plataforma chega aqui, e o próprio serviço recusa: a
 * rota não é a única tranca, é a primeira.
 */
export async function GET() {
  return withErrors(async () => {
    const auth = await authenticate();
    if (auth.response) return auth.response;
    const result = await listGrants(getDatabase(), auth.actor);
    return result.ok ? jsonOk({ grants: result.value }) : jsonError(result.status, result.message);
  });
}

const bodySchema = z.object({
  email: z.string().trim().min(5).max(160),
  schoolId: z.string().uuid(),
  note: z.string().trim().max(200).nullable().optional(),
});

/** Autoriza um e-mail a administrar uma escola. Vale antes de a pessoa existir. */
export async function POST(request: Request) {
  return withErrors(async () => {
    const auth = await authenticate();
    if (auth.response) return auth.response;
    const body = await parseBody(request, bodySchema);
    if (body.error) return body.error;

    const result = await grantAdmin(getDatabase(), auth.actor, body.data);
    return result.ok ? jsonOk(result.value, 201) : jsonError(result.status, result.message);
  });
}
