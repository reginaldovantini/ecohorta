import { telemetryPayloadSchema } from "@/lib/iot/api-schema";
import { getCollectorService } from "@/lib/server/collectors";
import { jsonError, jsonOk, parseBody } from "@/lib/server/http";

/**
 * Dispositivo → plataforma. Recebe a leitura e devolve, na mesma resposta,
 * o comando pendente (liberar/cancelar) e o próximo intervalo de envio.
 */
export async function POST(request: Request) {
  const body = await parseBody(request, telemetryPayloadSchema);
  if (body.error) return body.error;

  const service = getCollectorService();
  const code = service.authenticateDevice(request.headers.get("authorization"), body.data.device_id, body.data.collector_code);
  if (!code) return jsonError(401, "Dispositivo não autorizado.");

  return jsonOk(service.ingestTelemetry(code, body.data));
}
