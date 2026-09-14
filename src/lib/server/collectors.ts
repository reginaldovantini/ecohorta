import { SIMULATED_COLLECTOR, SIMULATED_DEVICE_ID } from "@/lib/iot/simulation-config";
import { createCollectorService, type CollectorSeed, type CollectorService } from "./collector-service";

/** Escola do MVP. A estrutura (school_id em todas as entidades) já permite várias escolas. */
export const SCHOOL = { id: "school-clarinda", name: "EE Prof.ª Clarinda Mendes de Aquino" } as const;

/**
 * Captadores cadastrados. Nos Dias 6–7 esta lista vem das tabelas collectors/devices.
 * O EC-001 começa como SIMULADO; quando o ESP32 chegar, entra um registro com
 * isSimulated = false e o token próprio do dispositivo.
 */
const COLLECTOR_SEEDS: readonly CollectorSeed[] = [
  {
    info: SIMULATED_COLLECTOR,
    deviceId: SIMULATED_DEVICE_ID,
    isSimulated: true,
    tokenEnvVar: "IOT_SIMULATED_DEVICE_TOKEN",
  },
];

// Instância única que sobrevive ao recarregamento de módulos no desenvolvimento.
const globalStore = globalThis as typeof globalThis & { __ecohortaCollectors?: CollectorService };

export function getCollectorService() {
  globalStore.__ecohortaCollectors ??= createCollectorService({ seeds: COLLECTOR_SEEDS });
  return globalStore.__ecohortaCollectors;
}
