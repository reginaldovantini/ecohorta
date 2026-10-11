import { scanCollector } from "@/lib/server/collector-registry";
import { authenticate } from "@/lib/server/auth";
import { getDatabase } from "@/lib/server/db/pg";
import { jsonError, jsonOk, readJson, withErrors } from "@/lib/server/http";

/**
 * Leitura feita pela câmera DENTRO do app, no meio de uma missão.
 *
 * Devolve a leitura registrada para a missão usá-la como prova de presença. O
 * servidor é quem decide se ela vale — pessoa, captador, validade e uso único
 * são conferidos na hora de abrir a válvula, não aqui.
 */
export async function POST(request: Request) {
  return withErrors(async () => {
    const auth = await authenticate();
    if (auth.response) return auth.response;
    const body = await readJson(request);
    if (!body.ok) return body.response;

    const token = (body.value as { token?: unknown })?.token;
    if (typeof token !== "string") return jsonError(422, "Leitura inválida.");

    const leitura = await getDatabase().transaction((tx) => scanCollector(tx, auth.actor.profileId, token));
    if (!leitura) return jsonError(404, "QR Code não reconhecido. Confira se é o adesivo de um captador.");

    return jsonOk({
      scanId: leitura.scanId,
      collectorCode: leitura.code,
      location: leitura.location,
      joinedSchool: leitura.joinedSchool,
    }, 201);
  });
}
