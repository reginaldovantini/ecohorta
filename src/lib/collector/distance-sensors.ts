import type { SensorDiagnostics } from "@/lib/iot/api-schema";

/*
 * SENSORES DE DISTÂNCIA SUPORTADOS — VL53L0X e VL53L1X (STMicroelectronics).
 *
 * O projeto suporta os dois, mas cada captador usa UM, escolhido na plataforma
 * (collectors.distance_sensor). O firmware recebe o modelo na resposta da
 * telemetria e usa o driver correspondente; a ligação física é a mesma.
 *
 * Especificações: somente as documentadas pelo fabricante (datasheets da ST).
 * Configurações do firmware (modo, orçamento de tempo, ROI) são escolhas do
 * projeto e aparecem separadas das especificações.
 */

export const DISTANCE_SENSOR_MODELS = ["VL53L0X", "VL53L1X"] as const;
export type DistanceSensorModel = (typeof DISTANCE_SENSOR_MODELS)[number];

/** Captadores cadastrados antes da configuração de hardware usam o VL53L1X (único suportado até então). */
export const DEFAULT_DISTANCE_SENSOR: DistanceSensorModel = "VL53L1X";

export const isDistanceSensorModel = (value: unknown): value is DistanceSensorModel =>
  typeof value === "string" && (DISTANCE_SENSOR_MODELS as readonly string[]).includes(value);

/**
 * Ligação oficial desta versão — IGUAL para os dois sensores.
 * Espelha firmware/include/config.h (PIN_I2C_SDA, PIN_I2C_SCL, I2C_CLOCK_HZ).
 */
export const SENSOR_WIRING = {
  board: "ESP32 DevKit V1",
  bus: "I²C",
  /** Endereço I²C padrão (7 bits) dos DOIS sensores. Não confundir com a identificação do sensor. */
  address: "0x29",
  sdaGpio: 21,
  sclGpio: 22,
  /** Comum aos dois sensores. Não aumentar para 400 kHz sem validação física. */
  i2cClockHz: 100_000,
  cableConductors: 4,
  cableLengthCm: 50,
  /** Pinos do módulo que NÃO são usados nem levados pelo cabo nesta versão. */
  unusedPins: ["XSHUT", "GPIO1"],
} as const;

export interface DistanceSensorSpec {
  model: DistanceSensorModel;
  manufacturer: "STMicroelectronics";
  /** Maior distância documentada no modo usado pelo firmware (mm). Leituras acima são inválidas. */
  documentedMaxRangeMm: number;
  rangeSummary: string;
  rangeDetails: string[];
  fieldOfViewDeg: number;
  emitter: string;
  chipSupply: string;
  i2cMaxClock: string;
  /**
   * Identificação lida de um REGISTRADOR do sensor (não é endereço I²C: os dois usam o endereço 0x29).
   * O firmware a confere para distinguir os sensores antes de configurá-los.
   */
  identification: { name: string; register: string; registerBits: 8 | 16; value: string };
  /** Módulos (plaquinhas) conhecidos com este sensor. */
  knownModules: string[];
  roi: string | null;
  firmwareDriver: string;
  firmwareSettings: string;
}

export const DISTANCE_SENSORS: Record<DistanceSensorModel, DistanceSensorSpec> = {
  VL53L0X: {
    model: "VL53L0X",
    manufacturer: "STMicroelectronics",
    documentedMaxRangeMm: 2000,
    rangeSummary: "até 2 m (perfil de longo alcance)",
    rangeDetails: [
      "Perfil padrão: até 1,2 m.",
      "Perfil de longo alcance (usado pelo firmware): até 2 m, com alvo branco e sem luz infravermelha ambiente.",
    ],
    fieldOfViewDeg: 25,
    emitter: "Laser infravermelho de 940 nm (VCSEL), Classe 1",
    chipSupply: "2,6 V a 3,5 V no chip",
    i2cMaxClock: "até 400 kHz",
    identification: { name: "model ID", register: "0xC0", registerBits: 8, value: "0xEE" },
    knownModules: [],
    roi: null,
    firmwareDriver: "VL53L0XDriver (biblioteca Pololu VL53L0X)",
    firmwareSettings: "longo alcance (limite de sinal 0,1 MCPS, pulsos VCSEL 18/14), 50 ms por amostra",
  },
  VL53L1X: {
    model: "VL53L1X",
    manufacturer: "STMicroelectronics",
    documentedMaxRangeMm: 4000,
    rangeSummary: "até 4 m (modo longo)",
    rangeDetails: [
      "Modo longo (usado pelo firmware): até 4 m no escuro, com alvo branco. Com luz ambiente forte, o alcance cai bastante.",
      "Modo curto: até cerca de 1,3 m, com mais imunidade à luz ambiente.",
      "Distância mínima: 4 cm.",
    ],
    fieldOfViewDeg: 27,
    emitter: "Laser infravermelho de 940 nm (VCSEL), Classe 1",
    chipSupply: "2,6 V a 3,5 V no chip",
    i2cMaxClock: "até 1 MHz",
    identification: { name: "sensor ID", register: "0x010F", registerBits: 16, value: "0xEACC" },
    // O módulo CJMCU-531 do EC-001 é baseado no VL53L1X: configurar VL53L1X, nunca VL53L0X.
    knownModules: ["CJMCU-531 (módulo do EC-001)"],
    roi: "programável, de 16×16 a 4×4 SPADs (um ROI menor estreita o cone)",
    firmwareDriver: "VL53L1XDriver (biblioteca Pololu VL53L1X)",
    firmwareSettings: "modo longo, 50 ms por amostra, ROI 16×16",
  },
};

/** Estado do sensor informado pelo firmware no diagnóstico de cada leitura. */
export const SENSOR_STATES = ["ready", "not_found", "timeout", "error", "not_configured"] as const;
export type SensorState = (typeof SENSOR_STATES)[number];

export const SENSOR_STATE_LABEL: Record<SensorState, string> = {
  ready: "Pronto",
  not_found: "Não encontrado",
  timeout: "Sem resposta (timeout)",
  error: "Falha ao iniciar",
  not_configured: "Aguardando configuração",
};

/**
 * Configurado na plataforma × reportado pelo firmware:
 * - `compatible`: o firmware usa o driver do sensor configurado e o sensor respondeu;
 * - `incompatible`: firmware com outro driver, ou o dispositivo no I²C não se identificou como o sensor configurado;
 * - `sensor_missing`: driver certo, mas nenhum dispositivo respondeu no endereço do sensor;
 * - `sensor_fault`: driver certo e sensor presente, mas sem resposta (timeout) ou falha ao iniciar;
 * - `awaiting_config`: o firmware ainda não recebeu a configuração (primeira conexão);
 * - `not_reported`: o dispositivo não informa o sensor (firmware antigo);
 * - `offline`: sem leitura recente, não há como conferir.
 */
export type SensorCompatibility =
  | "compatible"
  | "incompatible"
  | "sensor_missing"
  | "sensor_fault"
  | "awaiting_config"
  | "not_reported"
  | "offline";

export interface SensorCompatibilityAssessment {
  state: SensorCompatibility;
  message: string;
}

type HardwareDiagnostics = Pick<SensorDiagnostics, "sensor_state" | "model_id" | "i2c_ack">;

/**
 * O volume só pode ser derivado de leituras feitas com o driver do sensor configurado.
 * Dispositivos que não informam o sensor (firmware antigo) continuam aceitos.
 */
export function sensorMatchesConfiguration(configured: DistanceSensorModel, reported: string | null | undefined) {
  return reported === null || reported === undefined || reported === configured;
}

export function assessSensorCompatibility(input: {
  configured: DistanceSensorModel;
  reported: string | null;
  diagnostics: HardwareDiagnostics | null;
  online: boolean;
}): SensorCompatibilityAssessment {
  const { configured, reported, diagnostics, online } = input;
  const state = diagnostics?.sensor_state;

  if (!online) {
    return { state: "offline", message: "Sem leitura recente do dispositivo: não é possível conferir o sensor." };
  }
  if (state === "not_configured") {
    return {
      state: "awaiting_config",
      message: "O firmware ainda não tinha a configuração do sensor. Ela segue na resposta desta leitura e vale a partir da próxima.",
    };
  }
  if (reported === null) {
    return { state: "not_reported", message: "O firmware não informou o sensor em uso. Atualize o firmware para conferir a compatibilidade." };
  }
  if (reported !== configured) {
    return {
      state: "incompatible",
      message: `O firmware está usando o driver do ${reported}, mas o captador está configurado para o ${configured}. O volume não é calculado até os dois coincidirem.`,
    };
  }
  if (state === "not_found") {
    if (diagnostics?.i2c_ack) {
      return {
        state: "incompatible",
        message: `Um dispositivo respondeu no endereço ${SENSOR_WIRING.address}, mas não se identificou como ${configured}${
          diagnostics.model_id ? ` (identificação lida: ${diagnostics.model_id})` : ""
        }. Confira se o sensor instalado é o configurado.`,
      };
    }
    return {
      state: "sensor_missing",
      message: `Nenhum sensor respondeu no endereço ${SENSOR_WIRING.address}. Verifique VCC, GND, SDA (GPIO${SENSOR_WIRING.sdaGpio}) e SCL (GPIO${SENSOR_WIRING.sclGpio}).`,
    };
  }
  if (state === "timeout") {
    return { state: "sensor_fault", message: "O sensor parou de responder (timeout). O firmware tenta reiniciá-lo a cada leitura; verifique o cabo." };
  }
  if (state === "error") {
    return { state: "sensor_fault", message: `O ${configured} foi identificado, mas falhou ao iniciar. Desligue e religue o USB.` };
  }
  return { state: "compatible", message: `Firmware usando o driver do ${configured}, o sensor configurado.` };
}
