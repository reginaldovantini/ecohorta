import type { NextRequest } from "next/server";
import { getCollectorService } from "@/lib/server/collectors";
import { jsonError, jsonOk, withErrors } from "@/lib/server/http";

/**
 * Canal de controle do dispositivo VIRTUAL enquanto ele simula estar offline
 * (sem enviar telemetria). Dispositivos reais não usam esta rota.
 */
export async function GET(request: NextRequest) {
  return withErrors(async () => {
    const deviceKey = request.nextUrl.searchParams.get("device_id") ?? "";
    const applied = Number(request.nextUrl.searchParams.get("applied_action_id") ?? "0");

    const service = getCollectorService();
    const device = await service.authenticateDevice(request.headers.get("authorization"), deviceKey);
    if (!device) return jsonError(401, "Dispositivo não autorizado.");

    const simulation = await service.deviceSimulationState(device, Number.isFinite(applied) ? applied : 0);
    if (!simulation) return jsonError(403, "Dispositivo não é simulado.");
    return jsonOk({ simulation });
  });
}
