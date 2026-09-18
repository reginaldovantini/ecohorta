import type { BenchReading, BenchView, ObservationCondition, SensorObservationRecord, ValidationRecord } from "@/lib/collector/bench-view";
import { normalizeCollectorCode } from "@/lib/collector/code";
import { assessDistanceStability, parseDistanceSamples } from "@/lib/collector/distance-stability";
import { getLevelState } from "@/lib/collector/level-state";
import { evaluateValidation, summarizeValidations, type ValidationMethod } from "@/lib/collector/validation";
import { DEFAULT_SENSOR_MODEL, volumeFromDistance } from "@/lib/collector/volume-calibration";
import type { SensorDiagnostics } from "@/lib/iot/api-schema";
import type { DeviceStatus, VolumeSource } from "@/lib/iot/types";
import { isEducator, type Actor } from "./actor";
import { keepBenchMode } from "./calibration-service";
import {
  activeVolumeModel,
  benchActive,
  CALIBRATION_WATCH_MS,
  calibrationAppliesToDevice,
  calibrationMismatch,
  COLLECTOR_SELECT,
  hardwareStatus,
  OFFLINE_AFTER_MS,
  type CollectorRow,
} from "./collector-service";
import { millis, num, numOrNull, type Database, type Queryable } from "./db/types";
import { fail, type ServiceResult } from "./errors";

/*
 * BANCADA: ensaio físico do captador sem missão (docs/HARDWARE.md, "Protocolo de validação física").
 *
 * - Diagnóstico ao vivo do sensor de distância (estabilidade, intervalo entre leituras, inválidas, sinal)
 *   e compatibilidade entre o sensor configurado e o driver em uso no firmware.
 * - Observações: registram o comportamento do sensor como ele é — inclusive leituras
 *   instáveis ou inválidas — com a altura lida na mangueira transparente como referência.
 * - Validações: volume físico conhecido × volume calculado pela calibração ativa.
 *   Nunca alteram a calibração e não têm limite de aprovação.
 * Distância e volume calculado vêm sempre do servidor.
 */

const READINGS_WINDOW_MS = 10 * 60_000;
const READINGS_LIMIT = 300;
const OBSERVATIONS_LIMIT = 20;
const VALIDATIONS_LIMIT = 50;
const forbidden = fail(403, "Somente professores e administradores usam a bancada.");
const notFound = fail(404, "Captador não encontrado.");
const needsBench = fail(409, "Inicie o ensaio de bancada antes de registrar (a água colocada à mão não pode entrar no balanço).");

const round1 = (value: number) => Math.round(value * 10) / 10;
const round3 = (value: number) => Math.round(value * 1000) / 1000;
const parseJson = <T>(value: unknown): T | null =>
  value === null || value === undefined ? null : ((typeof value === "string" ? JSON.parse(value) : value) as T);

interface ObservationRow {
  id: string;
  created_at: Date | string;
  created_by_nickname: string | null;
  condition: ObservationCondition;
  note: string | null;
  reference_height_mm: string | number | null;
  stability_state: SensorObservationRecord["stabilityState"];
  distance_mm: string | number | null;
  std_mm: string | number | null;
  drift_mm: string | number | null;
  readings: number;
  outliers: number;
  invalid: number;
  total: number;
  average_interval_ms: number | null;
  height_mm: string | number | null;
  volume_liters: string | number | null;
  calibration_version: number | null;
  sensor_diagnostics: unknown;
  is_simulated: boolean;
}

interface ValidationRow {
  id: string;
  created_at: Date | string;
  created_by_nickname: string | null;
  calibration_id: string;
  calibration_version: number;
  sensor_model: string;
  is_simulated: boolean;
  known_volume_liters: string | number;
  measurement_method: ValidationMethod;
  known_mass_kg: string | number | null;
  note: string | null;
  distance_mm: string | number;
  distance_std_mm: string | number | null;
  readings: number;
  height_mm: string | number;
  calculated_volume_liters: string | number;
  raw_volume_liters: string | number;
  below_zero: boolean;
  above_maximum: boolean;
  error_liters: string | number;
  absolute_error_liters: string | number;
  percent_error: string | number | null;
  absolute_percent_error: string | number | null;
}

const toObservation = (row: ObservationRow): SensorObservationRecord => ({
  id: row.id,
  createdAt: millis(row.created_at)!,
  createdBy: row.created_by_nickname,
  condition: row.condition,
  note: row.note,
  referenceHeightMm: numOrNull(row.reference_height_mm),
  stabilityState: row.stability_state,
  distanceMm: numOrNull(row.distance_mm),
  stdMm: numOrNull(row.std_mm),
  driftMm: numOrNull(row.drift_mm),
  readings: row.readings,
  outliers: row.outliers,
  invalid: row.invalid,
  total: row.total,
  averageIntervalMs: row.average_interval_ms,
  heightMm: numOrNull(row.height_mm),
  volumeLiters: numOrNull(row.volume_liters),
  calibrationVersion: row.calibration_version,
  sensorDiagnostics: parseJson<SensorDiagnostics>(row.sensor_diagnostics),
  isSimulated: row.is_simulated,
});

const toValidation = (row: ValidationRow): ValidationRecord => ({
  id: row.id,
  createdAt: millis(row.created_at)!,
  createdBy: row.created_by_nickname,
  calibrationId: row.calibration_id,
  calibrationVersion: row.calibration_version,
  sensorModel: row.sensor_model,
  isSimulated: row.is_simulated,
  knownVolumeLiters: num(row.known_volume_liters),
  measurementMethod: row.measurement_method,
  knownMassKg: numOrNull(row.known_mass_kg),
  note: row.note,
  distanceMm: num(row.distance_mm),
  distanceStdMm: numOrNull(row.distance_std_mm),
  readings: row.readings,
  heightMm: num(row.height_mm),
  calculatedVolumeLiters: num(row.calculated_volume_liters),
  rawVolumeLiters: num(row.raw_volume_liters),
  belowZero: row.below_zero,
  aboveMaximum: row.above_maximum,
  errorLiters: num(row.error_liters),
  absoluteErrorLiters: num(row.absolute_error_liters),
  percentError: numOrNull(row.percent_error),
  absolutePercentError: numOrNull(row.absolute_percent_error),
});

export function createBenchService({ db, now = Date.now }: { db: Database; now?: () => number }) {
  async function loadCollector(q: Queryable, actor: Actor, code: string, lock = false) {
    const normalized = normalizeCollectorCode(code);
    if (!normalized) return null;
    const { rows } = await q.query<CollectorRow>(`${COLLECTOR_SELECT} where c.code = $1${lock ? " for update of s" : ""}`, [normalized]);
    const row = rows[0];
    return row && row.school_id === actor.schoolId ? row : null;
  }

  async function buildView(q: Queryable, row: CollectorRow, nowMs: number): Promise<BenchView> {
    const stability = assessDistanceStability(parseDistanceSamples(row.distance_samples), nowMs);
    const lastSeen = millis(row.last_seen_at);
    const lastDistanceMm = numOrNull(row.distance_mm);
    const hardware = hardwareStatus(row, lastSeen !== null && nowMs - lastSeen <= OFFLINE_AFTER_MS);
    const model = hardware.compatibility === "incompatible" ? null : activeVolumeModel(row);
    const converted = model ? volumeFromDistance(model, stability.distanceMm ?? lastDistanceMm) : null;

    const readings = await q.query<{
      recorded_at: Date | string;
      distance_mm: string | number | null;
      height_mm: string | number | null;
      volume_liters: string | number | null;
      volume_source: VolumeSource;
      status: DeviceStatus;
      bench_mode: boolean;
    }>(
      `select recorded_at, distance_mm, height_mm, volume_liters, volume_source, status, bench_mode
       from public.telemetry where collector_id = $1 and recorded_at >= $2
       order by recorded_at desc limit $3`,
      [row.id, new Date(nowMs - READINGS_WINDOW_MS), READINGS_LIMIT],
    );
    const observations = await q.query<ObservationRow>(
      `select o.*, p.nickname as created_by_nickname, k.version as calibration_version
       from public.sensor_observations o
       left join public.profiles p on p.id = o.created_by
       left join public.collector_calibrations k on k.id = o.calibration_id
       where o.collector_id = $1 order by o.created_at desc limit $2`,
      [row.id, OBSERVATIONS_LIMIT],
    );
    const validations = await q.query<ValidationRow>(
      `select v.*, p.nickname as created_by_nickname, k.version as calibration_version
       from public.calibration_validations v
       join public.collector_calibrations k on k.id = v.calibration_id
       left join public.profiles p on p.id = v.created_by
       where v.collector_id = $1 order by v.created_at desc limit $2`,
      [row.id, VALIDATIONS_LIMIT],
    );
    const validationRecords = validations.rows.map(toValidation);
    const benchUntil = millis(row.bench_mode_until);
    const startedBy = row.bench_started_by
      ? ((await q.query<{ nickname: string | null }>("select nickname from public.profiles where id = $1", [row.bench_started_by])).rows[0]
          ?.nickname ?? null)
      : null;

    return {
      serverTime: nowMs,
      collector: {
        code: row.code,
        name: row.name,
        location: row.location,
        deviceKey: row.device_key,
        firmwareVersion: row.firmware_version,
        sensorModel: row.sensor_model,
        isSimulated: row.is_simulated ?? false,
        configuredCapacityLiters: num(row.capacity_liters),
        nominalDiameterMm: numOrNull(row.nominal_diameter_mm),
        nominalUsefulHeightMm: numOrNull(row.nominal_useful_height_mm),
      },
      hardware,
      bench: {
        active: benchActive(row, nowMs),
        startedAt: benchActive(row, nowMs) ? millis(row.bench_started_at) : null,
        until: benchActive(row, nowMs) ? benchUntil : null,
        startedBy: benchActive(row, nowMs) ? startedBy : null,
      },
      live: {
        online: lastSeen !== null && nowMs - lastSeen <= OFFLINE_AFTER_MS,
        measuredAt: lastSeen,
        deviceStatus: row.status,
        lastDistanceMm,
        stability,
        diagnostics: parseJson<SensorDiagnostics>(row.sensor_diagnostics),
        volume: converted
          ? {
              liters: converted.volumeLiters,
              fillRatio: converted.fillRatio,
              heightMm: converted.heightMm,
              levelState: getLevelState(converted.fillRatio).id,
              belowZero: converted.belowZero,
              aboveMaximum: converted.aboveMaximum,
            }
          : null,
      },
      calibration:
        row.calibration_id && row.calibration_version !== null
          ? {
              id: row.calibration_id,
              version: row.calibration_version,
              constantLitersPerMm: num(row.calibration_constant),
              capacityLiters: num(row.calibration_capacity_liters),
              effectiveDiameterMm: num(row.calibration_diameter_mm),
              effectiveHeightMm: num(row.calibration_height_mm),
              isSimulated: row.calibration_is_simulated ?? false,
              appliesToDevice: calibrationAppliesToDevice(row),
            }
          : null,
      readings: readings.rows
        .map(
          (item): BenchReading => ({
            at: millis(item.recorded_at)!,
            distanceMm: numOrNull(item.distance_mm),
            heightMm: numOrNull(item.height_mm),
            volumeLiters: numOrNull(item.volume_liters),
            volumeSource: item.volume_source,
            status: item.status,
            bench: item.bench_mode,
          }),
        )
        .reverse(),
      observations: observations.rows.map(toObservation),
      validations: validationRecords,
      validationSummary: summarizeValidations(validationRecords.filter((item) => item.calibrationId === model?.id)),
    };
  }

  const withCollector = async <T>(
    actor: Actor,
    code: string,
    fn: (tx: Queryable, row: CollectorRow, nowMs: number) => Promise<ServiceResult<T>>,
  ): Promise<ServiceResult<T>> => {
    if (!isEducator(actor)) return forbidden;
    return db.transaction(async (tx) => {
      const row = await loadCollector(tx, actor, code, true);
      if (!row) return notFound;
      return fn(tx, row, now());
    });
  };

  const reload = async (tx: Queryable, actor: Actor, row: CollectorRow) => (await loadCollector(tx, actor, row.code))!;

  return {
    /** Leitura ao vivo e registros. `watch` mantém leituras a cada 1 s e prolonga um ensaio em andamento. */
    async getView(actor: Actor, code: string, { watch = true } = {}): Promise<ServiceResult<BenchView>> {
      return withCollector(actor, code, async (tx, row, nowMs) => {
        if (!watch) return { ok: true, value: await buildView(tx, row, nowMs) };
        await tx.query("update public.collector_state set calibration_mode_until = $2 where collector_id = $1", [
          row.id,
          new Date(nowMs + CALIBRATION_WATCH_MS),
        ]);
        await keepBenchMode(tx, row.id, actor, nowMs, { start: false });
        return { ok: true, value: await buildView(tx, await reload(tx, actor, row), nowMs) };
      });
    },

    /** Inicia o ensaio: leituras gravadas a cada 1 s, balanço pausado e missões bloqueadas. */
    async startBench(actor: Actor, code: string): Promise<ServiceResult<BenchView>> {
      return withCollector(actor, code, async (tx, row, nowMs) => {
        if (!row.device_id) return fail(409, "Este captador não tem dispositivo ativo.");
        await keepBenchMode(tx, row.id, actor, nowMs, { start: true });
        return { ok: true, value: await buildView(tx, await reload(tx, actor, row), nowMs) };
      });
    },

    /** Encerra o ensaio: o balanço volta a contar a partir do nível atual. */
    async endBench(actor: Actor, code: string): Promise<ServiceResult<BenchView>> {
      return withCollector(actor, code, async (tx, row, nowMs) => {
        await tx.query(
          "update public.collector_state set bench_mode_until = null, bench_started_at = null, bench_started_by = null where collector_id = $1",
          [row.id],
        );
        return { ok: true, value: await buildView(tx, await reload(tx, actor, row), nowMs) };
      });
    },

    /** Registra o comportamento atual do sensor — estável, instável ou inválido — para análise. */
    async recordObservation(
      actor: Actor,
      code: string,
      input: { condition: ObservationCondition; reference_height_mm?: number | null; note?: string | null },
    ): Promise<ServiceResult<{ view: BenchView; observation: SensorObservationRecord }>> {
      return withCollector(actor, code, async (tx, row, nowMs) => {
        if (!benchActive(row, nowMs)) return needsBench;
        if (!row.device_id) return fail(409, "Este captador não tem dispositivo ativo.");
        const samples = parseDistanceSamples(row.distance_samples);
        const stability = assessDistanceStability(samples, nowMs);
        const model = activeVolumeModel(row);
        const converted = model && stability.distanceMm !== null ? volumeFromDistance(model, stability.distanceMm) : null;

        const { rows } = await tx.query<{ id: string }>(
          `insert into public.sensor_observations
           (collector_id, device_id, sensor_model, is_simulated, created_by, created_at, condition, note, reference_height_mm,
            stability_state, distance_mm, median_mm, std_mm, drift_mm, readings, outliers, invalid, total, average_interval_ms,
            last_distance_mm, samples, sensor_diagnostics, calibration_id, height_mm, volume_liters)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21::jsonb, $22::jsonb, $23, $24, $25)
           returning id`,
          [
            row.id,
            row.device_id,
            row.sensor_model ?? DEFAULT_SENSOR_MODEL,
            row.is_simulated ?? false,
            actor.profileId,
            new Date(nowMs),
            input.condition,
            input.note ?? null,
            input.reference_height_mm ?? null,
            stability.state,
            stability.distanceMm,
            stability.medianMm,
            stability.stdMm,
            stability.driftMm,
            stability.readings,
            stability.outliers,
            stability.invalid,
            stability.total,
            stability.averageIntervalMs,
            numOrNull(row.distance_mm),
            JSON.stringify(samples),
            row.sensor_diagnostics === null ? null : JSON.stringify(parseJson(row.sensor_diagnostics)),
            converted ? model!.id : null,
            converted ? round1(converted.heightMm) : null,
            converted ? round3(converted.volumeLiters) : null,
          ],
        );
        await keepBenchMode(tx, row.id, actor, nowMs, { start: false });
        const view = await buildView(tx, await reload(tx, actor, row), nowMs);
        return { ok: true, value: { view, observation: view.observations.find((item) => item.id === rows[0]!.id)! } };
      });
    },

    /**
     * Validação experimental: volume físico conhecido × volume calculado pela calibração ativa
     * a partir da leitura ESTÁVEL do servidor. Não altera a calibração.
     */
    async recordValidation(
      actor: Actor,
      code: string,
      input: { known_volume_liters: number; measurement_method: ValidationMethod; known_mass_kg?: number | null; note?: string | null },
    ): Promise<ServiceResult<{ view: BenchView; validation: ValidationRecord }>> {
      return withCollector(actor, code, async (tx, row, nowMs) => {
        if (!benchActive(row, nowMs)) return needsBench;
        const model = activeVolumeModel(row);
        if (!model) {
          const mismatch = calibrationMismatch(row);
          return fail(
            409,
            mismatch === "other_sensor"
              ? "A calibração ativa pertence a outra configuração de sensor. Calibre o sensor atual antes de validar."
              : mismatch === "other_device"
                ? "A calibração ativa foi feita com outro dispositivo. Calibre este dispositivo antes de validar."
                : "Este captador não tem calibração ativa para validar.",
          );
        }
        const lastSeen = millis(row.last_seen_at);
        if (lastSeen === null || nowMs - lastSeen > OFFLINE_AFTER_MS) return fail(409, "Sensor sem conexão. Aguarde novas leituras.");
        const hardware = hardwareStatus(row, true);
        if (hardware.compatibility === "incompatible") return fail(409, `INCOMPATIBILIDADE DE HARDWARE: ${hardware.message}`);
        const stability = assessDistanceStability(parseDistanceSamples(row.distance_samples), nowMs);
        if (stability.state !== "stable" || stability.distanceMm === null) return fail(409, `Leitura ainda não estável: ${stability.message}`);

        const result = evaluateValidation(model, stability.distanceMm, input.known_volume_liters);
        if (!result) return fail(409, "A leitura atual não produz volume (fora da faixa do sensor).");

        const { rows } = await tx.query<{ id: string }>(
          `insert into public.calibration_validations
           (collector_id, calibration_id, device_id, sensor_model, is_simulated, created_by, created_at,
            known_volume_liters, measurement_method, known_mass_kg, note,
            distance_mm, distance_std_mm, readings, height_mm, calculated_volume_liters, raw_volume_liters, below_zero, above_maximum,
            error_liters, absolute_error_liters, percent_error, absolute_percent_error)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
           returning id`,
          [
            row.id,
            model.id,
            row.device_id,
            row.sensor_model ?? row.calibration_sensor_model ?? DEFAULT_SENSOR_MODEL,
            row.is_simulated ?? false,
            actor.profileId,
            new Date(nowMs),
            result.knownVolumeLiters,
            input.measurement_method,
            input.known_mass_kg ?? null,
            input.note ?? null,
            stability.distanceMm,
            stability.stdMm,
            stability.readings,
            result.heightMm,
            result.calculatedVolumeLiters,
            result.rawVolumeLiters,
            result.belowZero,
            result.aboveMaximum,
            result.errorLiters,
            result.absoluteErrorLiters,
            result.percentError,
            result.absolutePercentError,
          ],
        );
        await keepBenchMode(tx, row.id, actor, nowMs, { start: false });
        const view = await buildView(tx, await reload(tx, actor, row), nowMs);
        return { ok: true, value: { view, validation: view.validations.find((item) => item.id === rows[0]!.id)! } };
      });
    },

    /** Exportação para análise em planilha (CSV, separador ";" e vírgula decimal). */
    async exportCsv(actor: Actor, code: string, kind: "readings" | "observations" | "validations", hours = 24): Promise<ServiceResult<string>> {
      if (!isEducator(actor)) return forbidden;
      const row = await loadCollector(db, actor, code);
      if (!row) return notFound;
      const since = new Date(now() - Math.min(24 * 30, Math.max(1, hours)) * 3_600_000);
      const queries = {
        readings: `select t.recorded_at, c.code as captador, d.device_key as dispositivo, t.sensor_model, t.is_simulated as simulacao, t.bench_mode as bancada,
                     t.status, t.distance_mm, t.height_mm, t.volume_liters, t.fill_ratio, t.level_state, t.volume_source, k.version as calibracao,
                     t.device_volume_liters, t.sensor_diagnostics->>'valid_samples' as amostras_validas, t.sensor_diagnostics->>'samples' as amostras,
                     t.sensor_diagnostics->>'min_mm' as min_mm, t.sensor_diagnostics->>'max_mm' as max_mm,
                     t.sensor_diagnostics->>'signal_rate_mcps' as sinal_mcps, t.sensor_diagnostics->>'ambient_rate_mcps' as ambiente_mcps,
                     t.sensor_diagnostics->>'last_status' as status_sensor
                   from public.telemetry t join public.collectors c on c.id = t.collector_id left join public.devices d on d.id = t.device_id
                   left join public.collector_calibrations k on k.id = t.calibration_id
                   where t.collector_id = $1 and t.recorded_at >= $2 order by t.recorded_at limit 50000`,
        observations: `select o.created_at, c.code as captador, o.sensor_model, o.is_simulated as simulacao, o.condition as condicao, o.reference_height_mm as altura_mangueira_mm,
                         o.stability_state as estado, o.distance_mm, o.std_mm, o.drift_mm, o.readings as leituras, o.outliers, o.invalid as invalidas,
                         o.average_interval_ms as intervalo_medio_ms, o.height_mm, o.volume_liters, k.version as calibracao, o.note as nota
                       from public.sensor_observations o join public.collectors c on c.id = o.collector_id
                       left join public.collector_calibrations k on k.id = o.calibration_id
                       where o.collector_id = $1 and o.created_at >= $2 order by o.created_at`,
        validations: `select v.created_at, c.code as captador, k.version as calibracao, v.sensor_model, v.is_simulated as simulacao,
                        v.known_volume_liters as volume_conhecido_l, v.measurement_method as metodo, v.known_mass_kg as massa_kg,
                        v.distance_mm, v.distance_std_mm, v.readings as leituras, v.height_mm, v.calculated_volume_liters as volume_calculado_l,
                        v.error_liters as erro_l, v.absolute_error_liters as erro_absoluto_l, v.percent_error as erro_percentual,
                        v.absolute_percent_error as erro_percentual_absoluto, v.below_zero as abaixo_do_zero, v.above_maximum as acima_do_maximo, v.note as nota
                      from public.calibration_validations v join public.collectors c on c.id = v.collector_id
                      join public.collector_calibrations k on k.id = v.calibration_id
                      where v.collector_id = $1 and v.created_at >= $2 order by v.created_at`,
      };
      const { rows } = await db.query<Record<string, unknown>>(queries[kind], [row.id, since]);
      return { ok: true, value: toCsv(rows) };
    },
  };
}

function toCsv(rows: Record<string, unknown>[]) {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]!);
  const cell = (value: unknown) => {
    if (value === null || value === undefined) return "";
    if (value instanceof Date) return value.toISOString();
    const text = typeof value === "number" || (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value)) ? String(value).replace(".", ",") : String(value);
    return /[";\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return [headers.join(";"), ...rows.map((item) => headers.map((header) => cell(item[header])).join(";"))].join("\n");
}

export type BenchService = ReturnType<typeof createBenchService>;
