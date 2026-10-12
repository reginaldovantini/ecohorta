import type { CollectorInfo, SimulationSettings } from "./types";
import type { VirtualDeviceConfig } from "./virtual-device";

/*
 * Captador SIM-001 em modo SIMULAÇÃO (is_simulated = true).
 * ECO-001 é o captador FÍSICO (ESP32 + VL53L0X ou VL53L1X); SIM-001 existe só para testes e demonstração.
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
  /*
   * Saída por gravidade com o registro bem aberto, como uma torneira: a vazão cai com
   * a altura da coluna (Torricelli, ∝ √nível), então com o tubo cheio sai mais rápido.
   * 30 L/min no cheio dá ~6 s para 3 L com o tubo cheio, ~10 s pela metade e ~14 s
   * quase vazio — o tempo que o estudante vê o regador enchendo.
   * NÃO é medição: o teste de vazão do captador real (docs/HARDWARE.md) e a válvula
   * ainda por escolher é que definem o valor verdadeiro.
   */
  outflowAtFullLpm: 30,
  sensorNoiseMm: 2,
  valveCloseLatencyMs: 300,
  settleMs: 2200,
  noFlowTimeoutMs: 6000,
  maxDispenseMs: 240_000,
};

export const TIME_SCALES = [1, 30, 120] as const;

/** Ritmo real de um split doméstico em dia úmido. Os demais presets aceleram a demonstração. */
export const REAL_CONDENSATE_LITERS_PER_HOUR = 1.2;

/*
 * Entrada de condensado do painel, em L/h. O primeiro é o ritmo real; os outros existem
 * para a demonstração encher o tubo e liberar missões em minutos, não em horas.
 * O painel marca qual é qual — nenhum deles é medição.
 */
export const INFLOW_PRESETS = [REAL_CONDENSATE_LITERS_PER_HOUR, 12, 60] as const;

export const DEFAULT_SIMULATION_SETTINGS: SimulationSettings = {
  timeScale: 1,
  inflowEnabled: true,
  // Demonstração: 1 L/min enche o tubo de 12 L em ~12 min e repõe uma missão de 3 L em ~3 min.
  inflowLitersPerHour: 60,
  faultNoFlow: false,
  offline: false,
};
