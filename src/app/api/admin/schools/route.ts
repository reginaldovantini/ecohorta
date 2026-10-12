import { z } from "zod";
import { isAdministrator, isPlatformAdmin } from "@/lib/server/actor";
import { authenticate } from "@/lib/server/auth";
import { getDatabase } from "@/lib/server/db/pg";
import { listSchools, registerSchool, UF_LIST } from "@/lib/server/school-registry";
import { jsonError, jsonOk, parseBody, withErrors } from "@/lib/server/http";

/**
 * Escolas da plataforma, para o cadastro de um captador escolher onde ele fica.
 *
 * Traz quantos captadores de cada escola já medem de verdade e quantos ainda são
 * protótipos: é o retrato da rede, e o que evita cadastrar a mesma escola duas
 * vezes com nomes parecidos.
 */
export async function GET() {
  return withErrors(async () => {
    const auth = await authenticate();
    if (auth.response) return auth.response;
    if (!isAdministrator(auth.actor)) return jsonError(403, "Somente a administração cadastra captadores.");
    return jsonOk({ schools: await listSchools(getDatabase()) });
  });
}

const schoolSchema = z.object({
  name: z.string().trim().min(3).max(120),
  city: z.string().trim().min(2).max(80),
  state: z.enum(UF_LIST),
});

/**
 * Cria a escola. Só a administração da plataforma: é ela que define município e
 * estado, e é disso que sai "27 captadores em 9 municípios" — deixar cada escola
 * digitar o próprio município encheria a base de "três lagoas", "Três Lagoas/MS" e
 * "3 lagoas", e o indicador morreria na origem.
 */
export async function POST(request: Request) {
  return withErrors(async () => {
    const auth = await authenticate();
    if (auth.response) return auth.response;
    if (!isPlatformAdmin(auth.actor)) return jsonError(403, "Somente a administração da plataforma cria escolas.");

    const body = await parseBody(request, schoolSchema);
    if (body.error) return body.error;
    try {
      const escola = await getDatabase().transaction((tx) => registerSchool(tx, body.data));
      return jsonOk(escola, 201);
    } catch (error) {
      return jsonError(422, error instanceof Error ? error.message : "Não foi possível cadastrar a escola.");
    }
  });
}
