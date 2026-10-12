import { isAdministrator } from "@/lib/server/actor";
import { authenticate } from "@/lib/server/auth";
import { getDatabase } from "@/lib/server/db/pg";
import { listSchools } from "@/lib/server/school-registry";
import { jsonError, jsonOk, withErrors } from "@/lib/server/http";

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
