import { telemetryPayloadSchema } from "@/lib/iot/api-schema";
import { getCollectorService } from "@/lib/server/collectors";
import { jsonError, jsonOk, readJson, validate, withErrors } from "@/lib/server/http";

/**
 * Dispositivo → plataforma. Autentica o dispositivo ANTES de validar o conteúdo,
 * grava a leitura e devolve o comando pendente e o próximo intervalo de envio.
 */
export async function POST(request: Request) {
  return withErrors(async () => {
    const body = await readJson(request);
    if (!body.ok) return body.response;

    const raw = (typeof body.value === "object" && body.value !== null ? body.value : {}) as Record<string, unknown>;
    const deviceKey = typeof raw.device_id === "string" ? raw.device_id : "";
    const collectorCode = typeof raw.collector_code === "string" ? raw.collector_code : undefined;

    const service = getCollectorService();
    const device = await service.authenticateDevice(request.headers.get("authorization"), deviceKey, collectorCode);
    if (!device) return jsonError(401, "Dispositivo não autorizado.");

    const payload = validate(telemetryPayloadSchema, body.value);
    if (payload.error) return payload.error;
    return jsonOk(await service.ingestTelemetry(device, payload.data));
  });
}
