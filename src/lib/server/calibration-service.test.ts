import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getLevelState } from "@/lib/collector/level-state";
import { CALIBRATION_STEP_IDS, type CalibrationStepId } from "@/lib/collector/volume-calibration";
import { telemetryPayloadSchema, type TelemetryPayload } from "@/lib/iot/api-schema";
import { VIRTUAL_DEVICE_CONFIG } from "@/lib/iot/simulation-config";
import { createVirtualDevice, VIRTUAL_SENSOR_MODEL } from "@/lib/iot/virtual-device";
import { getMissionAvailability } from "@/lib/missions/availability";
import { findMission } from "@/lib/missions/catalog";
import type { Actor } from "./actor";
import { createBenchService } from "./bench-service";
import { createCalibrationService, type CalibrationService } from "./calibration-service";
import {
  CALIBRATION_POLL_MS,
  createCollectorService,
  IDLE_POLL_MS,
  type AuthenticatedDevice,
  type CollectorService,
} from "./collector-service";
import { createTestDatabase, IDS, resetTestDatabase, TEST_DEVICE_TOKEN, TEST_PEPPER } from "./db/test-db";
import type { Database } from "./db/types";

/*
 * Calibração experimental de volume sobre PostgreSQL real (PGlite):
 * leitura estabilizada, etapas, validação, versões, volume derivado e dispositivo virtual.
 */

const teacher: Actor = { profileId: IDS.teacher, schoolId: IDS.school, role: "teacher" };
const student: Actor = { profileId: IDS.student, schoolId: IDS.school, role: "student" };
const staff: Actor = { profileId: IDS.staff, schoolId: IDS.school, role: "staff" };
const otherSchoolTeacher: Actor = { profileId: IDS.otherStudent, schoolId: IDS.otherSchool, role: "teacher" };

/** Tubo DN100 real (96,8 mm internos): distâncias de cada etapa. */
const MM_PER_LITER = 1_000_000 / ((Math.PI / 4) * 96.8 ** 2);
const ZERO_MM = 1700;
const MAX_MM = 200;
const tube = (liters: number, mmPerLiter = MM_PER_LITER) => ZERO_MM - liters * mmPerLiter;
const TUBE_POINTS: Record<CalibrationStepId, number> = { zero: tube(0), one: tube(1), two: tube(2), three: tube(3), max: MAX_MM };
const NOISE = [0, 1, -1, 2, -2, 1, 0, -1, 1, 0];

let pg: PGlite;
let db: Database;
let clock: number;
let seq: number;
let collectors: CollectorService;
let calibrations: CalibrationService;
let device: AuthenticatedDevice;

function telemetry(distance: number | null, patch: Partial<TelemetryPayload> = {}): TelemetryPayload {
  seq++;
  return {
    device_id: "VIRTUAL-001",
    collector_code: "EC-001",
    seq,
    uptime_ms: seq * 1000,
    distance_mm: distance,
    volume_liters: 6,
    sensor_model: "VL53L1X",
    valve: "closed",
    status: "READY",
    fw_version: "sim-1",
    ...patch,
  };
}

/** Mantém a superfície parada em `distance` (com ruído de ±2 mm), uma leitura por segundo. */
async function hold(distance: number | null, readings = 20, patch: Partial<TelemetryPayload> = {}) {
  let response;
  for (let i = 0; i < readings; i++) {
    clock += 1000;
    response = await collectors.ingestTelemetry(device, telemetry(distance === null ? null : distance + NOISE[i % NOISE.length]!, patch));
  }
  return response!;
}

async function calibrate(points: Record<CalibrationStepId, number>, actor: Actor = teacher) {
  expect((await calibrations.startSession(actor, "EC-001")).ok).toBe(true);
  for (const step of CALIBRATION_STEP_IDS) {
    await hold(points[step]);
    const registered = await calibrations.registerPoint(actor, "EC-001", step);
    expect(registered).toMatchObject({ ok: true });
  }
  const completed = await calibrations.completeSession(actor, "EC-001");
  if (!completed.ok) throw new Error(completed.message);
  return completed.value;
}

const view = async () => {
  const result = await calibrations.getView(teacher, "EC-001");
  if (!result.ok) throw new Error(result.message);
  return result.value;
};

const snapshot = async () => (await collectors.getSnapshot(student, "EC-001"))!;

/** Calibrar inicia um ensaio de bancada; o operador o encerra antes de voltar às missões. */
const endBench = async () => {
  expect((await createBenchService({ db, now: () => clock }).endBench(teacher, "EC-001")).ok).toBe(true);
};

beforeAll(async () => {
  ({ pg, db } = await createTestDatabase());
}, 60_000);

beforeEach(async () => {
  await resetTestDatabase(db);
  clock = 1_000_000;
  seq = 0;
  collectors = createCollectorService({ db, pepper: TEST_PEPPER, now: () => clock });
  calibrations = createCalibrationService({ db, now: () => clock });
  device = (await collectors.authenticateDevice(`Bearer ${TEST_DEVICE_TOKEN}`, "VIRTUAL-001", "EC-001"))!;
});

describe("calibração — acesso", () => {
  it("é exclusiva de professores e administradores da escola", async () => {
    expect(await calibrations.getView(student, "EC-001")).toMatchObject({ ok: false, status: 403 });
    expect(await calibrations.startSession(staff, "EC-001")).toMatchObject({ ok: false, status: 403 });
    expect(await calibrations.getView(otherSchoolTeacher, "EC-001")).toMatchObject({ ok: false, status: 404 });
    expect((await calibrations.getView(teacher, "ec001")).ok).toBe(true);
  });
});

describe("calibração — leitura ao vivo", () => {
  it("mostra a distância estabilizada e acelera o envio de leituras com a tela aberta", async () => {
    await hold(1236, 3);
    expect((await view()).live.stability).toMatchObject({ state: "stabilizing", readings: 3 });

    expect((await hold(1236, 1)).next_poll_ms).toBe(CALIBRATION_POLL_MS);
    await hold(1236, 19);
    const live = (await view()).live;
    expect(live.stability.state).toBe("stable");
    expect(live.stability.distanceMm).toBeCloseTo(1236, 0);
    expect(live.volume).toBeNull(); // sem calibração ativa

    clock += 31_000;
    expect((await hold(1236, 1)).next_poll_ms).toBe(IDLE_POLL_MS);
  });

  it("marca leitura inválida quando o sensor não mede", async () => {
    await hold(null, 15, { status: "ERROR" });
    expect((await view()).live.stability.state).toBe("invalid");
  });
});

describe("calibração — procedimento", () => {
  it("só registra leitura estável e na ordem das etapas", async () => {
    await calibrations.startSession(teacher, "EC-001");
    await hold(ZERO_MM, 5);
    const unstable = await calibrations.registerPoint(teacher, "EC-001", "zero");
    expect(unstable).toMatchObject({ ok: false, status: 409 });
    expect(!unstable.ok && unstable.message).toMatch(/não estável/);

    await hold(ZERO_MM, 20);
    expect(await calibrations.registerPoint(teacher, "EC-001", "two")).toMatchObject({ ok: false, status: 409 });
    const registered = await calibrations.registerPoint(teacher, "EC-001", "zero");
    expect(registered.ok && registered.value.draft).toMatchObject({ nextStep: "one", status: "draft", version: null });
    expect(registered.ok && registered.value.draft?.points.zero?.distanceMm).toBeCloseTo(ZERO_MM, 0);

    // Nível mudando (água sendo adicionada): recusado.
    for (let i = 0; i < 20; i++) {
      clock += 1000;
      await collectors.ingestTelemetry(device, telemetry(ZERO_MM - i * 7));
    }
    expect(await calibrations.registerPoint(teacher, "EC-001", "one")).toMatchObject({ ok: false, status: 409 });
  });

  it("registrar de novo uma etapa descarta as seguintes", async () => {
    await calibrations.startSession(teacher, "EC-001");
    for (const step of ["zero", "one", "two"] as const) {
      await hold(TUBE_POINTS[step]);
      await calibrations.registerPoint(teacher, "EC-001", step);
    }
    await hold(tube(1) - 4);
    const redo = await calibrations.registerPoint(teacher, "EC-001", "one");
    expect(redo.ok && redo.value.draft).toMatchObject({ nextStep: "two", distances: { twoLitersMm: null } });
    expect(redo.ok && Object.keys(redo.value.draft!.points).sort()).toEqual(["one", "zero"]);
  });

  it("calcula a constante, ativa a versão 1 e passa a derivar o volume da distância", async () => {
    const result = await calibrate(TUBE_POINTS);
    expect(result).toMatchObject({ status: "active", version: 1 });
    expect(result.fit.quality).toBe("good");
    expect(result.fit.effectiveDiameterMm!).toBeCloseTo(96.8, 0);
    expect(result.fit.effectiveCapacityLiters!).toBeCloseTo(1500 / MM_PER_LITER, 1);
    expect(result.view.active).toMatchObject({ version: 1, status: "active", sensorModel: "VL53L1X", createdBy: "Prof. Rê", isSimulated: true });
    expect(result.view.draft).toBeNull();

    await hold(tube(3.5));
    const current = await snapshot();
    expect(current.telemetry.volumeSource).toBe("calibration");
    expect(current.telemetry.volumeLiters).toBeCloseTo(3.5, 1);
    expect(current.telemetry.heightMm!).toBeCloseTo(3.5 * MM_PER_LITER, -1);
    expect(current.info.capacityLiters).toBeCloseTo(1500 / MM_PER_LITER, 1);
    expect(current.calibration).toMatchObject({ version: 1, quality: "good", isSimulated: true });

    const live = (await view()).live.volume!;
    expect(live.liters).toBeCloseTo(3.5, 1);
    expect(live.levelState).toBe(getLevelState(live.fillRatio).id);

    const { rows } = await pg.query<{ volume_source: string; calibration_id: string; device_volume_liters: string; height_mm: string }>(
      "select volume_source, calibration_id, device_volume_liters, height_mm from telemetry order by id desc limit 1",
    );
    expect(rows[0]).toMatchObject({ volume_source: "calibration", calibration_id: result.view.active!.id });
    expect(Number(rows[0]!.device_volume_liters)).toBe(6); // o valor do dispositivo fica registrado, mas não é usado
  });

  it("calibração inconsistente fica registrada como recusada e não substitui a ativa", async () => {
    const first = await calibrate(TUBE_POINTS);
    const bad = await calibrate({ ...TUBE_POINTS, two: TUBE_POINTS.three, three: TUBE_POINTS.two });
    expect(bad).toMatchObject({ status: "rejected", version: 2 });
    expect(bad.fit.accepted).toBe(false);
    expect(bad.view.active?.id).toBe(first.view.active!.id);
    expect(bad.view.history.map((item) => [item.version, item.status])).toEqual([
      [2, "rejected"],
      [1, "active"],
    ]);
    expect((await snapshot()).calibration?.version).toBe(1);
  });

  it("nova calibração gera nova versão, preserva o histórico e não altera a água captada", async () => {
    await calibrate(TUBE_POINTS);
    await hold(tube(5));
    const before = (await snapshot()).totals;

    // Tubo recalibrado com diâmetro efetivo de 99 mm.
    const wider = 1_000_000 / ((Math.PI / 4) * 99 ** 2);
    const second = await calibrate({ zero: tube(0), one: tube(1, wider), two: tube(2, wider), three: tube(3, wider), max: MAX_MM });
    expect(second).toMatchObject({ status: "active", version: 2 });
    expect(second.view.history.map((item) => [item.version, item.status])).toEqual([
      [2, "active"],
      [1, "superseded"],
    ]);
    expect(second.view.history[1]!.supersededAt).not.toBeNull();
    expect(second.fit.effectiveDiameterMm!).toBeCloseTo(99, 0);

    const after = await snapshot();
    expect(after.calibration?.version).toBe(2);
    expect(after.totals.capturedLiters).toBeCloseTo(before.capturedLiters, 1);
    expect(after.totals.reusedLiters).toBe(before.reusedLiters);

    const versions = await pg.query<{ n: number }>("select count(*)::int as n from collector_calibrations where version is not null");
    expect(versions.rows[0]!.n).toBe(2);
  });

  it("cancelar ou reiniciar o procedimento não apaga nada", async () => {
    await calibrations.startSession(teacher, "EC-001");
    await calibrations.startSession(teacher, "EC-001");
    await calibrations.cancelSession(teacher, "EC-001");
    const { rows } = await pg.query<{ status: string }>("select status from collector_calibrations order by created_at");
    expect(rows.map((row) => row.status)).toEqual(["cancelled", "cancelled"]);
    expect((await view()).draft).toBeNull();
    expect(await calibrations.completeSession(teacher, "EC-001")).toMatchObject({ ok: false, status: 409 });
  });
});

describe("volume derivado na telemetria", () => {
  it("aceita dispositivo que envia só a distância (ESP32) e não inventa volume sem calibração", async () => {
    expect(telemetryPayloadSchema.safeParse({ ...telemetry(1236), volume_liters: undefined }).success).toBe(true);

    await hold(1236, 2, { volume_liters: undefined, status: "MAINTENANCE" });
    expect((await snapshot()).telemetry).toMatchObject({ volumeSource: "none", status: "MAINTENANCE", distanceMm: 1236 + NOISE[1]! });

    await hold(1236, 1, { volume_liters: undefined, status: "READY" });
    expect((await snapshot()).telemetry).toMatchObject({ volumeSource: "none", status: "CALIBRATING" });

    const { rows } = await pg.query<{ volume_liters: string | null; volume_source: string }>(
      "select volume_liters, volume_source from telemetry order by id desc limit 1",
    );
    expect(rows[0]).toEqual({ volume_liters: null, volume_source: "none" });
  });

  it("com calibração ativa, leitura ausente ou impossível não vira volume", async () => {
    await calibrate(TUBE_POINTS);
    await endBench(); // fim do ensaio: o captador volta ao status informado pelo dispositivo
    await hold(null, 1, { status: "ERROR" });
    expect((await snapshot()).telemetry).toMatchObject({ volumeSource: "none", status: "ERROR" });
    await hold(-5, 1);
    expect((await snapshot()).telemetry).toMatchObject({ volumeSource: "none", status: "CALIBRATING" });
    await hold(tube(2), 1);
    expect((await snapshot()).telemetry.volumeSource).toBe("calibration");
  });

  it("o balanço não conta a água adicionada à mão durante a calibração", async () => {
    await hold(ZERO_MM, 3); // volume informado pelo dispositivo: 6 L
    await calibrations.startSession(teacher, "EC-001");
    const before = (await snapshot()).totals.capturedLiters;
    await hold(ZERO_MM, 3, { volume_liters: 10 });
    await hold(ZERO_MM, 3, { volume_liters: 2 });
    expect((await snapshot()).totals.capturedLiters).toBeCloseTo(before, 6);
  });

  it("deriva o volume reutilizado das distâncias informadas no relatório da liberação", async () => {
    await calibrate(TUBE_POINTS);
    await endBench(); // missões ficam bloqueadas durante o ensaio de bancada
    await hold(tube(5));
    const commandId = "6b3c2d4e-7f8a-4b9c-8d0e-1f2a3b4c5d6e";
    const created = await collectors.requestDispense(student, "EC-001", {
      command_id: commandId,
      execution_id: "7c4d3e5f-8a9b-4c0d-9e1f-2a3b4c5d6e7f",
      mission_id: "hidratar-mudas",
    });
    expect(created.ok && created.value.status).toBe("QUEUED");

    clock += 1000;
    await collectors.ingestTelemetry(
      device,
      telemetry(tube(4), {
        command_report: {
          command_id: commandId,
          status: "COMPLETED",
          delivered_liters: 0.98,
          start_volume_liters: 5,
          end_volume_liters: 4.02,
          failure: null,
          started_uptime_ms: 1000,
          finished_uptime_ms: 40_000,
          start_distance_mm: tube(5),
          end_distance_mm: tube(4),
        },
      }),
    );
    const { rows } = await pg.query<{ measured_reuse_liters: string; calibration_id: string | null; delivered_liters: string }>(
      "select measured_reuse_liters, calibration_id, delivered_liters from device_commands where id = $1",
      [commandId],
    );
    expect(Number(rows[0]!.measured_reuse_liters)).toBeCloseTo(1, 1);
    expect(rows[0]!.calibration_id).not.toBeNull();
    expect(Number(rows[0]!.delivered_liters)).toBe(0.98); // conclusão e XP continuam pelo relatório medido
  });
});

describe("dispositivo virtual — mesma lógica de conversão", () => {
  function mulberry32(seed: number) {
    let state = seed;
    return () => {
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  it("calibra o captador virtual pela API e converte distâncias em litros, percentual, estado e disponibilidade", async () => {
    const virtual = createVirtualDevice(
      VIRTUAL_DEVICE_CONFIG,
      { volumeLiters: 0, settings: { inflowEnabled: false, inflowLitersPerHour: 0, faultNoFlow: false } },
      { random: mulberry32(11) },
    );
    const feed = async (readings: number) => {
      for (let i = 0; i < readings; i++) {
        virtual.advance(1000, 1000);
        clock += 1000;
        const reading = virtual.reading();
        seq++;
        await collectors.ingestTelemetry(device, {
          device_id: "VIRTUAL-001",
          collector_code: "EC-001",
          seq,
          uptime_ms: reading.uptimeMs,
          distance_mm: reading.distanceMm,
          volume_liters: reading.volumeLiters,
          sensor_model: VIRTUAL_SENSOR_MODEL,
          valve: reading.valve,
          status: reading.status,
          fw_version: "virtual-test",
        });
      }
    };

    await calibrations.startSession(teacher, "EC-001");
    const volumes: Record<CalibrationStepId, number> = { zero: 0, one: 1, two: 2, three: 3, max: VIRTUAL_DEVICE_CONFIG.capacityLiters };
    for (const step of CALIBRATION_STEP_IDS) {
      virtual.setVolume(volumes[step]);
      await feed(20);
      expect(await calibrations.registerPoint(teacher, "EC-001", step)).toMatchObject({ ok: true });
    }
    const completed = await calibrations.completeSession(teacher, "EC-001");
    expect(completed.ok && completed.value.status).toBe("active");
    const fit = completed.ok ? completed.value.fit : null;
    expect(fit!.effectiveCapacityLiters!).toBeCloseTo(12, 1);
    expect(fit!.effectiveDiameterMm!).toBeCloseTo(100, 0);
    await endBench(); // fim do ensaio: missões voltam a ficar disponíveis

    // Teste de distância arbitrária do VL53L1X.
    virtual.setDistance(1236);
    await feed(5);
    const current = await snapshot();
    const expectedLiters = ((1589 - 1236) * 12) / 1529;
    expect(current.telemetry.origin).toBe("simulation");
    expect(current.telemetry.volumeSource).toBe("calibration");
    expect(Math.abs(current.telemetry.volumeLiters - expectedLiters)).toBeLessThan(0.05);
    expect(Math.abs(current.telemetry.volumeLiters / current.info.capacityLiters - expectedLiters / 12)).toBeLessThan(0.01);
    expect(getLevelState(current.telemetry.volumeLiters / current.info.capacityLiters).id).toBe("low");
    expect(getMissionAvailability(findMission("hidratar-mudas")!, current, false).status).toBe("available");
    expect(getMissionAvailability(findMission("regar-jardim")!, current, false).status).toBe("waiting_water");

    // O painel da simulação também aceita distância e volume.
    await collectors.updateSimulation(teacher, "EC-001", { action: { type: "set_distance", distance_mm: 900 } });
    clock += 1000;
    const response = await collectors.ingestTelemetry(device, telemetry(1236));
    expect(response.simulation?.action).toMatchObject({ type: "set_distance", distance_mm: 900 });
  }, 60_000);
});
