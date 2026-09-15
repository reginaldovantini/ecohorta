import { createHash, timingSafeEqual } from "node:crypto";
import { normalizeCollectorCode } from "@/lib/collector/code";
import { fillRatio, getLevelState } from "@/lib/collector/level-state";
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
import type {
  CollectorInfo,
  CollectorSnapshot,
  DeviceStatus,
  DispenseProgress,
  DispenseStatus,
  FailureReason,
  SimulationSettings,
  ValveKind,
  ValveState,
} from "@/lib/iot/types";
import { findMission } from "@/lib/missions/catalog";
import { getRescuePlan } from "@/lib/missions/rescue";
import { isEducator, type Actor } from "./actor";
import { millis, num, numOrNull, type Database, type Queryable } from "./db/types";
import { fail, type ServiceResult } from "./errors";

/*
 * Serviço de captadores (backend). O banco é a fonte oficial: nada de estado
 * crítico em memória, compatível com funções serverless. Cada operação que
 * altera um captador trava a linha de collector_state (FOR UPDATE), então
 * telemetria, pedidos e cancelamentos concorrentes são serializados.
 */

export interface AuthenticatedDevice {
  deviceId: string;
  deviceKey: string;
  collectorId: string;
  collectorCode: string;
  isSimulated: boolean;
}

interface SimulationState {
  settings: SimulationSettings;
  pendingAction: DeviceSimulationAction | null;
  nextActionId: number;
}

interface CollectorRow {
  id: string;
  school_id: string;
  code: string;
  name: string;
  location: string;
  capacity_liters: string | number;
  reserve_liters: string | number;
  valve_kind: ValveKind;
  device_id: string | null;
  device_key: string | null;
  is_simulated: boolean | null;
  last_seen_at: Date | string | null;
  distance_mm: string | number | null;
  volume_liters: string | number | null;
  valve: ValveState;
  status: DeviceStatus;
  accounting: unknown;
  simulation: unknown;
  last_telemetry_at: Date | string | null;
  last_telemetry_volume: string | number | null;
}

interface CommandRow {
  id: string;
  collector_id: string;
  requested_by: string | null;
  target_liters: string | number;
  status: DispenseStatus;
  failure: FailureReason | null;
  cancel_requested: boolean;
  delivered_liters: string | number;
  start_volume_liters: string | number | null;
  end_volume_liters: string | number | null;
  is_simulated: boolean;
  queued_at: Date | string;
  started_at: Date | string | null;
  finished_at: Date | string | null;
}

export const OFFLINE_AFTER_MS = 15_000;
export const QUEUE_TIMEOUT_MS = 30_000;
/** Intervalos de envio do dispositivo: econômicos parado, rápidos com liberação ativa. */
export const IDLE_POLL_MS = 3_000;
export const ACTIVE_POLL_MS = 1_000;
/** Telemetria histórica: no máximo a cada 30 s, ou quando algo relevante muda. */
export const TELEMETRY_STORE_INTERVAL_MS = 30_000;
const TELEMETRY_VOLUME_DELTA_LITERS = 0.05;
const MAX_DISPENSE_MS = 240_000;
const TERMINAL = new Set<DispenseStatus>(["COMPLETED", "FAILED", "CANCELLED"]);

const round2 = (value: number) => Math.round(value * 100) / 100;
const date = (ms: number) => new Date(ms);
const notFound = fail(404, "Captador não encontrado.");

const COLLECTOR_SELECT = `
  select c.id, c.school_id, c.code, c.name, c.location, c.capacity_liters, c.reserve_liters, c.valve_kind,
         d.id as device_id, d.device_key, d.is_simulated,
         s.last_seen_at, s.distance_mm, s.volume_liters, s.valve, s.status,
         s.accounting, s.simulation, s.last_telemetry_at, s.last_telemetry_volume
  from public.collectors c
  join public.collector_state s on s.collector_id = c.id
  left join public.devices d on d.collector_id = c.id and d.active`;

const parseJson = <T>(value: unknown): T | null => {
  if (value === null || value === undefined) return null;
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
};

function parseAccounting(value: unknown): AccountingState {
  const parsed = parseJson<Partial<AccountingState>>(value);
  return parsed && typeof parsed.reusedLiters === "number" ? (parsed as AccountingState) : createAccountingState();
}

const parseSimulation = (value: unknown) => parseJson<SimulationState>(value);

function toProgress(row: CommandRow): DispenseProgress {
  return {
    commandId: row.id,
    status: row.status,
    targetLiters: num(row.target_liters),
    deliveredLiters: num(row.delivered_liters),
    startVolumeLiters: numOrNull(row.start_volume_liters),
    endVolumeLiters: numOrNull(row.end_volume_liters),
    queuedAt: millis(row.queued_at)!,
    startedAt: millis(row.started_at),
    finishedAt: millis(row.finished_at),
    failure: row.failure,
    cancelRequested: row.cancel_requested,
    origin: row.is_simulated ? "simulation" : "device",
  };
}

function toInfo(row: CollectorRow): CollectorInfo {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    location: row.location,
    capacityLiters: num(row.capacity_liters),
    reserveLiters: num(row.reserve_liters),
    valveKind: row.valve_kind,
  };
}

/** Ações da simulação só afetam a contabilidade quando o dispositivo confirma que as aplicou. */
function acknowledgeSimulation(simulation: SimulationState, accounting: AccountingState, appliedId: number | null | undefined) {
  const pending = simulation.pendingAction;
  if (!pending || (appliedId ?? 0) < pending.id) return accounting;
  simulation.pendingAction = null;
  if (pending.type === "reset") return createAccountingState();
  // Ajuste manual de nível: a tendência recomeça, os totais já medidos são mantidos.
  accounting.samples = [];
  return accounting;
}

function commandFor(row: CommandRow | null): DeviceCommand | null {
  if (!row) return null;
  if (row.status === "QUEUED") {
    // Reenviado até o primeiro relatório: o firmware ignora IDs já executados.
    return { command_id: row.id, action: "dispense", target_liters: num(row.target_liters), max_duration_ms: MAX_DISPENSE_MS };
  }
  return row.cancel_requested ? { command_id: row.id, action: "cancel" } : null;
}

export function createCollectorService({ db, pepper, now = Date.now }: { db: Database; pepper: string; now?: () => number }) {
  const hashToken = (token: string) => createHash("sha256").update(`${pepper}:${token}`).digest("hex");

  async function loadByCode(q: Queryable, code: string, lock = false) {
    const normalized = normalizeCollectorCode(code);
    if (!normalized) return null;
    const { rows } = await q.query<CollectorRow>(`${COLLECTOR_SELECT} where c.code = $1${lock ? " for update of s" : ""}`, [normalized]);
    return rows[0] ?? null;
  }

  async function loadById(q: Queryable, collectorId: string, lock = false) {
    const { rows } = await q.query<CollectorRow>(`${COLLECTOR_SELECT} where c.id = $1${lock ? " for update of s" : ""}`, [collectorId]);
    return rows[0] ?? null;
  }

  async function activeCommand(q: Queryable, collectorId: string) {
    const { rows } = await q.query<CommandRow>(
      "select * from public.device_commands where collector_id = $1 and status in ('QUEUED', 'EXECUTING', 'MEASURING') limit 1",
      [collectorId],
    );
    return rows[0] ?? null;
  }

  async function findCommand(q: Queryable, commandId: string, lock = false) {
    const { rows } = await q.query<CommandRow>(`select * from public.device_commands where id = $1${lock ? " for update" : ""}`, [commandId]);
    return rows[0] ?? null;
  }

  /** Comando na fila que o dispositivo não buscou a tempo: falha como captador offline. */
  async function expireQueued(q: Queryable, collectorId: string, nowMs: number) {
    const { rows } = await q.query<{ id: string }>(
      `update public.device_commands
       set status = 'FAILED', failure = 'DEVICE_OFFLINE', finished_at = $2, updated_at = $2
       where collector_id = $1 and status = 'QUEUED' and queued_at < $3
       returning id`,
      [collectorId, date(nowMs), date(nowMs - QUEUE_TIMEOUT_MS)],
    );
    for (const { id } of rows) {
      await q.query("update public.mission_executions set status = 'FAILED', finished_at = $2, updated_at = $2 where command_id = $1", [id, date(nowMs)]);
    }
  }

  function buildSnapshot(row: CollectorRow, active: CommandRow | null, nowMs: number): CollectorSnapshot {
    const lastSeen = millis(row.last_seen_at);
    const online = lastSeen !== null && nowMs - lastSeen <= OFFLINE_AFTER_MS && row.volume_liters !== null;
    const accounting = parseAccounting(row.accounting);
    const volume = numOrNull(row.volume_liters) ?? 0;
    const dispensing = online && (row.valve === "open" || active?.status === "EXECUTING" || active?.status === "MEASURING");
    const flow = online ? getTrend(accounting, dispensing) : { trend: "stable" as const, netFlowLitersPerHour: 0 };
    const totals = getTotals(accounting, volume);

    return {
      info: toInfo(row),
      telemetry: {
        deviceId: row.device_key ?? "—",
        origin: row.is_simulated ? "simulation" : "device",
        status: online ? row.status : "OFFLINE",
        distanceMm: numOrNull(row.distance_mm),
        volumeLiters: round2(volume),
        valve: online ? row.valve : "unknown",
        netFlowLitersPerHour: round2(flow.netFlowLitersPerHour),
        trend: flow.trend,
        overflowing: online && accounting.overflowing,
        measuredAt: lastSeen,
      },
      totals: {
        capturedLiters: round2(totals.capturedLiters),
        reusedLiters: round2(totals.reusedLiters),
        discardedEstimatedLiters: round2(totals.discardedEstimatedLiters),
      },
      simulation: parseSimulation(row.simulation)?.settings ?? null,
    };
  }

  async function awardMissionXp(q: Queryable, commandId: string, nowMs: number) {
    const { rows } = await q.query<{ id: string; profile_id: string; mission_id: string }>(
      "select id, profile_id, mission_id from public.mission_executions where command_id = $1",
      [commandId],
    );
    const execution = rows[0];
    const mission = execution ? findMission(execution.mission_id) : null;
    if (!execution || !mission || mission.xp <= 0) return;
    // O livro-razão impede XP duplicado para a mesma execução (xp_once_per_source).
    await q.query(
      `insert into public.xp_transactions (profile_id, amount, source_type, source_id, reason, created_at)
       values ($1, $2, 'mission_execution', $3, $4, $5)
       on conflict on constraint xp_once_per_source do nothing`,
      [execution.profile_id, mission.xp, execution.id, `Missão concluída: ${mission.title}`, date(nowMs)],
    );
    await q.query("update public.mission_executions set xp_awarded = $2 where id = $1", [execution.id, mission.xp]);
  }

  /** Aplica o relatório do firmware. Relatórios repetidos de um comando finalizado são ignorados. */
  async function applyReport(q: Queryable, collectorId: string, report: CommandReport, nowMs: number, accounting: AccountingState) {
    const command = await findCommand(q, report.command_id, true);
    if (!command || command.collector_id !== collectorId || TERMINAL.has(command.status)) return;

    const terminal = TERMINAL.has(report.status);
    const startedAt = millis(command.started_at) ?? (report.started_uptime_ms !== null ? nowMs : null);
    const finishedAt = terminal
      ? startedAt !== null && report.started_uptime_ms !== null && report.finished_uptime_ms !== null
        ? startedAt + (report.finished_uptime_ms - report.started_uptime_ms)
        : nowMs
      : null;
    const failure = report.status === "FAILED" ? (report.failure ?? "SENSOR_ERROR") : null;

    await q.query(
      `update public.device_commands
       set status = $2, delivered_liters = $3, start_volume_liters = $4, end_volume_liters = $5, failure = $6,
           started_uptime_ms = $7, finished_uptime_ms = $8, started_at = $9, finished_at = $10,
           cancel_requested = case when $11 then false else cancel_requested end, updated_at = $12
       where id = $1`,
      [
        command.id,
        report.status,
        report.delivered_liters,
        report.start_volume_liters,
        report.end_volume_liters,
        failure,
        report.started_uptime_ms,
        report.finished_uptime_ms,
        startedAt === null ? null : date(startedAt),
        finishedAt === null ? null : date(finishedAt),
        terminal,
        date(nowMs),
      ],
    );
    await q.query(
      "update public.mission_executions set status = $2, delivered_liters = $3, finished_at = $4, updated_at = $5 where command_id = $1",
      [command.id, report.status, report.delivered_liters, finishedAt === null ? null : date(finishedAt), date(nowMs)],
    );

    // Toda água que saiu medida é reúso — inclusive em cancelamento ou timeout.
    if (terminal && report.delivered_liters > 0.01) registerReuse(accounting, report.delivered_liters);
    // XP somente com conclusão confirmada pelo sensor.
    if (report.status === "COMPLETED") await awardMissionXp(q, command.id, nowMs);
  }

  const canSeeCommand = (actor: Actor, command: CommandRow) => command.requested_by === actor.profileId || isEducator(actor);

  return {
    async listCollectors(actor: Actor) {
      const { rows } = await db.query<{ code: string; name: string; location: string }>(
        "select code, name, location from public.collectors where school_id = $1 order by code",
        [actor.schoolId],
      );
      return rows;
    },

    async getSnapshot(actor: Actor, code: string): Promise<CollectorSnapshot | null> {
      return db.transaction(async (tx) => {
        const row = await loadByCode(tx, code);
        if (!row || row.school_id !== actor.schoolId) return null;
        const nowMs = now();
        await expireQueued(tx, row.id, nowMs);
        return buildSnapshot(row, await activeCommand(tx, row.id), nowMs);
      });
    },

    /** Autentica o dispositivo pelo token (hash com pepper, comparação em tempo constante). */
    async authenticateDevice(authorization: string | null, deviceKey: string, collectorCode?: string): Promise<AuthenticatedDevice | null> {
      const token = authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
      if (!token || !deviceKey) return null;
      const { rows } = await db.query<{ id: string; device_key: string; token_hash: string; is_simulated: boolean; collector_id: string; code: string }>(
        `select d.id, d.device_key, d.token_hash, d.is_simulated, c.id as collector_id, c.code
         from public.devices d join public.collectors c on c.id = d.collector_id
         where d.device_key = $1 and d.active`,
        [deviceKey],
      );
      const row = rows[0];
      const matches = timingSafeEqual(Buffer.from(hashToken(token), "hex"), Buffer.from(row?.token_hash ?? "0".repeat(64), "hex"));
      if (!row || !matches) return null;
      if (collectorCode && normalizeCollectorCode(collectorCode) !== row.code) return null;
      return { deviceId: row.id, deviceKey: row.device_key, collectorId: row.collector_id, collectorCode: row.code, isSimulated: row.is_simulated };
    },

    async ingestTelemetry(device: AuthenticatedDevice, payload: TelemetryPayload): Promise<TelemetryResponse> {
      return db.transaction(async (tx) => {
        const nowMs = now();
        const row = (await loadById(tx, device.collectorId, true))!;
        const capacity = num(row.capacity_liters);
        let accounting = parseAccounting(row.accounting);
        const wasOverflowing = accounting.overflowing;
        const simulation = parseSimulation(row.simulation);
        if (simulation) accounting = acknowledgeSimulation(simulation, accounting, payload.applied_simulation_action_id);

        if (payload.command_report) await applyReport(tx, row.id, payload.command_report, nowMs, accounting);

        const active = await activeCommand(tx, row.id);
        const dispensing = payload.valve === "open" || active?.status === "EXECUTING" || active?.status === "MEASURING";
        ingestReading(accounting, {
          uptimeMs: payload.uptime_ms,
          volumeLiters: payload.volume_liters,
          capacityLiters: capacity,
          dispensing,
        });
        await expireQueued(tx, row.id, nowMs);
        const current = await activeCommand(tx, row.id);

        const lastStoredAt = millis(row.last_telemetry_at);
        const lastStoredVolume = numOrNull(row.last_telemetry_volume);
        const storeHistory =
          lastStoredAt === null ||
          lastStoredVolume === null ||
          nowMs - lastStoredAt >= TELEMETRY_STORE_INTERVAL_MS ||
          payload.valve !== row.valve ||
          payload.status !== row.status ||
          accounting.overflowing !== wasOverflowing ||
          Math.abs(payload.volume_liters - lastStoredVolume) >= TELEMETRY_VOLUME_DELTA_LITERS;

        if (storeHistory) {
          const ratio = fillRatio(payload.volume_liters, capacity);
          await tx.query(
            `insert into public.telemetry
             (collector_id, device_id, recorded_at, uptime_ms, seq, distance_mm, volume_liters, fill_ratio, level_state, valve, status, overflowing, is_simulated)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
            [
              row.id,
              device.deviceId,
              date(nowMs),
              payload.uptime_ms,
              payload.seq,
              payload.distance_mm,
              payload.volume_liters,
              Math.round(ratio * 10_000) / 10_000,
              getLevelState(ratio).id,
              payload.valve,
              payload.status,
              accounting.overflowing,
              device.isSimulated,
            ],
          );
        }

        await tx.query(
          `update public.collector_state
           set device_id = $2, last_seen_at = $3, uptime_ms = $4, seq = $5, distance_mm = $6, volume_liters = $7,
               valve = $8, status = $9, accounting = $10::jsonb, simulation = $11::jsonb,
               last_telemetry_at = case when $12 then $3 else last_telemetry_at end,
               last_telemetry_volume = case when $12 then $7 else last_telemetry_volume end,
               updated_at = $3
           where collector_id = $1`,
          [
            row.id,
            device.deviceId,
            date(nowMs),
            payload.uptime_ms,
            payload.seq,
            payload.distance_mm,
            payload.volume_liters,
            payload.valve,
            payload.status,
            JSON.stringify(accounting),
            simulation ? JSON.stringify(simulation) : null,
            storeHistory,
          ],
        );
        if (payload.fw_version) {
          await tx.query("update public.devices set firmware_version = $2 where id = $1 and firmware_version is distinct from $2", [
            device.deviceId,
            payload.fw_version,
          ]);
        }

        return {
          server_time: nowMs,
          next_poll_ms: current ? ACTIVE_POLL_MS : IDLE_POLL_MS,
          command: commandFor(current),
          simulation: simulation ? { settings: simulation.settings, action: simulation.pendingAction } : null,
        };
      });
    },

    /** Canal de controle para o dispositivo virtual quando ele está "offline". */
    async deviceSimulationState(device: AuthenticatedDevice, appliedActionId: number | null): Promise<DeviceSimulationState | null> {
      return db.transaction(async (tx) => {
        const row = (await loadById(tx, device.collectorId, true))!;
        const simulation = parseSimulation(row.simulation);
        if (!simulation) return null;
        const accounting = acknowledgeSimulation(simulation, parseAccounting(row.accounting), appliedActionId);
        await tx.query("update public.collector_state set accounting = $2::jsonb, simulation = $3::jsonb where collector_id = $1", [
          row.id,
          JSON.stringify(accounting),
          JSON.stringify(simulation),
        ]);
        return { settings: simulation.settings, action: simulation.pendingAction };
      });
    },

    /**
     * Pedido de liberação. O volume vem da missão (servidor), nunca do navegador.
     * Idempotente por command_id; recusas (offline, ocupado, pouca água) ficam registradas.
     */
    async requestDispense(
      actor: Actor,
      code: string,
      request: { command_id: string; execution_id: string; mission_id: string },
    ): Promise<ServiceResult<DispenseProgress>> {
      return db.transaction(async (tx) => {
        const row = await loadByCode(tx, code, true);
        if (!row || row.school_id !== actor.schoolId) return notFound;

        const existing = await findCommand(tx, request.command_id);
        if (existing) {
          if (existing.collector_id !== row.id || !canSeeCommand(actor, existing)) {
            return fail(409, "Este identificador de comando já foi utilizado.");
          }
          return { ok: true, value: toProgress(existing) };
        }
        const executionTaken = await tx.query("select 1 from public.mission_executions where id = $1", [request.execution_id]);
        if (executionTaken.rows.length > 0) return fail(409, "Este identificador de execução já foi utilizado.");

        const mission = findMission(request.mission_id);
        if (!mission || mission.kind !== "dispense") return fail(422, "Missão desconhecida.");

        const nowMs = now();
        await expireQueued(tx, row.id, nowMs);
        const active = await activeCommand(tx, row.id);
        const snapshot = buildSnapshot(row, active, nowMs);

        let liters = mission.liters;
        if (mission.category === "rescue") {
          const plan = getRescuePlan(snapshot);
          if (!plan) return fail(409, "A missão de resgate não está disponível agora.");
          liters = plan.suggestedLiters;
        }
        if (liters === null) return fail(422, "Missão sem volume definido.");

        let failure: FailureReason | null = null;
        if (snapshot.telemetry.status === "OFFLINE") failure = "DEVICE_OFFLINE";
        else if (active) failure = "DEVICE_BUSY";
        else if (availableLiters(snapshot.telemetry.volumeLiters, snapshot.info.reserveLiters) + 1e-6 < liters) {
          failure = "INSUFFICIENT_WATER";
        }
        const status: DispenseStatus = failure ? "FAILED" : "QUEUED";
        const queuedAt = date(nowMs);

        const inserted = await tx.query<CommandRow>(
          `insert into public.device_commands
           (id, collector_id, device_id, requested_by, target_liters, status, failure, is_simulated, queued_at, finished_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           returning *`,
          [request.command_id, row.id, row.device_id, actor.profileId, liters, status, failure, row.is_simulated ?? false, queuedAt, failure ? queuedAt : null],
        );
        await tx.query(
          `insert into public.mission_executions
           (id, profile_id, collector_id, command_id, mission_id, mission_category, target_liters, status, created_at, finished_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [request.execution_id, actor.profileId, row.id, request.command_id, mission.id, mission.category, liters, status, queuedAt, failure ? queuedAt : null],
        );
        return { ok: true, value: toProgress(inserted.rows[0]!) };
      });
    },

    async getProgress(actor: Actor, code: string, commandId: string): Promise<DispenseProgress | null> {
      return db.transaction(async (tx) => {
        const row = await loadByCode(tx, code);
        if (!row || row.school_id !== actor.schoolId) return null;
        await expireQueued(tx, row.id, now());
        const command = await findCommand(tx, commandId);
        if (!command || command.collector_id !== row.id || !canSeeCommand(actor, command)) return null;
        return toProgress(command);
      });
    },

    /** Na fila, cancela na hora; em execução, o dispositivo fecha a válvula e confirma. */
    async requestCancel(actor: Actor, code: string, commandId: string): Promise<ServiceResult<DispenseProgress>> {
      return db.transaction(async (tx) => {
        const row = await loadByCode(tx, code, true);
        if (!row || row.school_id !== actor.schoolId) return notFound;
        const command = await findCommand(tx, commandId, true);
        if (!command || command.collector_id !== row.id || !canSeeCommand(actor, command)) return fail(404, "Comando não encontrado.");

        const nowMs = now();
        if (command.status === "QUEUED") {
          await tx.query("update public.device_commands set status = 'CANCELLED', finished_at = $2, updated_at = $2 where id = $1", [command.id, date(nowMs)]);
          await tx.query("update public.mission_executions set status = 'CANCELLED', finished_at = $2, updated_at = $2 where command_id = $1", [
            command.id,
            date(nowMs),
          ]);
        } else if (command.status === "EXECUTING") {
          await tx.query("update public.device_commands set cancel_requested = true, updated_at = $2 where id = $1", [command.id, date(nowMs)]);
        }
        return { ok: true, value: toProgress((await findCommand(tx, command.id))!) };
      });
    },

    async updateSimulation(actor: Actor, code: string, request: SimulationRequest): Promise<ServiceResult<SimulationSettings>> {
      if (!isEducator(actor)) return fail(403, "Somente professores e administradores controlam a simulação.");
      return db.transaction(async (tx) => {
        const row = await loadByCode(tx, code, true);
        if (!row || row.school_id !== actor.schoolId) return notFound;
        const simulation = parseSimulation(row.simulation);
        if (!simulation) return fail(403, "Este captador é real: não aceita comandos de simulação.");
        if (request.action && (await activeCommand(tx, row.id))) return fail(409, "Aguarde a liberação atual terminar.");

        simulation.settings = { ...simulation.settings, ...request.settings };
        if (request.action) simulation.pendingAction = { id: simulation.nextActionId++, ...request.action };
        await tx.query("update public.collector_state set simulation = $2::jsonb where collector_id = $1", [row.id, JSON.stringify(simulation)]);
        return { ok: true, value: simulation.settings };
      });
    },
  };
}

export type CollectorService = ReturnType<typeof createCollectorService>;
