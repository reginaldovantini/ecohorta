import type { CollectorInfo, SimulationSettings } from "./types";
import type { VirtualDeviceConfig } from "./virtual-device";

/*
 * Captador SIM-001 em modo SIMULAÇÃO (is_simulated = true).
 * EC-001 é o captador FÍSICO (ESP32 + VL53L0X ou VL53L1X); SIM-001 existe só para testes e demonstração.
 *
 * Os valores são plausíveis para um tubo vertical estreito (DN100 ≈ 78,5 cm²
 * de seção: 12 L ≈ 1,53 m de coluna), mas NÃO são medições. Substituir pela
 * calibração e pelo teste de vazão do captador real (docs/HARDWARE.md).
 */

export const SIMULATED_COLLECTOR: CollectorInfo = {
  id: "sim-001",
  code: "SIM-001",
  name: "Captador virtual",
  location: "Simulação",
  capacityLiters: 12,
  reserveLiters: 0.5,
  valveKind: "undefined",
};

export const SIMULATED_DEVICE_ID = "VIRTUAL-001";

export const VIRTUAL_DEVICE_CONFIG: VirtualDeviceConfig = {
  capacityLiters: SIMULATED_COLLECTOR.capacityLiters,
  reserveLiters: SIMULATED_COLLECTOR.reserveLiters,
  sensorToFullMm: 60,
  usableHeightMm: 1529,
  outflowAtFullLpm: 2.4,
  sensorNoiseMm: 2,
  valveCloseLatencyMs: 300,
  settleMs: 2200,
  noFlowTimeoutMs: 6000,
  maxDispenseMs: 240_000,
};

export const TIME_SCALES = [1, 30, 120] as const;

export const DEFAULT_SIMULATION_SETTINGS: SimulationSettings = {
  timeScale: 1,
  inflowEnabled: true,
  inflowLitersPerHour: 1.2,
  faultNoFlow: false,
  offline: false,
};
