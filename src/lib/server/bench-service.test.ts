import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CALIBRATION_STEP_IDS, type CalibrationStepId } from "@/lib/collector/volume-calibration";
import { telemetryPayloadSchema, type SensorDiagnostics, type TelemetryPayload } from "@/lib/iot/api-schema";
import type { Actor } from "./actor";
import { createBenchService, type BenchService } from "./bench-service";
import { createCalibrationService, type CalibrationService } from "./calibration-service";
import {
  BENCH_MODE_TTL_MS,
  CALIBRATION_POLL_MS,
  createCollectorService,
  IDLE_POLL_MS,
  type AuthenticatedDevice,
  type CollectorService,
} from "./collector-service";
import { createTestDatabase, IDS, resetTestDatabase, TEST_DEVICE_TOKEN, TEST_PEPPER } from "./db/test-db";
import type { Database } from "./db/types";
import { ensureCollector } from "./provisioning";

/*
 * Fase 3 — integração física: EC-001 REAL (ESP32 + VL53L1X) e SIM-001 (dispositivo virtual),
 * bancada, observações, validação experimental e separação REAL × SIMULAÇÃO. PostgreSQL real (PGlite).
 */

const teacher: Actor = { profileId: IDS.teacher, schoolId: IDS.school, role: "teacher" };
const student: Actor = { profileId: IDS.student, schoolId: IDS.school, role: "student" };
const otherSchoolTeacher: Actor = { profileId: IDS.otherStudent, schoolId: IDS.otherSchool, role: "teacher" };

const ESP32_TOKEN = "token-do-esp32-de-teste-suficientemente-longo";
const MM_PER_LITER = 1_000_000 / ((Math.PI / 4) * 96.8 ** 2);
const tube = (liters: number) => 1700 - liters * MM_PER_LITER;
const POINTS: Record<CalibrationStepId, number> = { zero: tube(0), one: tube(1), two: tube(2), three: tube(3), max: 200 };
const NOISE = [0, 1, -1, 2, -2, 1, 0, -1, 1, 0];

const DIAGNOSTICS: SensorDiagnostics = {
  samples: 9,
  valid_samples: 8,
  min_mm: 1234,
  max_mm: 1239,
  signal_rate_mcps: 3.41,
  ambient_rate_mcps: 0.12,
  status_counts: { "range valid": 8, "signal failure": 1 },
  last_status: "range valid",
  read_ms: 472,
  timing_budget_ms: 50,
  distance_mode: "long",
  roi: "16x16",
  rssi_dbm: -61,
};

let pg: PGlite;
let db: Database;
let clock: number;
let seq: number;
let collectors: CollectorService;
let calibrations: CalibrationService;
let bench: BenchService;
let esp32: AuthenticatedDevice;
let virtual: AuthenticatedDevice;

/** Telemetria do ESP32 físico: só distância, modelo do sensor e diagnóstico (sem volume). */
function real(distance: number | null, patch: Partial<TelemetryPayload> = {}): TelemetryPayload {
  seq++;
  return {
    device_id: "ESP32-001",
    collector_code: "EC-001",
    seq,
    uptime_ms: seq * 1000,
    distance_mm: distance,
    sensor_model: "VL53L1X",
    sensor_diagnostics: DIAGNOSTICS,
    valve: "unknown",
    status: distance === null ? "ERROR" : "MAINTENANCE",
    fw_version: "esp32-0.3.0",
    command_report: null,
    ...patch,
  };
}

async function holdReal(distance: number | null, readings = 20) {
  let response;
  for (let i = 0; i < readings; i++) {
    clock += 1000;
    response = await collectors.ingestTelemetry(esp32, real(distance === null ? null : distance + NOISE[i % NOISE.length]!));
  }
  return response!;
}

async function calibrateReal() {
  expect((await calibrations.startSession(teacher, "EC-001")).ok).toBe(true);
  for (const step of CALIBRATION_STEP_IDS) {
    await holdReal(POINTS[step]);
    expect(await calibrations.registerPoint(teacher, "EC-001", step)).toMatchObject({ ok: true });
  }
  const completed = await calibrations.completeSession(teacher, "EC-001");
  if (!completed.ok) throw new Error(completed.message);
  return completed.value;
}

const snapshot = async (code = "EC-001") => (await collectors.getSnapshot(student, code))!;
const benchView = async () => {
  const result = await bench.getView(teacher, "EC-001");
  if (!result.ok) throw new Error(result.message);
  return result.value;
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
  bench = createBenchService({ db, now: () => clock });

  // Convenção da Fase 3 aplicada sobre o cenário de teste (EC-001 começou simulado):
  // SIM-001 recebe o dispositivo virtual e EC-001 passa a ser o captador físico.
  await ensureCollector(db, {
    schoolId: IDS.school,
    code: "SIM-001",
    name: "Captador virtual",
    location: "Simulação",
    capacityLiters: 12,
    reserveLiters: 0.5,
    device: { deviceKey: "VIRTUAL-001", isSimulated: true, token: TEST_DEVICE_TOKEN, pepper: TEST_PEPPER },
  });
  await ensureCollector(db, {
    schoolId: IDS.school,
    code: "EC-001",
    name: "EcoCaptador",
    location: "Horta",
    capacityLiters: 11.8,
    reserveLiters: 0.5,
    nominalDiameterMm: 100,
    nominalUsefulHeightMm: 1500,
    device: { deviceKey: "ESP32-001", isSimulated: false, token: ESP32_TOKEN, pepper: TEST_PEPPER },
  });
  esp32 = (await collectors.authenticateDevice(`Bearer ${ESP32_TOKEN}`, "ESP32-001", "EC-001"))!;
  virtual = (await collectors.authenticateDevice(`Bearer ${TEST_DEVICE_TOKEN}`, "VIRTUAL-001", "SIM-001"))!;
});

describe("REAL × SIMULAÇÃO", () => {
  it("EC-001 é físico e SIM-001 é simulação, com credenciais próprias", async () => {
    expect(esp32).toMatchObject({ collectorCode: "EC-001", isSimulated: false, deviceKey: "ESP32-001" });
    expect(virtual).toMatchObject({ collectorCode: "SIM-001", isSimulated: true, deviceKey: "VIRTUAL-001" });
    expect(await collectors.authenticateDevice(`Bearer ${TEST_DEVICE_TOKEN}`, "VIRTUAL-001", "EC-001")).toBeNull();

    await holdReal(1236, 2);
    const physical = await snapshot("EC-001");
    expect(physical.telemetry.origin).toBe("device");
    expect(physical.simulation).toBeNull();
    expect(await collectors.updateSimulation(teacher, "EC-001", { action: { type: "set_level", ratio: 0.5 } })).toMatchObject({ ok: false, status: 403 });
  });

  it("ao virar físico, o EC-001 não herda estado, balanço nem calibração da simulação", async () => {
    // Recria o cenário antigo: EC-001 simulado com telemetria, balanço e calibração ativa.
    await resetTestDatabase(db);
    const old = (await collectors.authenticateDevice(`Bearer ${TEST_DEVICE_TOKEN}`, "VIRTUAL-001", "EC-001"))!;
    for (const [liters, index] of [[0, 0], [1, 1], [2, 2], [3, 3], [11.04, 4]] as const) {
      if (index === 0) await calibrations.startSession(teacher, "EC-001");
      for (let i = 0; i < 20; i++) {
        clock += 1000;
        seq++;
        await collectors.ingestTelemetry(old, {
          device_id: "VIRTUAL-001",
          collector_code: "EC-001",
          seq,
          uptime_ms: seq * 1000,
          distance_mm: tube(liters) + NOISE[i % 10]!,
          volume_liters: 6,
          valve: "closed",
          status: "READY",
          fw_version: "sim",
        });
      }
      await calibrations.registerPoint(teacher, "EC-001", CALIBRATION_STEP_IDS[index]!);
    }
    expect((await calibrations.completeSession(teacher, "EC-001")).ok).toBe(true);
    expect((await snapshot()).calibration).toMatchObject({ isSimulated: true, appliesToDevice: true });

    await ensureCollector(db, {
      schoolId: IDS.school,
      code: "SIM-001",
      name: "Captador virtual",
      location: "Simulação",
      capacityLiters: 12,
      reserveLiters: 0.5,
      device: { deviceKey: "VIRTUAL-001", isSimulated: true, token: TEST_DEVICE_TOKEN, pepper: TEST_PEPPER },
    });
    await ensureCollector(db, {
      schoolId: IDS.school,
      code: "EC-001",
      name: "EcoCaptador",
      location: "Horta",
      capacityLiters: 11.8,
      reserveLiters: 0.5,
      device: { deviceKey: "ESP32-001", isSimulated: false, token: ESP32_TOKEN, pepper: TEST_PEPPER },
    });

    const physical = await snapshot();
    expect(physical.telemetry).toMatchObject({ origin: "device", status: "OFFLINE", volumeSource: "none", distanceMm: null });
    expect(physical.totals).toEqual({ capturedLiters: 0, reusedLiters: 0, discardedEstimatedLiters: 0 });
    expect(physical.simulation).toBeNull();
    expect(physical.calibration).toBeNull();
    const { rows } = await pg.query<{ status: string; is_simulated: boolean }>("select status, is_simulated from collector_calibrations");
    expect(rows).toEqual([{ status: "superseded", is_simulated: true }]); // histórico preservado, nunca apagado
  });

  it("calibração de outro dispositivo (ou da simulação) não converte leituras do físico", async () => {
    await calibrateReal();
    await bench.endBench(teacher, "EC-001");
    await holdReal(tube(4), 2);
    expect((await snapshot()).telemetry.volumeSource).toBe("calibration");

    // Troca do ESP32: a calibração do sensor antigo deixa de valer.
    await db.query("update devices set active = false where device_key = 'ESP32-001'");
    await ensureCollector(db, {
      schoolId: IDS.school,
      code: "EC-001",
      name: "EcoCaptador",
      location: "Horta",
      capacityLiters: 11.8,
      reserveLiters: 0.5,
      device: { deviceKey: "ESP32-002", isSimulated: false, token: `${ESP32_TOKEN}-2`, pepper: TEST_PEPPER },
    });
    const replacement = (await collectors.authenticateDevice(`Bearer ${ESP32_TOKEN}-2`, "ESP32-002", "EC-001"))!;
    clock += 1000;
    await collectors.ingestTelemetry(replacement, { ...real(tube(4)), device_id: "ESP32-002" });
    const current = await snapshot();
    expect(current.telemetry.volumeSource).toBe("none");
    expect(current.calibration).toMatchObject({ version: 1, appliesToDevice: false, isSimulated: false });
    expect((await calibrations.getView(teacher, "EC-001")).ok && (await benchView()).calibration?.appliesToDevice).toBe(false);
  });
});

describe("telemetria do VL53L1X físico", () => {
  it("aceita distância, modelo do sensor e diagnóstico; recusa diagnóstico impossível", () => {
    expect(telemetryPayloadSchema.safeParse(real(1236)).success).toBe(true);
    expect(telemetryPayloadSchema.safeParse(real(1236, { sensor_diagnostics: { ...DIAGNOSTICS, valid_samples: 999 } })).success).toBe(false);
    expect(telemetryPayloadSchema.safeParse({ ...real(1236), sensor_diagnostics: undefined }).success).toBe(true);
  });

  it("grava distância como dado primário, sensor e diagnóstico, sem inventar volume sem calibração", async () => {
    await holdReal(1236, 1);
    const { rows } = await pg.query<{
      distance_mm: string;
      volume_liters: string | null;
      volume_source: string;
      sensor_model: string;
      sensor_diagnostics: SensorDiagnostics;
      is_simulated: boolean;
    }>("select distance_mm, volume_liters, volume_source, sensor_model, sensor_diagnostics, is_simulated from telemetry order by id desc limit 1");
    expect(rows[0]).toMatchObject({ volume_liters: null, volume_source: "none", sensor_model: "VL53L1X", is_simulated: false });
    expect(Number(rows[0]!.distance_mm)).toBe(1236);
    expect(rows[0]!.sensor_diagnostics).toMatchObject({ valid_samples: 8, signal_rate_mcps: 3.41 });

    const view = await benchView();
    expect(view.live.diagnostics).toMatchObject({ valid_samples: 8, roi: "16x16" });
    expect(view.live.volume).toBeNull();
    expect((await snapshot()).telemetry).toMatchObject({ status: "MAINTENANCE", volumeSource: "none" });
  });

  it("sensor sem leitura: distância ausente vira leitura inválida, nunca volume", async () => {
    await calibrateReal();
    await bench.endBench(teacher, "EC-001");
    await holdReal(null, 15);
    const view = await benchView();
    expect(view.live.stability.state).toBe("invalid");
    expect(view.live.volume).toBeNull();
    expect((await snapshot()).telemetry).toMatchObject({ status: "ERROR", volumeSource: "none" });
  });

  it("com calibração ativa grava altura, volume, percentual, origem e versão da calibração", async () => {
    const calibration = await calibrateReal();
    expect(calibration.view.active).toMatchObject({ version: 1, isSimulated: false, sensorModel: "VL53L1X" });
    await bench.endBench(teacher, "EC-001");
    await holdReal(tube(5), 1);

    const { rows } = await pg.query<{
      height_mm: string;
      volume_liters: string;
      fill_ratio: string;
      level_state: string;
      volume_source: string;
      version: number;
      status: string;
      bench_mode: boolean;
    }>(
      `select t.height_mm, t.volume_liters, t.fill_ratio, t.level_state, t.volume_source, k.version, t.status, t.bench_mode
       from telemetry t join collector_calibrations k on k.id = t.calibration_id order by t.id desc limit 1`,
    );
    expect(rows[0]).toMatchObject({ volume_source: "calibration", version: 1, status: "MAINTENANCE", bench_mode: false });
    expect(Number(rows[0]!.volume_liters)).toBeCloseTo(5, 1);
    expect(Number(rows[0]!.height_mm)).toBeCloseTo(5 * MM_PER_LITER, -1);
    expect(Number(rows[0]!.fill_ratio)).toBeCloseTo(5 / calibration.fit.effectiveCapacityLiters!, 2);
  });
});

describe("ensaio de bancada", () => {
  it("grava cada leitura, acelera o envio, pausa o balanço, bloqueia missões e expira sozinho", async () => {
    // SIM-001 (tem missões) para verificar o bloqueio; o comportamento é o mesmo no físico.
    const sim = createBenchService({ db, now: () => clock });
    const ingestSim = (volume: number) => {
      clock += 1000;
      seq++;
      return collectors.ingestTelemetry(virtual, {
        device_id: "VIRTUAL-001",
        collector_code: "SIM-001",
        seq,
        uptime_ms: seq * 1000,
        distance_mm: 700,
        volume_liters: volume,
        valve: "closed",
        status: "READY",
        fw_version: "sim",
      });
    };
    for (let i = 0; i < 3; i++) await ingestSim(8);
    const before = (await snapshot("SIM-001")).totals.capturedLiters;
    const count = async () => Number((await pg.query<{ n: number }>("select count(*)::int as n from telemetry where bench_mode")).rows[0]!.n);

    expect(await sim.recordObservation(teacher, "SIM-001", { condition: "com_agua" })).toMatchObject({ ok: false, status: 409 });
    expect((await sim.startBench(teacher, "SIM-001")).ok).toBe(true);
    for (let i = 0; i < 5; i++) expect((await ingestSim(8 + i)).next_poll_ms).toBe(CALIBRATION_POLL_MS);
    expect(await count()).toBe(5);

    const during = await snapshot("SIM-001");
    expect(during).toMatchObject({ benchMode: true, telemetry: { status: "MAINTENANCE" } });
    expect(during.totals.capturedLiters).toBeCloseTo(before, 6); // 4 L colocados à mão não contam
    const blocked = await collectors.requestDispense(student, "SIM-001", {
      command_id: "8d1e2f3a-4b5c-4d6e-8f7a-9b0c1d2e3f4a",
      execution_id: "9e2f3a4b-5c6d-4e7f-9a8b-0c1d2e3f4a5b",
      mission_id: "hidratar-mudas",
    });
    expect(blocked).toMatchObject({ ok: false, status: 409 });

    clock += BENCH_MODE_TTL_MS + 1000;
    const after = await ingestSim(12);
    expect(after.next_poll_ms).toBe(IDLE_POLL_MS);
    expect((await snapshot("SIM-001")).benchMode).toBe(false);
  });

  it("observa o sensor como ele está: instável ou inválido, com diagnóstico e referência da mangueira", async () => {
    await bench.startBench(teacher, "EC-001");
    // Nível oscilando (reflexão nas paredes): registrado como instável.
    for (let i = 0; i < 15; i++) {
      clock += 1000;
      await collectors.ingestTelemetry(esp32, real(1236 + (i % 2 === 0 ? 0 : 35)));
    }
    const unstable = await bench.recordObservation(teacher, "EC-001", { condition: "com_agua", reference_height_mm: 412, note: "nível na luva" });
    expect(unstable.ok && unstable.value.observation).toMatchObject({
      stabilityState: "stabilizing",
      referenceHeightMm: 412,
      note: "nível na luva",
      isSimulated: false,
      heightMm: null,
    });
    expect(unstable.ok && unstable.value.observation.sensorDiagnostics).toMatchObject({ valid_samples: 8 });

    await holdReal(null, 15);
    const invalid = await bench.recordObservation(teacher, "EC-001", { condition: "sem_agua" });
    expect(invalid.ok && invalid.value.observation).toMatchObject({ stabilityState: "invalid", distanceMm: null });

    const { rows } = await pg.query<{ samples: unknown[] }>("select samples from sensor_observations order by created_at limit 1");
    expect(rows[0]!.samples.length).toBeGreaterThan(10); // janela bruta preservada para análise
  });

  it("validação experimental registra erro absoluto e percentual sem alterar a calibração", async () => {
    const calibration = await calibrateReal();
    const calibrationId = calibration.view.active!.id;
    const before = await pg.query("select * from collector_calibrations where id = $1", [calibrationId]);

    // Ainda dentro do ensaio iniciado pela calibração: 5,00 L colocados; sensor lê um pouco abaixo.
    await holdReal(tube(4.92));
    const result = await bench.recordValidation(teacher, "EC-001", { known_volume_liters: 5, measurement_method: "balanca", known_mass_kg: 5.003 });
    if (!result.ok) throw new Error(result.message);
    const validation = result.value.validation;
    expect(validation).toMatchObject({ calibrationVersion: 1, sensorModel: "VL53L1X", isSimulated: false, knownVolumeLiters: 5, knownMassKg: 5.003 });
    expect(validation.calculatedVolumeLiters).toBeCloseTo(4.92, 1);
    expect(validation.errorLiters).toBeCloseTo(validation.calculatedVolumeLiters - 5, 3);
    expect(validation.absoluteErrorLiters).toBeCloseTo(Math.abs(validation.calculatedVolumeLiters - 5), 3);
    expect(validation.percentError).toBeCloseTo(((validation.calculatedVolumeLiters - 5) / 5) * 100, 1);
    expect(validation.absolutePercentError).toBeCloseTo(Math.abs(validation.percentError!), 3);

    await holdReal(tube(0.01));
    const zero = await bench.recordValidation(teacher, "EC-001", { known_volume_liters: 0, measurement_method: "outro" });
    expect(zero.ok && zero.value.validation).toMatchObject({ percentError: null, absolutePercentError: null });

    const after = await pg.query("select * from collector_calibrations where id = $1", [calibrationId]);
    expect(after.rows).toEqual(before.rows); // a calibração não muda
    const view = await benchView();
    expect(view.validationSummary.count).toBe(2);
    expect(view.validationSummary.meanAbsolutePercentError).toBeCloseTo(validation.absolutePercentError!, 3);
  });

  it("validação exige ensaio ativo, calibração deste dispositivo e leitura estável", async () => {
    await bench.startBench(teacher, "EC-001");
    await holdReal(tube(5));
    expect(await bench.recordValidation(teacher, "EC-001", { known_volume_liters: 5, measurement_method: "balanca" })).toMatchObject({ ok: false, status: 409 });

    await calibrateReal();
    for (let i = 0; i < 20; i++) {
      clock += 1000;
      await collectors.ingestTelemetry(esp32, real(tube(5) - i * 6)); // água ainda entrando
    }
    expect(await bench.recordValidation(teacher, "EC-001", { known_volume_liters: 5, measurement_method: "balanca" })).toMatchObject({ ok: false, status: 409 });

    await bench.endBench(teacher, "EC-001");
    await holdReal(tube(5));
    expect(await bench.recordValidation(teacher, "EC-001", { known_volume_liters: 5, measurement_method: "balanca" })).toMatchObject({ ok: false, status: 409 });
  });

  it("é exclusiva de professores e administradores da escola e exporta CSV para análise", async () => {
    expect(await bench.getView(student, "EC-001")).toMatchObject({ ok: false, status: 403 });
    expect(await bench.startBench(otherSchoolTeacher, "EC-001")).toMatchObject({ ok: false, status: 404 });
    expect(await bench.exportCsv(student, "EC-001", "readings")).toMatchObject({ ok: false, status: 403 });

    await calibrateReal();
    await holdReal(tube(5));
    await bench.recordValidation(teacher, "EC-001", { known_volume_liters: 5, measurement_method: "recipiente_graduado" });

    const readings = await bench.exportCsv(teacher, "EC-001", "readings");
    const lines = readings.ok ? readings.value.split("\n") : [];
    expect(lines[0]).toContain("distance_mm;height_mm;volume_liters");
    expect(lines.at(-1)).toMatch(/;false;true;MAINTENANCE;1\d{3},\d;/); // REAL, em ensaio, vírgula decimal

    const validations = await bench.exportCsv(teacher, "EC-001", "validations");
    expect(validations.ok && validations.value).toMatch(/volume_conhecido_l.*erro_percentual_absoluto/);
  });
});
