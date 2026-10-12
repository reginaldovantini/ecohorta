import { z } from "zod";
import { getDatabase } from "@/lib/server/db/pg";
import { jsonError, jsonOk, parseBody, withErrors } from "@/lib/server/http";
import { requestPartnership } from "@/lib/server/partnership-service";
import { UF_LIST } from "@/lib/server/school-registry";

/*
 * Candidatura de parceria — a única rota de escrita PÚBLICA da plataforma.
 *
 * É pública porque quem preenche ainda não tem conta: é um professor que viu o
 * projeto e quer montar um captador na escola dele. O pedido não concede nada,
 * e tudo que entra é validado aqui e de novo pelo banco.
 */
const bodySchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().min(5).max(160),
  jobTitle: z.string().trim().max(60).nullable().optional(),
  schoolName: z.string().trim().min(3).max(120),
  city: z.string().trim().min(2).max(80),
  state: z.enum(UF_LIST),
  message: z.string().trim().max(600).nullable().optional(),
});

export async function POST(request: Request) {
  return withErrors(async () => {
    const body = await parseBody(request, bodySchema);
    if (body.error) return body.error;
    const result = await requestPartnership(getDatabase(), body.data);
    return result.ok ? jsonOk({ ok: true }, 201) : jsonError(result.status, result.message);
  });
}
