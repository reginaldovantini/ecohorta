import { authenticate } from "@/lib/server/auth";
import { getCollectorService } from "@/lib/server/collectors";
import { jsonOk, withErrors } from "@/lib/server/http";

/** Captadores da escola do usuário autenticado. */
export async function GET() {
  return withErrors(async () => {
    const auth = await authenticate();
    if (auth.response) return auth.response;
    return jsonOk({ collectors: await getCollectorService().listCollectors(auth.actor) });
  });
}
