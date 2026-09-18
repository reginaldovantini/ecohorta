import { normalizeCollectorCode } from "@/lib/collector/code";
import type { DistanceSensorModel } from "@/lib/collector/distance-sensors";
import type { HardwareChangeRecord, HardwareView } from "@/lib/collector/hardware-view";
import { accountingFromJson } from "@/lib/collector/water-accounting";
import type { SensorDiagnostics } from "@/lib/iot/api-schema";
import { isEducator, type Actor } from "./actor";
import { keepBenchMode } from "./calibration-service";
import { benchActive, calibrationAppliesToDevice, COLLECTOR_SELECT, hardwareStatus, OFFLINE_AFTER_MS, type CollectorRow } from "./collector-service";
import { millis, numOrNull, type Database, type Queryable } from "./db/types";
import { fail, type ServiceResult } from "./errors";

/*
 * CONFIGURAÇÃO DE HARDWARE DO CAPTADOR (Administração → Captadores → Ligações).
 *
 * A plataforma é a fonte da configuração: o sensor de distância escolhido aqui
 * (VL53L0X ou VL53L1X) segue na resposta de cada telemetria e o firmware usa o
 * driver correspondente. A troca:
 * - exige a confirmação explícita de que o sensor físico instalado é o selecionado;
 * - cria a próxima revisão de hardware e fica no histórico (imutável);
 * - substitui a calibração ativa e cancela a calibração em andamento: leituras do
 *   sensor novo nunca são convertidas por uma calibração do sensor anterior;
 * - inicia um ensaio de bancada (missões bloqueadas) — sensor e medição primeiro.
 * Nenhum comando de válvula é criado.
 */

interface HistoryRow {
  id: string;
  revision: number;
  previous_sensor: DistanceSensorModel;
  new_sensor: DistanceSensorModel;
  changed_at: Date | string;
  changed_by_nickname: string | null;
  note: string | null;
  superseded_version: number | null;
  cancelled_calibration_id: string | null;
  is_simulated: boolean;
}

const HISTORY_LIMIT = 20;
const notFound = fail(404, "Captador não encontrado.");
const forbidden = fail(403, "Somente professores e administradores configuram o hardware dos captadores.");

const parseJson = <T>(value: unknown): T | null =>
  value === null || value === undefined ? null : ((typeof value === "string" ? JSON.parse(value) : value) as T);

const toChange = (row: HistoryRow): HardwareChangeRecord => ({
  id: row.id,
  revision: row.revision,
  previousSensor: row.previous_sensor,
  newSensor: row.new_sensor,
  changedAt: millis(row.changed_at)!,
  changedBy: row.changed_by_nickname,
  note: row.note,
  supersededCalibrationVersion: row.superseded_version,
  cancelledCalibration: row.cancelled_calibration_id !== null,
  isSimulated: row.is_simulated,
});

export function createHardwareService({ db, now = Date.now }: { db: Database; now?: () => number }) {
  async function loadCollector(q: Queryable, actor: Actor, code: string, lock = false) {
    const normalized = normalizeCollectorCode(code);
    if (!normalized) return null;
    const { rows } = await q.query<CollectorRow>(`${COLLECTOR_SELECT} where c.code = $1${lock ? " for update of s" : ""}`, [normalized]);
    const row = rows[0];
    return row && row.school_id === actor.schoolId ? row : null;
  }

  async function dispenseActive(q: Queryable, collectorId: string) {
    const { rows } = await q.query(
      "select 1 from public.device_commands where collector_id = $1 and status in ('QUEUED', 'EXECUTING', 'MEASURING') limit 1",
      [collectorId],
    );
    return rows.length > 0;
  }

  async function buildView(q: Queryable, row: CollectorRow, nowMs: number): Promise<HardwareView> {
    const lastSeen = millis(row.last_seen_at);
    const online = lastSeen !== null && nowMs - lastSeen <= OFFLINE_AFTER_MS;
    const hardware = hardwareStatus(row, online);
    const diagnostics = parseJson<SensorDiagnostics>(row.sensor_diagnostics);
    const history = await q.query<HistoryRow>(
      `select h.*, p.nickname as changed_by_nickname, k.version as superseded_version
       from public.collector_hardware_changes h
       left join public.profiles p on p.id = h.changed_by
       left join public.collector_calibrations k on k.id = h.superseded_calibration_id
       where h.collector_id = $1 order by h.revision desc limit $2`,
      [row.id, HISTORY_LIMIT],
    );
    const updatedBy = row.hardware_updated_by
      ? ((await q.query<{ nickname: string | null }>("select nickname from public.profiles where id = $1", [row.hardware_updated_by])).rows[0]
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
        isSimulated: row.is_simulated ?? false,
      },
      configuration: {
        distanceSensor: row.distance_sensor,
        revision: row.hardware_revision,
        updatedAt: millis(row.hardware_updated_at),
        updatedBy,
      },
      device: {
        online,
        measuredAt: lastSeen,
        status: online ? row.status : "OFFLINE",
        reportedSensor: hardware.reportedSensor,
        reportedRevision: hardware.reportedRevision,
        sensorState: hardware.sensorState,
        modelId: diagnostics?.model_id ?? null,
        i2cAck: diagnostics?.i2c_ack ?? null,
        i2cClockHz: diagnostics?.i2c_clock_hz ?? null,
        lastDistanceMm: numOrNull(row.distance_mm),
      },
      compatibility: { state: hardware.compatibility, message: hardware.message },
      calibration:
        row.calibration_id && row.calibration_version !== null
          ? {
              version: row.calibration_version,
              sensorModel: row.calibration_sensor_model ?? "—",
              hardwareRevision: row.calibration_hardware_revision ?? 1,
              applies: calibrationAppliesToDevice(row),
            }
          : null,
      benchActive: benchActive(row, nowMs),
      dispenseActive: await dispenseActive(q, row.id),
      history: history.rows.map(toChange),
    };
  }

  return {
    async getView(actor: Actor, code: string): Promise<ServiceResult<HardwareView>> {
      if (!isEducator(actor)) return forbidden;
      return db.transaction(async (tx) => {
        const row = await loadCollector(tx, actor, code);
        if (!row) return notFound;
        return { ok: true, value: await buildView(tx, row, now()) };
      });
    },

    /**
     * Troca o sensor de distância do captador. Nunca silenciosa: exige a confirmação
     * de que o sensor físico instalado corresponde ao selecionado.
     */
    async changeSensor(
      actor: Actor,
      code: string,
      input: { distanceSensor: DistanceSensorModel; confirmPhysicalMatch: boolean; note?: string | null },
    ): Promise<ServiceResult<{ view: HardwareView; change: HardwareChangeRecord }>> {
      if (!isEducator(actor)) return forbidden;
      if (!input.confirmPhysicalMatch) return fail(422, "Confirme que o sensor físico instalado corresponde ao sensor selecionado.");
      return db.transaction(async (tx) => {
        // Trava o estado do captador: serializa com a telemetria e com pedidos de liberação.
        const row = await loadCollector(tx, actor, code, true);
        if (!row) return notFound;
        if (row.distance_sensor === input.distanceSensor) return fail(409, `O captador já está configurado com o ${input.distanceSensor}.`);
        if (await dispenseActive(tx, row.id)) return fail(409, "Aguarde a liberação atual terminar antes de trocar o sensor.");

        const nowMs = now();
        const at = new Date(nowMs);
        const revision = row.hardware_revision + 1;
        await tx.query(
          `update public.collectors
           set distance_sensor = $2, hardware_revision = $3, hardware_updated_at = $4, hardware_updated_by = $5
           where id = $1`,
          [row.id, input.distanceSensor, revision, at, actor.profileId],
        );

        // A calibração do sensor anterior deixa de valer (fica no histórico) e a calibração em andamento é cancelada.
        const superseded = await tx.query<{ id: string }>(
          "update public.collector_calibrations set status = 'superseded', superseded_at = $2 where collector_id = $1 and status = 'active' returning id",
          [row.id, at],
        );
        const cancelled = await tx.query<{ id: string }>(
          "update public.collector_calibrations set status = 'cancelled' where collector_id = $1 and status = 'draft' returning id",
          [row.id],
        );

        // Volume desconhecido até a nova calibração; a janela de estabilização recomeça.
        // O balanço guarda o último volume conhecido: a nova calibração o reajusta no ensaio
        // de bancada (a troca do sensor não cria nem apaga água captada).
        const accounting = accountingFromJson(row.accounting);
        accounting.samples = [];
        await tx.query(
          `update public.collector_state
           set volume_liters = null, volume_source = 'none', calibration_id = null, height_mm = null,
               distance_samples = '[]'::jsonb, calibration_mode_until = null, accounting = $2::jsonb
           where collector_id = $1`,
          [row.id, JSON.stringify(accounting)],
        );
        // Sensor e medição primeiro: ensaio de bancada (missões bloqueadas) até testar e calibrar.
        await keepBenchMode(tx, row.id, actor, nowMs, { start: true });

        const inserted = await tx.query<{ id: string }>(
          `insert into public.collector_hardware_changes
           (collector_id, revision, previous_sensor, new_sensor, changed_by, changed_at, physical_match_confirmed, note,
            superseded_calibration_id, cancelled_calibration_id, is_simulated)
           values ($1, $2, $3, $4, $5, $6, true, $7, $8, $9, $10)
           returning id`,
          [
            row.id,
            revision,
            row.distance_sensor,
            input.distanceSensor,
            actor.profileId,
            at,
            input.note ?? null,
            superseded.rows[0]?.id ?? null,
            cancelled.rows[0]?.id ?? null,
            row.is_simulated ?? false,
          ],
        );

        const updated = (await loadCollector(tx, actor, row.code))!;
        const view = await buildView(tx, updated, nowMs);
        return { ok: true, value: { view, change: view.history.find((item) => item.id === inserted.rows[0]!.id)! } };
      });
    },
  };
}

export type HardwareService = ReturnType<typeof createHardwareService>;
