import { authenticate } from "@/lib/server/auth";
import { getDatabase } from "@/lib/server/db/pg";
import { jsonOk, withErrors } from "@/lib/server/http";
import { getRanking } from "@/lib/server/ranking-service";

/**
 * Impacto coletivo, ranking de escolas e de colegas.
 * Tudo calculado no servidor a partir da água MEDIDA pelo sensor.
 */
export async function GET() {
  return withErrors(async () => {
    const auth = await authenticate();
    if (auth.response) return auth.response;
    return jsonOk(await getRanking(getDatabase(), auth.actor));
  });
}
