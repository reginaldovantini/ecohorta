import type {
  CalibrationCompletion,
  CalibrationPointDetail,
  CalibrationRecord,
  CalibrationStatus,
  CalibrationView,
} from "@/lib/collector/calibration-view";
import { normalizeCollectorCode } from "@/lib/collector/code";
import { assessDistanceStability, parseDistanceSamples } from "@/lib/collector/distance-stability";
import { getLevelState } from "@/lib/collector/level-state";
import {
  CALIBRATION_ALGORITHM,
  CALIBRATION_STEP_IDS,
  fitVolumeCalibration,
  modelFromFit,
  volumeFromDistance,
  type CalibrationDistances,
  type CalibrationFit,
  type CalibrationQuality,
  type CalibrationStepId,
} from "@/lib/collector/volume-calibration";
import { accountingFromJson, rebaseVolume } from "@/lib/collector/water-accounting";
import { isEducator, type Actor } from "./actor";
import {
  activeVolumeModel,
  BENCH_MODE_TTL_MS,
  benchActive,
  CALIBRATION_WATCH_MS,
  calibrationAppliesToDevice,
  COLLECTOR_SELECT,
  hardwareStatus,
  OFFLINE_AFTER_MS,
  type CollectorRow,
} from "./collector-service";
import { millis, num, numOrNull, type Database, type Queryable } from "./db/types";
import { fail, type ServiceResult } from "./errors";

/*
 * Calibração experimental de volume por captador (docs/CALIBRACAO.md).
 *
 * O navegador nunca informa distâncias ou volumes: ao "registrar" uma etapa,
 * o servidor usa a leitura ESTABILIZADA das telemetrias recentes do próprio
 * dispositivo. Concluída, a calibração vira uma nova versão (ativa ou recusada).
 * Nenhuma calibração concluída é apagada ou alterada (garantido também no banco).
 */

interface CalibrationRow {
  id: string;
  collector_id: string;
  device_id: string | null;
  sensor_model: string;
  hardware_revision: number;
  is_simulated: boolean;
  status: CalibrationStatus;
  version: number | null;
  created_by_nickname: string | null;
  created_at: Date | string;
  completed_at: Date | string | null;
  activated_at: Date | string | null;
  superseded_at: Date | string | null;
  zero_distance_mm: string | number | null;
  one_liter_distance_mm: string | number | null;
  two_liter_distance_mm: string | number | null;
  three_liter_distance_mm: string | number | null;
  maximum_distance_mm: string | number | null;
  point_details: unknown;
  calibration_constant: string | number | null;
  effective_diameter_mm: string | number | null;
  effective_height_mm: string | number | null;
  effective_capacity_liters: string | number | null;
  r_squared: string | number | null;
  max_residual_liters: string | number | null;
  quality: CalibrationQuality | null;
  quality_report: unknown;
  nominal_diameter_mm: string | number | null;
  nominal_useful_height_mm: string | number | null;
}

const COLUMN: Record<CalibrationStepId, string> = {
  zero: "zero_distance_mm",
  one: "one_liter_distance_mm",
  two: "two_liter_distance_mm",
  three: "three_liter_distance_mm",
  max: "maximum_distance_mm",
};

const CALIBRATION_SELECT = `
  select k.*, p.nickname as created_by_nickname
  from public.collector_calibrations k
  left join public.profiles p on p.id = k.created_by`;

const HISTORY_LIMIT = 20;
const notFound = fail(404, "Captador não encontrado.");
const forbidden = fail(403, "Somente professores e administradores calibram captadores.");

/**
 * Mantém (ou inicia) o ensaio de bancada: a água colocada à mão não entra no balanço
 * e as leituras são gravadas uma a uma. Termina sozinho depois de BENCH_MODE_TTL_MS sem uso.
 */
export async function keepBenchMode(q: Queryable, collectorId: string, actor: Actor, nowMs: number, { start }: { start: boolean }) {
  await q.query(
    `update public.collector_state
     set bench_started_at = case when bench_mode_until > $2 then bench_started_at else $2 end,
         bench_started_by = case when bench_mode_until > $2 then bench_started_by else $4 end,
         bench_mode_until = $3
     where collector_id = $1 and ($5 or bench_mode_until > $2)`,
    [collectorId, new Date(nowMs), new Date(nowMs + BENCH_MODE_TTL_MS), actor.profileId, start],
  );
}

const parseJson = <T>(value: unknown): T | null =>
  value === null || value === undefined ? null : ((typeof value === "string" ? JSON.parse(value) : value) as T);

/** Guarda só números que cabem na coluna; valores absurdos de uma calibração ruim viram nulos. */
const storable = (value: number | null | undefined, maxAbs: number, positive = false) =>
  value === null || value === undefined || !Number.isFinite(value) || Math.abs(value) > maxAbs || (positive && value <= 0) ? null : value;

function distancesOf(row: CalibrationRow): CalibrationRecord["distances"] {
  return {
    zeroMm: numOrNull(row.zero_distance_mm),
    oneLiterMm: numOrNull(row.one_liter_distance_mm),
    twoLitersMm: numOrNull(row.two_liter_distance_mm),
    threeLitersMm: numOrNull(row.three_liter_distance_mm),
    maximumMm: numOrNull(row.maximum_distance_mm),
  };
}

function completeDistances(row: CalibrationRow): CalibrationDistances | null {
  const d = distancesOf(row);
  if (d.zeroMm === null || d.oneLiterMm === null || d.twoLitersMm === null || d.threeLitersMm === null || d.maximumMm === null) return null;
  return d as CalibrationDistances;
}

const nominalOf = (row: CalibrationRow) => ({
  diameterMm: numOrNull(row.nominal_diameter_mm),
  usefulHeightMm: numOrNull(row.nominal_useful_height_mm),
});

function nextStepOf(row: CalibrationRow): CalibrationStepId | null {
  return CALIBRATION_STEP_IDS.find((step) => row[COLUMN[step] as keyof CalibrationRow] === null) ?? null;
}

function toRecord(row: CalibrationRow): CalibrationRecord {
  return {
    id: row.id,
    version: row.version,
    status: row.status,
    quality: row.quality,
    sensorModel: row.sensor_model,
    hardwareRevision: row.hardware_revision,
    isSimulated: row.is_simulated,
    createdAt: millis(row.created_at)!,
    completedAt: millis(row.completed_at),
    activatedAt: millis(row.activated_at),
    supersededAt: millis(row.superseded_at),
    createdBy: row.created_by_nickname,
    distances: distancesOf(row),
    points: parseJson<CalibrationRecord["points"]>(row.point_details) ?? {},
    constantLitersPerMm: numOrNull(row.calibration_constant),
    effectiveDiameterMm: numOrNull(row.effective_diameter_mm),
    effectiveHeightMm: numOrNull(row.effective_height_mm),
    effectiveCapacityLiters: numOrNull(row.effective_capacity_liters),
    rSquared: numOrNull(row.r_squared),
    maxResidualLiters: numOrNull(row.max_residual_liters),
    nominalDiameterMm: numOrNull(row.nominal_diameter_mm),
    nominalUsefulHeightMm: numOrNull(row.nominal_useful_height_mm),
    report: parseJson<CalibrationFit>(row.quality_report),
  };
}

export function createCalibrationService({ db, now = Date.now }: { db: Database; now?: () => number }) {
  async function loadCollector(q: Queryable, actor: Actor, code: string, lock = false) {
    const normalized = normalizeCollectorCode(code);
    if (!normalized) return null;
    const { rows } = await q.query<CollectorRow>(`${COLLECTOR_SELECT} where c.code = $1${lock ? " for update of s" : ""}`, [normalized]);
    const row = rows[0];
    return row && row.school_id === actor.schoolId ? row : null;
  }

  async function loadDraft(q: Queryable, collectorId: string, lock = false) {
    const { rows } = await q.query<CalibrationRow>(
      `${CALIBRATION_SELECT} where k.collector_id = $1 and k.status = 'draft'${lock ? " for update of k" : ""}`,
      [collectorId],
    );
    return rows[0] ?? null;
  }

  async function buildView(q: Queryable, row: CollectorRow, nowMs: number): Promise<CalibrationView> {
    const { rows } = await q.query<CalibrationRow>(
      `${CALIBRATION_SELECT}
       where k.collector_id = $1 and (k.status in ('draft', 'active') or k.version is not null)
       order by k.version desc nulls first, k.created_at desc
       limit $2`,
      [row.id, HISTORY_LIMIT + 1],
    );
    const draftRow = rows.find((item) => item.status === "draft") ?? null;
    const activeRow = rows.find((item) => item.status === "active") ?? null;
    const history = rows.filter((item) => item.version !== null).slice(0, HISTORY_LIMIT).map(toRecord);

    const lastSeen = millis(row.last_seen_at);
    const online = lastSeen !== null && nowMs - lastSeen <= OFFLINE_AFTER_MS;
    const stability = assessDistanceStability(parseDistanceSamples(row.distance_samples), nowMs);
    const lastDistanceMm = numOrNull(row.distance_mm);
    const hardware = hardwareStatus(row, online);
    const model = hardware.compatibility === "incompatible" ? null : activeVolumeModel(row);
    const converted = model ? volumeFromDistance(model, stability.distanceMm ?? lastDistanceMm) : null;

    const draftDistances = draftRow ? completeDistances(draftRow) : null;
    return {
      serverTime: nowMs,
      collector: {
        code: row.code,
        name: row.name,
        location: row.location,
        configuredCapacityLiters: num(row.capacity_liters),
        nominalDiameterMm: numOrNull(row.nominal_diameter_mm),
        nominalUsefulHeightMm: numOrNull(row.nominal_useful_height_mm),
        deviceKey: row.device_key,
        isSimulated: row.is_simulated ?? false,
        sensorModel: row.sensor_model,
        benchActive: benchActive(row, nowMs),
      },
      hardware,
      live: {
        online,
        lastDistanceMm,
        measuredAt: lastSeen,
        stability,
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
      active: activeRow ? toRecord(activeRow) : null,
      activeAppliesToDevice: activeRow ? calibrationAppliesToDevice(row) : false,
      draft: draftRow
        ? {
            ...toRecord(draftRow),
            nextStep: nextStepOf(draftRow),
            preview: draftDistances ? fitVolumeCalibration(draftDistances, nominalOf(draftRow)) : null,
          }
        : null,
      history,
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

  return {
    /**
     * Estado da calibração e leitura ao vivo. `watch` mantém o dispositivo enviando
     * leituras a cada 1 s enquanto a tela está aberta.
     */
    async getView(actor: Actor, code: string, { watch = true } = {}): Promise<ServiceResult<CalibrationView>> {
      return withCollector(actor, code, async (tx, row, nowMs) => {
        if (watch) {
          await tx.query("update public.collector_state set calibration_mode_until = $2 where collector_id = $1", [
            row.id,
            new Date(nowMs + CALIBRATION_WATCH_MS),
          ]);
          await keepBenchMode(tx, row.id, actor, nowMs, { start: false });
        }
        const current = watch ? (await loadCollector(tx, actor, row.code))! : row;
        return { ok: true, value: await buildView(tx, current, nowMs) };
      });
    },

    /** Inicia um novo procedimento. Um procedimento anterior não concluído é cancelado (nunca apagado). */
    async startSession(actor: Actor, code: string): Promise<ServiceResult<CalibrationView>> {
      return withCollector(actor, code, async (tx, row, nowMs) => {
        if (!row.device_id) return fail(409, "Este captador não tem dispositivo ativo para medir.");
        const lastSeen = millis(row.last_seen_at);
        const hardware = hardwareStatus(row, lastSeen !== null && nowMs - lastSeen <= OFFLINE_AFTER_MS);
        if (hardware.compatibility === "incompatible") {
          return fail(409, `INCOMPATIBILIDADE DE HARDWARE: ${hardware.message} Resolva em Ligações antes de calibrar.`);
        }
        await tx.query("update public.collector_calibrations set status = 'cancelled' where collector_id = $1 and status = 'draft'", [row.id]);
        // A calibração fica vinculada ao sensor CONFIGURADO e à revisão de hardware atual.
        await tx.query(
          `insert into public.collector_calibrations
           (collector_id, device_id, sensor_model, hardware_revision, is_simulated, created_by, created_at, nominal_diameter_mm,
            nominal_useful_height_mm, algorithm)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            row.id,
            row.device_id,
            row.distance_sensor,
            row.hardware_revision,
            row.is_simulated ?? false,
            actor.profileId,
            new Date(nowMs),
            row.nominal_diameter_mm,
            row.nominal_useful_height_mm,
            CALIBRATION_ALGORITHM,
          ],
        );
        // Calibrar é um ensaio de bancada: a água colocada à mão não entra no balanço hídrico.
        await keepBenchMode(tx, row.id, actor, nowMs, { start: true });
        return { ok: true, value: await buildView(tx, (await loadCollector(tx, actor, row.code))!, nowMs) };
      });
    },

    /**
     * Registra a etapa com a leitura estabilizada do servidor. As etapas seguem a ordem;
     * registrar de novo uma etapa já feita descarta as seguintes (refazer a partir dali).
     */
    async registerPoint(actor: Actor, code: string, step: CalibrationStepId): Promise<ServiceResult<CalibrationView>> {
      return withCollector(actor, code, async (tx, row, nowMs) => {
        const draft = await loadDraft(tx, row.id, true);
        if (!draft) return fail(409, "Inicie a calibração antes de registrar leituras.");

        const index = CALIBRATION_STEP_IDS.indexOf(step);
        const next = nextStepOf(draft);
        const nextIndex = next === null ? CALIBRATION_STEP_IDS.length : CALIBRATION_STEP_IDS.indexOf(next);
        if (index > nextIndex) return fail(409, "Registre as etapas em ordem: zero, 1 L, 2 L, 3 L e nível máximo.");

        if (!row.device_id || row.device_id !== draft.device_id || row.state_device_id !== draft.device_id) {
          return fail(409, "O dispositivo do captador mudou durante a calibração. Reinicie o procedimento.");
        }
        if (draft.hardware_revision !== row.hardware_revision || draft.sensor_model !== row.distance_sensor) {
          return fail(409, "A configuração de hardware mudou durante a calibração. Reinicie o procedimento.");
        }
        // A leitura precisa vir do driver do sensor desta calibração (firmware antigo, sem informar o sensor, é aceito).
        if (row.sensor_model !== null && row.sensor_model !== draft.sensor_model) {
          return fail(
            409,
            `INCOMPATIBILIDADE DE HARDWARE: o firmware está usando o ${row.sensor_model}, mas esta calibração é do ${draft.sensor_model}. Confira o sensor em Ligações.`,
          );
        }
        const lastSeen = millis(row.last_seen_at);
        if (lastSeen === null || nowMs - lastSeen > OFFLINE_AFTER_MS) return fail(409, "Sensor sem conexão. Aguarde novas leituras.");

        const stability = assessDistanceStability(parseDistanceSamples(row.distance_samples), nowMs);
        if (stability.state !== "stable" || stability.distanceMm === null) {
          return fail(409, `Leitura ainda não estável: ${stability.message}`);
        }

        const later = CALIBRATION_STEP_IDS.slice(index + 1);
        const points = parseJson<Record<string, CalibrationPointDetail>>(draft.point_details) ?? {};
        for (const id of later) delete points[id];
        points[step] = { distanceMm: stability.distanceMm, stdMm: stability.stdMm, readings: stability.readings, recordedAt: nowMs };

        const clearLater = later.map((id) => `${COLUMN[id]} = null`).join(", ");
        await tx.query(
          `update public.collector_calibrations
           set ${COLUMN[step]} = $2, point_details = $3::jsonb${clearLater ? `, ${clearLater}` : ""}
           where id = $1`,
          [draft.id, stability.distanceMm, JSON.stringify(points)],
        );
        await keepBenchMode(tx, row.id, actor, nowMs, { start: true });
        return { ok: true, value: await buildView(tx, (await loadCollector(tx, actor, row.code))!, nowMs) };
      });
    },

    /**
     * Conclui: calcula o ajuste, gera a próxima versão e ativa somente se a qualidade for aceitável.
     * Uma calibração inconsistente fica registrada como recusada e a ativa anterior continua valendo.
     */
    async completeSession(actor: Actor, code: string): Promise<ServiceResult<CalibrationCompletion>> {
      return withCollector(actor, code, async (tx, row, nowMs) => {
        const draft = await loadDraft(tx, row.id, true);
        if (!draft) return fail(409, "Não há calibração em andamento.");
        const distances = completeDistances(draft);
        if (!distances) return fail(409, "Registre as cinco etapas antes de concluir.");

        const fit = fitVolumeCalibration(distances, nominalOf(draft));
        await keepBenchMode(tx, row.id, actor, nowMs, { start: true });
        const { rows } = await tx.query<{ version: number | null }>(
          "select max(version) as version from public.collector_calibrations where collector_id = $1",
          [row.id],
        );
        const version = (rows[0]?.version ?? 0) + 1;
        const at = new Date(nowMs);
        const results = [
          storable(fit.constantLitersPerMm, 9999, true),
          storable(fit.effectiveDiameterMm, 99_999),
          storable(fit.effectiveHeightMm, 9_999_999),
          storable(fit.effectiveCapacityLiters, 99_999),
          storable(fit.rSquared, 999),
          storable(fit.maxResidualLiters, 9999),
        ];

        if (fit.accepted) {
          await tx.query(
            "update public.collector_calibrations set status = 'superseded', superseded_at = $2 where collector_id = $1 and status = 'active'",
            [row.id, at],
          );
        }
        await tx.query(
          `update public.collector_calibrations
           set status = $2, version = $3, completed_at = $4, activated_at = $5, quality = $6, quality_report = $7::jsonb,
               calibration_constant = $8, effective_diameter_mm = $9, effective_height_mm = $10,
               effective_capacity_liters = $11, r_squared = $12, max_residual_liters = $13
           where id = $1`,
          [
            draft.id,
            fit.accepted ? "active" : "rejected",
            version,
            at,
            fit.accepted ? at : null,
            fit.quality,
            JSON.stringify(fit),
            ...results,
          ],
        );

        const model = modelFromFit(distances, fit);
        if (model) {
          // O volume atual passa a vir da nova calibração; a mudança de conversão não cria nem apaga água captada.
          const reading = volumeFromDistance(model, numOrNull(row.distance_mm));
          const volume = reading ? Math.round(reading.volumeLiters * 1000) / 1000 : null;
          const previous = numOrNull(row.volume_liters);
          const accounting = accountingFromJson(row.accounting);
          if (volume !== null && previous !== null) rebaseVolume(accounting, previous, volume);
          await tx.query(
            `update public.collector_state
             set volume_liters = $2, height_mm = $3, volume_source = $4, calibration_id = $5, accounting = $6::jsonb
             where collector_id = $1`,
            [
              row.id,
              volume,
              reading ? Math.round(reading.heightMm * 10) / 10 : null,
              reading ? "calibration" : "none",
              reading ? draft.id : null,
              JSON.stringify(accounting),
            ],
          );
        }

        const updated = (await loadCollector(tx, actor, row.code))!;
        return {
          ok: true,
          value: { status: fit.accepted ? "active" : "rejected", version, fit, view: await buildView(tx, updated, nowMs) },
        };
      });
    },

    /** Cancela o procedimento em andamento. O rascunho fica no histórico como cancelado. */
    async cancelSession(actor: Actor, code: string): Promise<ServiceResult<CalibrationView>> {
      return withCollector(actor, code, async (tx, row, nowMs) => {
        await tx.query("update public.collector_calibrations set status = 'cancelled' where collector_id = $1 and status = 'draft'", [row.id]);
        return { ok: true, value: await buildView(tx, row, nowMs) };
      });
    },
  };
}

export type CalibrationService = ReturnType<typeof createCalibrationService>;
