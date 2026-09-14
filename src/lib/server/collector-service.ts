import { createHash, timingSafeEqual } from "node:crypto";
import { normalizeCollectorCode } from "@/lib/collector/code";
import {
  createAccountingState,
  getTotals,
  getTrend,
  ingestReading,
  registerReuse,
  type AccountingState,
} from "@/lib/collector/water-accounting";
import { availableLiters } from "@/lib/collector/water";
import type {
  CommandReport,
  DeviceCommand,
  DeviceSimulationAction,
  DeviceSimulationState,
  TelemetryPayload,
  TelemetryResponse,
} from "@/lib/iot/api-schema";
import type { SimulationRequest } from "@/lib/iot/data-source";
import { DEFAULT_SIMULATION_SETTINGS } from "@/lib/iot/simulation-config";
import type {
  CollectorInfo,
  CollectorSnapshot,
  DispenseProgress,
  DispenseStatus,
  FailureReason,
  SimulationSettings,
} from "@/lib/iot/types";

/*
 * Serviço de captadores (backend). Guarda o estado em memória até a
 * integração com o Supabase (Dias 6–7), quando este mesmo contrato passa
 * a usar as tabelas collectors / devices / telemetry / device_commands.
 */

export interface CollectorSeed {
  info: CollectorInfo;
  deviceId: string;
  isSimulated: boolean;
  /** Nome da variável de ambiente com o token do dispositivo (nunca o token em si). */
  tokenEnvVar: string;
}

interface CommandRecord {
  missionId: string;
  executionId: string;
  progress: DispenseProgress;
}

interface CollectorRecord {
  seed: CollectorSeed;
  lastPayload: TelemetryPayload | null;
  lastSeenAt: number | null;
  accounting: AccountingState;
  commands: Map<string, CommandRecord>;
  activeCommandId: string | null;
  simulation: { settings: SimulationSettings; pendingAction: DeviceSimulationAction | null; nextActionId: number } | null;
}

export type ServiceResult<T> = { ok: true; value: T } | { ok: false; status: number; message: string };

const OFFLINE_AFTER_MS = 15_000;
const QUEUE_TIMEOUT_MS = 30_000;
const MAX_DISPENSE_MS = 240_000;
const MAX_COMMANDS_KEPT = 200;
const TERMINAL: readonly DispenseStatus[] = ["COMPLETED", "FAILED", "CANCELLED"];

const round2 = (value: number) => Math.round(value * 100) / 100;
const digest = (value: string) => createHash("sha256").update(value).digest();

export function createCollectorService({
  seeds,
  now = Date.now,
  env = process.env,
}: {
  seeds: readonly CollectorSeed[];
  now?: () => number;
  env?: Record<string, string | undefined>;
}) {
  const collectors = new Map<string, CollectorRecord>();
  for (const seed of seeds) {
    collectors.set(seed.info.code, {
      seed,
      lastPayload: null,
      lastSeenAt: null,
      accounting: createAccountingState(),
      commands: new Map(),
      activeCommandId: null,
      simulation: seed.isSimulated
        ? { settings: { ...DEFAULT_SIMULATION_SETTINGS }, pendingAction: null, nextActionId: 1 }
        : null,
    });
  }

  const find = (code: string) => {
    const normalized = normalizeCollectorCode(code);
    return normalized ? (collectors.get(normalized) ?? null) : null;
  };

  const isOnline = (record: CollectorRecord) =>
    record.lastSeenAt !== null && now() - record.lastSeenAt <= OFFLINE_AFTER_MS;

  const activeCommand = (record: CollectorRecord) =>
    record.activeCommandId ? (record.commands.get(record.activeCommandId) ?? null) : null;

  function expireQueued(record: CollectorRecord) {
    const active = activeCommand(record);
    if (active?.progress.status === "QUEUED" && now() - active.progress.queuedAt > QUEUE_TIMEOUT_MS) {
      active.progress = { ...active.progress, status: "FAILED", failure: "DEVICE_OFFLINE", finishedAt: now() };
      record.activeCommandId = null;
    }
  }

  function applyReport(record: CollectorRecord, report: CommandReport) {
    const command = record.commands.get(report.command_id);
    if (!command || TERMINAL.includes(command.progress.status)) return; // idempotente

    const serverNow = now();
    const startedAt = command.progress.startedAt ?? (report.started_uptime_ms !== null ? serverNow : null);
    const next: DispenseProgress = {
      ...command.progress,
      status: report.status,
      deliveredLiters: report.delivered_liters,
      startVolumeLiters: report.start_volume_liters,
      endVolumeLiters: report.end_volume_liters,
      failure: report.failure,
      startedAt,
    };

    if (TERMINAL.includes(report.status)) {
      next.cancelRequested = false;
      next.finishedAt =
        startedAt !== null && report.started_uptime_ms !== null && report.finished_uptime_ms !== null
          ? startedAt + (report.finished_uptime_ms - report.started_uptime_ms)
          : serverNow;
      record.activeCommandId = null;
      // Toda água que saiu medida é reúso — inclusive em cancelamento ou timeout.
      if (report.delivered_liters > 0.01) registerReuse(record.accounting, report.delivered_liters);
    }
    command.progress = next;
  }

  function commandFor(record: CollectorRecord): DeviceCommand | null {
    const active = activeCommand(record);
    if (!active) return null;
    const { progress } = active;
    if (progress.status === "QUEUED") {
      // Reenviado até o primeiro relatório: o firmware ignora IDs já executados.
      return {
        command_id: progress.commandId,
        action: "dispense",
        target_liters: progress.targetLiters,
        max_duration_ms: MAX_DISPENSE_MS,
      };
    }
    if (progress.cancelRequested) return { command_id: progress.commandId, action: "cancel" };
    return null;
  }

  function simulationFor(record: CollectorRecord): DeviceSimulationState | null {
    return record.simulation ? { settings: record.simulation.settings, action: record.simulation.pendingAction } : null;
  }

  function acknowledgeSimulation(record: CollectorRecord, appliedId: number | null | undefined) {
    const pending = record.simulation?.pendingAction;
    if (pending && (appliedId ?? 0) >= pending.id) record.simulation!.pendingAction = null;
  }

  function snapshot(record: CollectorRecord): CollectorSnapshot {
    expireQueued(record);
    const payload = record.lastPayload;
    const online = isOnline(record);
    const active = activeCommand(record);
    const dispensing =
      online && (payload?.valve === "open" || active?.progress.status === "EXECUTING" || active?.progress.status === "MEASURING");
    const volume = payload?.volume_liters ?? 0;
    const flow = online && payload ? getTrend(record.accounting, dispensing) : { trend: "stable" as const, netFlowLitersPerHour: 0 };
    const totals = getTotals(record.accounting, volume);

    return {
      info: record.seed.info,
      telemetry: {
        deviceId: record.seed.deviceId,
        origin: record.seed.isSimulated ? "simulation" : "device",
        status: online && payload ? payload.status : "OFFLINE",
        distanceMm: payload?.distance_mm ?? null,
        volumeLiters: round2(volume),
        valve: online ? (payload?.valve ?? "unknown") : "unknown",
        netFlowLitersPerHour: round2(flow.netFlowLitersPerHour),
        trend: flow.trend,
        overflowing: online && record.accounting.overflowing,
        measuredAt: record.lastSeenAt,
      },
      totals: {
        capturedLiters: round2(totals.capturedLiters),
        reusedLiters: round2(totals.reusedLiters),
        discardedEstimatedLiters: round2(totals.discardedEstimatedLiters),
      },
      simulation: record.simulation?.settings ?? null,
    };
  }

  function failedProgress(base: DispenseProgress, failure: FailureReason): DispenseProgress {
    return { ...base, status: "FAILED", failure, finishedAt: base.queuedAt };
  }

  return {
    listCollectors() {
      return [...collectors.values()].map(({ seed }) => ({
        code: seed.info.code,
        name: seed.info.name,
        location: seed.info.location,
      }));
    },

    getSnapshot(code: string): CollectorSnapshot | null {
      const record = find(code);
      return record ? snapshot(record) : null;
    },

    /** Autentica o dispositivo pelo token (comparação em tempo constante). */
    authenticateDevice(authorization: string | null, deviceId: string, collectorCode?: string) {
      const record = collectorCode
        ? find(collectorCode)
        : ([...collectors.values()].find((item) => item.seed.deviceId === deviceId) ?? null);
      if (!record || record.seed.deviceId !== deviceId) return null;
      const expected = env[record.seed.tokenEnvVar];
      const token = authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
      if (!expected || !token) return null;
      return timingSafeEqual(digest(expected), digest(token)) ? record.seed.info.code : null;
    },

    ingestTelemetry(code: string, payload: TelemetryPayload): TelemetryResponse {
      const record = find(code)!;
      record.lastSeenAt = now();
      record.lastPayload = payload;
      acknowledgeSimulation(record, payload.applied_simulation_action_id);
      if (payload.command_report) applyReport(record, payload.command_report);

      const active = activeCommand(record);
      const dispensing =
        payload.valve === "open" || active?.progress.status === "EXECUTING" || active?.progress.status === "MEASURING";
      ingestReading(record.accounting, {
        uptimeMs: payload.uptime_ms,
        volumeLiters: payload.volume_liters,
        capacityLiters: record.seed.info.capacityLiters,
        dispensing,
      });
      expireQueued(record);

      return {
        server_time: now(),
        next_poll_ms: record.activeCommandId ? 250 : 1000,
        command: commandFor(record),
        simulation: simulationFor(record),
      };
    },

    /** Canal de controle para o dispositivo virtual quando ele está "offline". */
    deviceSimulationState(code: string, appliedActionId: number | null): DeviceSimulationState | null {
      const record = find(code);
      if (!record) return null;
      acknowledgeSimulation(record, appliedActionId);
      return simulationFor(record);
    },

    requestDispense(
      code: string,
      request: { command_id: string; execution_id: string; mission_id: string; target_liters: number },
    ): ServiceResult<DispenseProgress> {
      const record = find(code);
      if (!record) return { ok: false, status: 404, message: "Captador não encontrado." };

      const existing = record.commands.get(request.command_id);
      if (existing) return { ok: true, value: existing.progress };

      const current = snapshot(record);
      const base: DispenseProgress = {
        commandId: request.command_id,
        status: "QUEUED",
        targetLiters: request.target_liters,
        deliveredLiters: 0,
        startVolumeLiters: null,
        endVolumeLiters: null,
        queuedAt: now(),
        startedAt: null,
        finishedAt: null,
        failure: null,
        cancelRequested: false,
        origin: current.telemetry.origin,
      };

      let progress = base;
      if (current.telemetry.status === "OFFLINE") progress = failedProgress(base, "DEVICE_OFFLINE");
      else if (record.activeCommandId) progress = failedProgress(base, "DEVICE_BUSY");
      else if (availableLiters(current.telemetry.volumeLiters, record.seed.info.reserveLiters) + 1e-6 < request.target_liters) {
        progress = failedProgress(base, "INSUFFICIENT_WATER");
      }

      record.commands.set(request.command_id, {
        missionId: request.mission_id,
        executionId: request.execution_id,
        progress,
      });
      if (progress.status === "QUEUED") record.activeCommandId = request.command_id;
      while (record.commands.size > MAX_COMMANDS_KEPT) {
        const oldest = record.commands.keys().next().value!;
        if (oldest === record.activeCommandId) break;
        record.commands.delete(oldest);
      }
      return { ok: true, value: progress };
    },

    getProgress(code: string, commandId: string): DispenseProgress | null {
      const record = find(code);
      if (!record) return null;
      expireQueued(record);
      return record.commands.get(commandId)?.progress ?? null;
    },

    requestCancel(code: string, commandId: string): ServiceResult<DispenseProgress> {
      const record = find(code);
      const command = record?.commands.get(commandId);
      if (!record || !command) return { ok: false, status: 404, message: "Comando não encontrado." };

      const { progress } = command;
      if (progress.status === "QUEUED") {
        command.progress = { ...progress, status: "CANCELLED", finishedAt: now() };
        if (record.activeCommandId === commandId) record.activeCommandId = null;
      } else if (progress.status === "EXECUTING") {
        command.progress = { ...progress, cancelRequested: true };
      }
      return { ok: true, value: command.progress };
    },

    updateSimulation(code: string, request: SimulationRequest): ServiceResult<SimulationSettings> {
      const record = find(code);
      if (!record) return { ok: false, status: 404, message: "Captador não encontrado." };
      if (!record.simulation) {
        return { ok: false, status: 403, message: "Este captador é real: não aceita comandos de simulação." };
      }
      if (request.action && record.activeCommandId) {
        return { ok: false, status: 409, message: "Aguarde a liberação atual terminar." };
      }

      record.simulation.settings = { ...record.simulation.settings, ...request.settings };
      if (request.action) {
        record.simulation.pendingAction = { id: record.simulation.nextActionId++, ...request.action };
        // Mudança manual de nível ou reinício: a contabilidade recomeça do novo estado.
        record.accounting = createAccountingState();
      }
      return { ok: true, value: record.simulation.settings };
    },
  };
}

export type CollectorService = ReturnType<typeof createCollectorService>;
