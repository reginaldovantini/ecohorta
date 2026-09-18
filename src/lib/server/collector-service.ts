import { createHash, timingSafeEqual } from "node:crypto";
import { normalizeCollectorCode } from "@/lib/collector/code";
import { assessSensorCompatibility, sensorMatchesConfiguration, type DistanceSensorModel } from "@/lib/collector/distance-sensors";
import { appendDistanceSample, parseDistanceSamples } from "@/lib/collector/distance-stability";
import { fillRatio, getLevelState } from "@/lib/collector/level-state";
import { measuredReuse, volumeFromDistance, type VolumeModel } from "@/lib/collector/volume-calibration";
import {
  accountingFromJson,
  createAccountingState,
  getTotals,
  getTrend,
  ingestReading,
  rebaseVolume,
  registerReuse,
  type AccountingState,
} from "@/lib/collector/water-accounting";
import { availableLiters } from "@/lib/collector/water";
import type {
  CommandReport,
  DeviceCommand,
  DeviceSimulationAction,
  DeviceSimulationState,
  SensorDiagnostics,
  TelemetryPayload,
  TelemetryResponse,
} from "@/lib/iot/api-schema";
import type { SimulationRequest } from "@/lib/iot/data-source";
import type {
  CollectorCalibrationSummary,
  CollectorHardwareStatus,
  CollectorInfo,
  CollectorSnapshot,
  DeviceStatus,
  DispenseProgress,
  DispenseStatus,
  FailureReason,
  SimulationSettings,
  ValveKind,
  ValveState,
  VolumeSource,
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
  nominal_diameter_mm: string | number | null;
  nominal_useful_height_mm: string | number | null;
  // Configuração de hardware (plataforma) e o que o firmware informou
  distance_sensor: DistanceSensorModel;
  hardware_revision: number;
  hardware_updated_at: Date | string | null;
  hardware_updated_by: string | null;
  reported_hardware_revision: number | null;
  device_id: string | null;
  device_key: string | null;
  is_simulated: boolean | null;
  state_device_id: string | null;
  last_seen_at: Date | string | null;
  distance_mm: string | number | null;
  height_mm: string | number | null;
  volume_liters: string | number | null;
  volume_source: VolumeSource;
  sensor_model: string | null;
  distance_samples: unknown;
  calibration_mode_until: Date | string | null;
  valve: ValveState;
  status: DeviceStatus;
  accounting: unknown;
  simulation: unknown;
  last_telemetry_at: Date | string | null;
  last_telemetry_volume: string | number | null;
  // Calibração ativa (left join)
  calibration_id: string | null;
  calibration_version: number | null;
  calibration_sensor_model: string | null;
  calibration_activated_at: Date | string | null;
  calibration_zero_mm: string | number | null;
  calibration_maximum_mm: string | number | null;
  calibration_constant: string | number | null;
  calibration_capacity_liters: string | number | null;
  calibration_diameter_mm: string | number | null;
  calibration_height_mm: string | number | null;
  calibration_quality: "good" | "acceptable" | null;
  calibration_is_simulated: boolean | null;
  calibration_device_id: string | null;
  calibration_hardware_revision: number | null;
  firmware_version: string | null;
  // Ensaio de bancada
  bench_mode_until: Date | string | null;
  bench_started_at: Date | string | null;
  bench_started_by: string | null;
  sensor_diagnostics: unknown;
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
/** Com a tela de calibração aberta, leituras a cada 1 s para estabilizar rápido. */
export const CALIBRATION_POLL_MS = 1_000;
/** Por quanto tempo cada consulta da tela de calibração mantém o modo rápido. */
export const CALIBRATION_WATCH_MS = 30_000;
/** Ensaio de bancada: termina sozinho este tempo depois que a tela de ensaio é fechada. */
export const BENCH_MODE_TTL_MS = 15 * 60_000;
/** Telemetria histórica: no máximo a cada 30 s, ou quando algo relevante muda. */
export const TELEMETRY_STORE_INTERVAL_MS = 30_000;
const TELEMETRY_VOLUME_DELTA_LITERS = 0.05;
const MAX_DISPENSE_MS = 240_000;
const TERMINAL = new Set<DispenseStatus>(["COMPLETED", "FAILED", "CANCELLED"]);

const round2 = (value: number) => Math.round(value * 100) / 100;
const date = (ms: number) => new Date(ms);
const notFound = fail(404, "Captador não encontrado.");

export const COLLECTOR_SELECT = `
  select c.id, c.school_id, c.code, c.name, c.location, c.capacity_liters, c.reserve_liters, c.valve_kind,
         c.nominal_diameter_mm, c.nominal_useful_height_mm,
         c.distance_sensor, c.hardware_revision, c.hardware_updated_at, c.hardware_updated_by,
         d.id as device_id, d.device_key, d.is_simulated, d.firmware_version,
         s.device_id as state_device_id, s.last_seen_at, s.distance_mm, s.height_mm, s.volume_liters, s.volume_source,
         s.sensor_model, s.reported_hardware_revision, s.distance_samples, s.calibration_mode_until, s.valve, s.status,
         s.bench_mode_until, s.bench_started_at, s.bench_started_by, s.sensor_diagnostics,
         s.accounting, s.simulation, s.last_telemetry_at, s.last_telemetry_volume,
         k.id as calibration_id, k.version as calibration_version, k.sensor_model as calibration_sensor_model,
         k.activated_at as calibration_activated_at, k.zero_distance_mm as calibration_zero_mm,
         k.maximum_distance_mm as calibration_maximum_mm, k.calibration_constant,
         k.effective_capacity_liters as calibration_capacity_liters, k.effective_diameter_mm as calibration_diameter_mm,
         k.effective_height_mm as calibration_height_mm, k.quality as calibration_quality,
         k.is_simulated as calibration_is_simulated, k.device_id as calibration_device_id,
         k.hardware_revision as calibration_hardware_revision
  from public.collectors c
  join public.collector_state s on s.collector_id = c.id
  left join public.devices d on d.collector_id = c.id and d.active
  left join public.collector_calibrations k on k.collector_id = c.id and k.status = 'active'`;

const parseJson = <T>(value: unknown): T | null => {
  if (value === null || value === undefined) return null;
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
};

const parseAccounting = accountingFromJson;
const parseSimulation = (value: unknown) => parseJson<SimulationState>(value);

/**
 * A calibração ativa só vale para o dispositivo e a configuração de hardware que a fizeram:
 * outro dispositivo (ou a troca entre REAL e SIMULAÇÃO) e outro sensor (ou outra revisão
 * de hardware) exigem nova calibração. Nunca se usa a calibração de um dispositivo virtual
 * para o captador físico, nem a de um VL53L1X para um VL53L0X, nem o contrário.
 */
export function calibrationMismatch(row: CollectorRow): "other_device" | "other_sensor" | null {
  if (row.calibration_id === null) return null;
  if (row.device_id === null || row.calibration_device_id !== row.device_id || row.calibration_is_simulated !== (row.is_simulated ?? false)) {
    return "other_device";
  }
  if (row.calibration_sensor_model !== row.distance_sensor || row.calibration_hardware_revision !== row.hardware_revision) return "other_sensor";
  return null;
}

export function calibrationAppliesToDevice(row: CollectorRow) {
  return row.calibration_id !== null && calibrationMismatch(row) === null;
}

/** Sensor configurado na plataforma × o que o firmware informou na última leitura. */
export function hardwareStatus(row: CollectorRow, online: boolean): CollectorHardwareStatus {
  const diagnostics = parseJson<SensorDiagnostics>(row.sensor_diagnostics);
  const assessment = assessSensorCompatibility({ configured: row.distance_sensor, reported: row.sensor_model, diagnostics, online });
  return {
    distanceSensor: row.distance_sensor,
    revision: row.hardware_revision,
    reportedSensor: row.sensor_model,
    reportedRevision: row.reported_hardware_revision,
    sensorState: diagnostics?.sensor_state ?? null,
    compatibility: assessment.state,
    message: assessment.message,
  };
}

/** Ensaio de bancada em andamento. */
export const benchActive = (row: CollectorRow, nowMs: number) => (millis(row.bench_mode_until) ?? 0) > nowMs;

/** Modelo distância → volume da calibração ativa, se valer para o dispositivo atual. */
export function activeVolumeModel(row: CollectorRow): (VolumeModel & { id: string }) | null {
  if (!row.calibration_id || row.calibration_constant === null || !calibrationAppliesToDevice(row)) return null;
  return {
    id: row.calibration_id,
    zeroDistanceMm: num(row.calibration_zero_mm),
    maximumDistanceMm: num(row.calibration_maximum_mm),
    constantLitersPerMm: num(row.calibration_constant),
    capacityLiters: num(row.calibration_capacity_liters),
  };
}

function calibrationSummary(row: CollectorRow): CollectorCalibrationSummary | null {
  if (!row.calibration_id || row.calibration_version === null || !row.calibration_quality) return null;
  return {
    id: row.calibration_id,
    version: row.calibration_version,
    activatedAt: millis(row.calibration_activated_at)!,
    sensorModel: row.calibration_sensor_model ?? "VL53L1X",
    zeroDistanceMm: num(row.calibration_zero_mm),
    maximumDistanceMm: num(row.calibration_maximum_mm),
    constantLitersPerMm: num(row.calibration_constant),
    capacityLiters: num(row.calibration_capacity_liters),
    effectiveDiameterMm: num(row.calibration_diameter_mm),
    effectiveHeightMm: num(row.calibration_height_mm),
    quality: row.calibration_quality,
    isSimulated: row.calibration_is_simulated ?? false,
    appliesToDevice: calibrationAppliesToDevice(row),
    hardwareRevision: row.calibration_hardware_revision ?? 1,
    mismatch: calibrationMismatch(row),
  };
}

/** Capacidade usada nas regras: a efetiva da calibração ativa; senão, a cadastrada. */
const effectiveCapacity = (row: CollectorRow) => activeVolumeModel(row)?.capacityLiters ?? num(row.capacity_liters);

export type { CollectorRow };

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
    capacityLiters: round2(effectiveCapacity(row)),
    reserveLiters: num(row.reserve_liters),
    valveKind: row.valve_kind,
    nominalDiameterMm: numOrNull(row.nominal_diameter_mm),
    nominalUsefulHeightMm: numOrNull(row.nominal_useful_height_mm),
  };
}

/** Sem volume conhecido, um dispositivo "pronto" não pode ser tratado como pronto para missões. */
function displayedStatus(status: DeviceStatus, volumeKnown: boolean): DeviceStatus {
  if (volumeKnown || status === "ERROR" || status === "MAINTENANCE" || status === "OFFLINE") return status;
  return "CALIBRATING";
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
    const volumeKnown = row.volume_liters !== null;
    const online = lastSeen !== null && nowMs - lastSeen <= OFFLINE_AFTER_MS;
    const accounting = parseAccounting(row.accounting);
    const volume = numOrNull(row.volume_liters) ?? 0;
    const bench = benchActive(row, nowMs);
    const dispensing = online && (row.valve === "open" || active?.status === "EXECUTING" || active?.status === "MEASURING");
    const flow = online && volumeKnown ? getTrend(accounting, dispensing) : { trend: "stable" as const, netFlowLitersPerHour: 0 };
    const totals = getTotals(accounting, volume);
    const hardware = hardwareStatus(row, online);

    return {
      info: toInfo(row),
      calibration: calibrationSummary(row),
      benchMode: bench,
      hardware,
      telemetry: {
        deviceId: row.device_key ?? "—",
        origin: row.is_simulated ? "simulation" : "device",
        // Em ensaio de bancada o captador fica em manutenção para as missões;
        // com o sensor incompatível com a configuração, em erro.
        status: !online
          ? "OFFLINE"
          : bench
            ? "MAINTENANCE"
            : hardware.compatibility === "incompatible"
              ? "ERROR"
              : displayedStatus(row.status, volumeKnown),
        distanceMm: numOrNull(row.distance_mm),
        heightMm: numOrNull(row.height_mm),
        volumeLiters: round2(volume),
        volumeSource: row.volume_source,
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
  async function applyReport(
    q: Queryable,
    collectorId: string,
    report: CommandReport,
    nowMs: number,
    accounting: AccountingState,
    model: (VolumeModel & { id: string }) | null,
  ) {
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

    // Preparação para missões: volume reutilizado derivado das distâncias pela calibração ativa.
    // Registrado ao lado do valor do dispositivo; ainda não decide conclusão nem XP.
    if (report.start_distance_mm != null || report.end_distance_mm != null) {
      const reuse = model && terminal ? measuredReuse(model, report.start_distance_mm, report.end_distance_mm) : null;
      await q.query(
        `update public.device_commands
         set start_distance_mm = coalesce($2, start_distance_mm), end_distance_mm = coalesce($3, end_distance_mm),
             calibration_id = coalesce($4, calibration_id), measured_reuse_liters = coalesce($5, measured_reuse_liters)
         where id = $1`,
        [
          command.id,
          report.start_distance_mm ?? null,
          report.end_distance_mm ?? null,
          reuse ? model!.id : null,
          reuse ? Math.round(reuse.reusedLiters * 1000) / 1000 : null,
        ],
      );
    }

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
        // Leituras de um driver diferente do sensor configurado nunca viram volume.
        const sensorOk = sensorMatchesConfiguration(row.distance_sensor, payload.sensor_model);
        const model = sensorOk ? activeVolumeModel(row) : null;
        const capacity = effectiveCapacity(row);
        let accounting = parseAccounting(row.accounting);
        const wasOverflowing = accounting.overflowing;
        const simulation = parseSimulation(row.simulation);
        if (simulation) accounting = acknowledgeSimulation(simulation, accounting, payload.applied_simulation_action_id);

        if (payload.command_report) await applyReport(tx, row.id, payload.command_report, nowMs, accounting, model);

        // Volume: com calibração ativa, SEMPRE derivado da distância (dado físico primário).
        let volume: number | null;
        let heightMm: number | null = null;
        let source: VolumeSource;
        if (!sensorOk) {
          volume = null;
          source = "none";
        } else if (model) {
          const converted = volumeFromDistance(model, payload.distance_mm);
          volume = converted ? converted.volumeLiters : null;
          heightMm = converted ? Math.round(converted.heightMm * 10) / 10 : null;
          source = converted ? "calibration" : "none";
        } else if (payload.volume_liters !== undefined) {
          volume = payload.volume_liters;
          source = "device";
        } else {
          volume = null;
          source = "none";
        }
        if (volume !== null) volume = Math.round(volume * 1000) / 1000;

        const bench = benchActive(row, nowMs);
        const active = await activeCommand(tx, row.id);
        const dispensing = payload.valve === "open" || active?.status === "EXECUTING" || active?.status === "MEASURING";
        if (volume !== null) {
          if (bench && accounting.lastVolumeLiters !== null) {
            // Em ensaio de bancada (calibração, validação) a água entra e sai à mão: não é condensado captado nem reúso.
            rebaseVolume(accounting, accounting.lastVolumeLiters, volume);
            accounting.lastUptimeMs = payload.uptime_ms;
          } else {
            ingestReading(accounting, { uptimeMs: payload.uptime_ms, volumeLiters: volume, capacityLiters: capacity, dispensing });
          }
        }
        await expireQueued(tx, row.id, nowMs);
        const current = await activeCommand(tx, row.id);

        // Janela de leituras para a estabilização (tela de calibração).
        // Troca de dispositivo ou de driver do sensor recomeça a janela.
        const sameSensor = (payload.sensor_model ?? row.sensor_model) === row.sensor_model;
        const previousSamples = row.state_device_id === device.deviceId && sameSensor ? parseDistanceSamples(row.distance_samples) : [];
        const distanceSamples = appendDistanceSample(previousSamples, { at: nowMs, mm: payload.distance_mm });
        const calibrationMode = (millis(row.calibration_mode_until) ?? 0) > nowMs;

        const lastStoredAt = millis(row.last_telemetry_at);
        const lastStoredVolume = numOrNull(row.last_telemetry_volume);
        const volumeChanged =
          (volume === null) !== (lastStoredVolume === null) ||
          (volume !== null && lastStoredVolume !== null && Math.abs(volume - lastStoredVolume) >= TELEMETRY_VOLUME_DELTA_LITERS);
        const storeHistory =
          bench ||
          lastStoredAt === null ||
          nowMs - lastStoredAt >= TELEMETRY_STORE_INTERVAL_MS ||
          payload.valve !== row.valve ||
          payload.status !== row.status ||
          source !== row.volume_source ||
          accounting.overflowing !== wasOverflowing ||
          volumeChanged;

        if (storeHistory) {
          const ratio = volume === null ? null : fillRatio(volume, capacity);
          await tx.query(
            `insert into public.telemetry
             (collector_id, device_id, recorded_at, uptime_ms, seq, distance_mm, volume_liters, fill_ratio, level_state, valve, status,
              overflowing, is_simulated, height_mm, device_volume_liters, volume_source, calibration_id, sensor_model,
              sensor_diagnostics, bench_mode)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19::jsonb, $20)`,
            [
              row.id,
              device.deviceId,
              date(nowMs),
              payload.uptime_ms,
              payload.seq,
              payload.distance_mm,
              volume,
              ratio === null ? null : Math.round(ratio * 10_000) / 10_000,
              ratio === null ? null : getLevelState(ratio).id,
              payload.valve,
              payload.status,
              accounting.overflowing,
              device.isSimulated,
              heightMm,
              payload.volume_liters ?? null,
              source,
              source === "calibration" ? model!.id : null,
              payload.sensor_model ?? null,
              payload.sensor_diagnostics ? JSON.stringify(payload.sensor_diagnostics) : null,
              bench,
            ],
          );
        }

        await tx.query(
          `update public.collector_state
           set device_id = $2, last_seen_at = $3, uptime_ms = $4, seq = $5, distance_mm = $6, volume_liters = $7,
               valve = $8, status = $9, accounting = $10::jsonb, simulation = $11::jsonb,
               last_telemetry_at = case when $12 then $3 else last_telemetry_at end,
               last_telemetry_volume = case when $12 then $7 else last_telemetry_volume end,
               height_mm = $13, volume_source = $14, calibration_id = $15, sensor_model = coalesce($16, sensor_model),
               distance_samples = $17::jsonb, sensor_diagnostics = $18::jsonb, reported_hardware_revision = $19, updated_at = $3
           where collector_id = $1`,
          [
            row.id,
            device.deviceId,
            date(nowMs),
            payload.uptime_ms,
            payload.seq,
            payload.distance_mm,
            volume,
            payload.valve,
            payload.status,
            JSON.stringify(accounting),
            simulation ? JSON.stringify(simulation) : null,
            storeHistory,
            heightMm,
            source,
            source === "calibration" ? model!.id : null,
            payload.sensor_model ?? null,
            JSON.stringify(distanceSamples),
            payload.sensor_diagnostics ? JSON.stringify(payload.sensor_diagnostics) : null,
            payload.hardware_revision ?? null,
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
          next_poll_ms: current ? ACTIVE_POLL_MS : calibrationMode || bench ? CALIBRATION_POLL_MS : IDLE_POLL_MS,
          command: commandFor(current),
          simulation: simulation ? { settings: simulation.settings, action: simulation.pendingAction } : null,
          // A plataforma é a fonte da configuração: o firmware usa o driver deste sensor.
          hardware: { distance_sensor: row.distance_sensor, revision: row.hardware_revision },
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
        if (benchActive(row, now())) return fail(409, "Captador em ensaio de bancada. As missões voltam quando o ensaio terminar.");
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
