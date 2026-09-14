import { z } from "zod";
import { DEVICE_FAILURES, DEVICE_STATUSES, type SimulationSettings } from "./types";

/*
 * Contrato HTTP entre dispositivo (ESP32 ou virtual) e plataforma.
 * Documentado em docs/ARCHITECTURE.md §3. Campos em snake_case, como no firmware.
 */

export const commandReportSchema = z.object({
  command_id: z.uuid(),
  status: z.enum(["EXECUTING", "MEASURING", "COMPLETED", "FAILED", "CANCELLED"]),
  delivered_liters: z.number().min(0).max(1000),
  start_volume_liters: z.number().min(0).nullable(),
  end_volume_liters: z.number().min(0).nullable(),
  failure: z.enum(DEVICE_FAILURES).nullable(),
  started_uptime_ms: z.number().int().nonnegative().nullable(),
  finished_uptime_ms: z.number().int().nonnegative().nullable(),
});

export const telemetryPayloadSchema = z.object({
  device_id: z.string().min(1).max(64),
  collector_code: z.string().min(1).max(32),
  seq: z.number().int().nonnegative(),
  /** Relógio monotônico do dispositivo — base para as taxas de variação. */
  uptime_ms: z.number().int().nonnegative(),
  distance_mm: z.number().min(0).max(10_000).nullable(),
  volume_liters: z.number().min(0).max(10_000),
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

export type DeviceSimulationAction = { id: number; type: "set_level"; ratio: number } | { id: number; type: "reset" };

export interface DeviceSimulationState {
  settings: SimulationSettings;
  action: DeviceSimulationAction | null;
}

export interface TelemetryResponse {
  server_time: number;
  next_poll_ms: number;
  command: DeviceCommand | null;
  /** Presente apenas para dispositivos simulados. */
  simulation: DeviceSimulationState | null;
}

/** App → plataforma: pedido de liberação. */
export const dispenseRequestSchema = z.object({
  command_id: z.uuid(),
  execution_id: z.uuid(),
  mission_id: z.string().min(1).max(64),
  target_liters: z.number().positive().max(50),
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
      z.object({ type: z.literal("reset") }),
    ])
    .optional(),
});
