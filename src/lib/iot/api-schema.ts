import { z } from "zod";
import { DISTANCE_SENSOR_MODELS, SENSOR_STATES, type DistanceSensorModel } from "@/lib/collector/distance-sensors";
import { DEVICE_FAILURES, DEVICE_STATUSES, type SimulationSettings } from "./types";

/*
 * Contrato HTTP entre dispositivo (ESP32 ou virtual) e plataforma.
 * Documentado em docs/ARCHITECTURE.md §5. Campos em snake_case, como no firmware.
 */

export const commandReportSchema = z.object({
  command_id: z.uuid(),
  status: z.enum(["EXECUTING", "MEASURING", "COMPLETED", "FAILED", "CANCELLED"]),
  delivered_liters: z.number().min(0).max(999),
  start_volume_liters: z.number().min(0).nullable(),
  end_volume_liters: z.number().min(0).nullable(),
  failure: z.enum(DEVICE_FAILURES).nullable(),
  started_uptime_ms: z.number().int().nonnegative().nullable(),
  finished_uptime_ms: z.number().int().nonnegative().nullable(),
  /** Distâncias do sensor antes e depois da liberação: o servidor deriva o volume pela calibração. */
  start_distance_mm: z.number().min(0).max(10_000).nullable().optional(),
  end_distance_mm: z.number().min(0).max(10_000).nullable().optional(),
});

/**
 * Diagnóstico da leitura do sensor de distância (opcional). Serve para avaliar o sensor dentro do tubo:
 * amostras válidas, dispersão entre amostras, intensidade do sinal, luz ambiente e status.
 * Registrado como veio, sem correção.
 */
export const sensorDiagnosticsSchema = z.object({
  /** Estado do sensor no firmware: pronto, não encontrado, sem resposta, falha ao iniciar ou sem configuração. */
  sensor_state: z.enum(SENSOR_STATES).optional(),
  /**
   * Identificação lida de um registrador do sensor pelo driver em uso: model ID 0xEE (VL53L0X, registrador 0xC0)
   * ou sensor ID 0xEACC (VL53L1X, registrador 0x010F). Não é o endereço I²C (0x29 para os dois).
   */
  model_id: z
    .string()
    .regex(/^0x[0-9A-Fa-f]{2,4}$/)
    .nullable()
    .optional(),
  /** Algum dispositivo respondeu no endereço I²C do sensor. */
  i2c_ack: z.boolean().optional(),
  i2c_clock_hz: z.number().int().min(1_000).max(1_000_000).optional(),
  samples: z.number().int().min(0).max(255).optional(),
  valid_samples: z.number().int().min(0).max(255).optional(),
  min_mm: z.number().min(0).max(10_000).nullable().optional(),
  max_mm: z.number().min(0).max(10_000).nullable().optional(),
  signal_rate_mcps: z.number().min(0).max(100_000).nullable().optional(),
  ambient_rate_mcps: z.number().min(0).max(100_000).nullable().optional(),
  status_counts: z.record(z.string().min(1).max(32), z.number().int().min(0).max(255)).optional(),
  last_status: z.string().max(32).nullable().optional(),
  read_ms: z.number().int().min(0).max(60_000).nullable().optional(),
  timing_budget_ms: z.number().int().min(0).max(1_000).optional(),
  distance_mode: z.string().max(16).optional(),
  roi: z.string().max(16).optional(),
  rssi_dbm: z.number().int().min(-127).max(0).nullable().optional(),
});

export type SensorDiagnostics = z.infer<typeof sensorDiagnosticsSchema>;

export const telemetryPayloadSchema = z.object({
  device_id: z.string().min(1).max(64),
  collector_code: z.string().min(1).max(32),
  seq: z.number().int().nonnegative(),
  /** Relógio monotônico do dispositivo — base para as taxas de variação. */
  uptime_ms: z.number().int().nonnegative(),
  /** Dado físico primário: distância do sensor até a superfície da água (mm). */
  distance_mm: z.number().min(-10_000).max(10_000).nullable(),
  /**
   * Opcional. Com calibração ativa no captador, o servidor IGNORA este valor e
   * deriva o volume da distância. Sem calibração, é usado como volume informado pelo dispositivo.
   */
  volume_liters: z.number().min(0).max(10_000).optional(),
  /** Driver de sensor em uso no firmware (VL53L0X ou VL53L1X). Ausente = ainda sem configuração. */
  sensor_model: z.string().min(2).max(40).optional(),
  /** Revisão da configuração de hardware que o firmware aplicou (recebida da plataforma). */
  hardware_revision: z.number().int().positive().nullable().optional(),
  sensor_diagnostics: sensorDiagnosticsSchema.nullable().optional(),
  valve: z.enum(["open", "closed", "unknown"]),
  status: z.enum(DEVICE_STATUSES),
  fw_version: z.string().max(32),
  command_report: commandReportSchema.nullable().optional(),
  applied_simulation_action_id: z.number().int().nonnegative().nullable().optional(),
});

export type CommandReport = z.infer<typeof commandReportSchema>;
export type TelemetryPayload = z.infer<typeof telemetryPayloadSchema>;

export type DeviceCommand =
  | { command_id: string; action: "dispense"; target_liters: number; max_duration_ms: number }
  | { command_id: string; action: "cancel" };

export type DeviceSimulationAction =
  | { id: number; type: "set_level"; ratio: number }
  | { id: number; type: "set_volume"; liters: number }
  | { id: number; type: "set_distance"; distance_mm: number }
  | { id: number; type: "reset" };

export interface DeviceSimulationState {
  settings: SimulationSettings;
  action: DeviceSimulationAction | null;
}

/**
 * Configuração de hardware do captador, definida na plataforma e enviada em toda resposta.
 * O firmware usa o driver do sensor indicado e guarda a configuração na memória não volátil.
 */
export interface HardwareConfig {
  distance_sensor: DistanceSensorModel;
  revision: number;
}

export interface TelemetryResponse {
  server_time: number;
  next_poll_ms: number;
  command: DeviceCommand | null;
  /** Presente apenas para dispositivos simulados. */
  simulation: DeviceSimulationState | null;
  hardware: HardwareConfig;
}

/**
 * App → plataforma: pedido de liberação.
 * O volume é decidido pelo SERVIDOR a partir da missão; `target_liters` é aceito
 * por compatibilidade, mas ignorado.
 */
export const dispenseRequestSchema = z.object({
  command_id: z.uuid(),
  execution_id: z.uuid(),
  mission_id: z.string().min(1).max(64),
  target_liters: z.number().positive().max(50).optional(),
});

/** App → plataforma: controle do dispositivo virtual. */
export const simulationRequestSchema = z.object({
  settings: z
    .object({
      timeScale: z.number().positive().max(1000),
      inflowEnabled: z.boolean(),
      inflowLitersPerHour: z.number().min(0).max(20),
      faultNoFlow: z.boolean(),
      offline: z.boolean(),
    })
    .partial()
    .optional(),
  action: z
    .discriminatedUnion("type", [
      z.object({ type: z.literal("set_level"), ratio: z.number().min(0).max(1) }),
      z.object({ type: z.literal("set_volume"), liters: z.number().min(0).max(50) }),
      z.object({ type: z.literal("set_distance"), distance_mm: z.number().min(0).max(10_000) }),
      z.object({ type: z.literal("reset") }),
    ])
    .optional(),
});

/** Tela de calibração → plataforma: registrar a leitura estabilizada de uma etapa. */
export const calibrationPointRequestSchema = z.object({
  step: z.enum(["zero", "one", "two", "three", "max"]),
});

const optionalNote = z
  .string()
  .trim()
  .max(280)
  .transform((value) => (value === "" ? null : value))
  .nullable()
  .optional();

/**
 * Bancada → plataforma: observação do comportamento do sensor.
 * Sem distância no corpo: o servidor registra a leitura atual (estável ou não).
 */
export const benchObservationRequestSchema = z.object({
  condition: z.enum(["sem_agua", "com_agua", "alvo_flutuante", "outro"]),
  /** Altura da água lida na mangueira transparente, a partir da marca do ZERO (referência independente). */
  reference_height_mm: z.number().min(-1000).max(5000).nullable().optional(),
  note: optionalNote,
});

/**
 * Ligações → plataforma: troca do sensor de distância do captador.
 * Nunca silenciosa: exige a confirmação explícita de que o sensor físico instalado é o selecionado.
 */
export const hardwareChangeRequestSchema = z.object({
  distance_sensor: z.enum(DISTANCE_SENSOR_MODELS),
  confirm_physical_match: z.literal(true, { error: "Confirme que o sensor físico instalado corresponde ao sensor selecionado." }),
  note: optionalNote,
});

/**
 * Bancada → plataforma: validação experimental. O operador informa só a referência
 * física (volume conhecido); distância e volume calculado vêm do servidor.
 */
export const calibrationValidationRequestSchema = z.object({
  known_volume_liters: z.number().min(0).max(1000),
  measurement_method: z.enum(["balanca", "recipiente_graduado", "outro"]),
  known_mass_kg: z.number().positive().max(1000).nullable().optional(),
  note: optionalNote,
});
