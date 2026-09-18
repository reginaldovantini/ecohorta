import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CALIBRATION_STEP_IDS, type CalibrationStepId } from "@/lib/collector/volume-calibration";
import { hardwareChangeRequestSchema, type SensorDiagnostics, type TelemetryPayload } from "@/lib/iot/api-schema";
import type { Actor } from "./actor";
import { createBenchService, type BenchService } from "./bench-service";
import { createCalibrationService, type CalibrationService } from "./calibration-service";
import { createCollectorService, type AuthenticatedDevice, type CollectorService } from "./collector-service";
import { createTestDatabase, IDS, resetTestDatabase, TEST_DEVICE_TOKEN, TEST_PEPPER } from "./db/test-db";
import type { Database } from "./db/types";
import { createHardwareService, type HardwareService } from "./hardware-service";
import { ensureCollector } from "./provisioning";

/*
 * Configuração de hardware (sensor de distância VL53L0X ou VL53L1X) sobre PostgreSQL real (PGlite):
 * seleção persistente, configuração enviada ao firmware, confirmação da troca, divergência entre
 * o configurado e o reportado, sensor ausente, timeout, leituras e proteção da calibração.
 */

const teacher: Actor = { profileId: IDS.teacher, schoolId: IDS.school, role: "teacher" };
const student: Actor = { profileId: IDS.student, schoolId: IDS.school, role: "student" };
const staff: Actor = { profileId: IDS.staff, schoolId: IDS.school, role: "staff" };
const otherSchoolTeacher: Actor = { profileId: IDS.otherStudent, schoolId: IDS.otherSchool, role: "teacher" };

const ESP32_TOKEN = "token-do-esp32-de-teste-suficientemente-longo";
const MM_PER_LITER = 1_000_000 / ((Math.PI / 4) * 96.8 ** 2);
const tube = (liters: number) => 1700 - liters * MM_PER_LITER;
const POINTS: Record<CalibrationStepId, number> = { zero: tube(0), one: tube(1), two: tube(2), three: tube(3), max: 200 };
const NOISE = [0, 1, -1, 2, -2, 1, 0, -1, 1, 0];

const READY: Record<"VL53L0X" | "VL53L1X", SensorDiagnostics> = {
  VL53L0X: { sensor_state: "ready", model_id: "0xEE", i2c_ack: true, i2c_clock_hz: 100_000, samples: 9, valid_samples: 9, distance_mode: "long_range" },
  VL53L1X: { sensor_state: "ready", model_id: "0xEACC", i2c_ack: true, i2c_clock_hz: 100_000, samples: 9, valid_samples: 9, distance_mode: "long", roi: "16x16" },
};

let db: Database;
let clock: number;
let seq: number;
let collectors: CollectorService;
let calibrations: CalibrationService;
let bench: BenchService;
let hardware: HardwareService;
let esp32: AuthenticatedDevice;
let virtual: AuthenticatedDevice;

/** Telemetria do ESP32 com o driver `sensor` (o firmware informa o driver em uso e a revisão aplicada). */
function real(distance: number | null, sensor: "VL53L0X" | "VL53L1X" = "VL53L1X", patch: Partial<TelemetryPayload> = {}): TelemetryPayload {
  seq++;
  return {
    device_id: "ESP32-001",
    collector_code: "EC-001",
    seq,
    uptime_ms: seq * 1000,
    distance_mm: distance,
    sensor_model: sensor,
    hardware_revision: 1,
    sensor_diagnostics: READY[sensor],
    valve: "unknown",
    status: distance === null ? "ERROR" : "MAINTENANCE",
    fw_version: "esp32-0.4.0",
    command_report: null,
    ...patch,
  };
}

async function hold(distance: number, sensor: "VL53L0X" | "VL53L1X" = "VL53L1X", readings = 20, patch: Partial<TelemetryPayload> = {}) {
  let response;
  for (let i = 0; i < readings; i++) {
    clock += 1000;
    response = await collectors.ingestTelemetry(esp32, real(distance + NOISE[i % NOISE.length]!, sensor, patch));
  }
  return response!;
}

async function calibrate(sensor: "VL53L0X" | "VL53L1X", patch: Partial<TelemetryPayload> = {}) {
  expect(await calibrations.startSession(teacher, "EC-001")).toMatchObject({ ok: true });
  for (const step of CALIBRATION_STEP_IDS) {
    await hold(POINTS[step], sensor, 20, patch);
    expect(await calibrations.registerPoint(teacher, "EC-001", step)).toMatchObject({ ok: true });
  }
  const completed = await calibrations.completeSession(teacher, "EC-001");
  if (!completed.ok) throw new Error(completed.message);
  return completed.value;
}

/** O firmware recebe a configuração na resposta e passa a ler com o novo driver (como o ESP32 faz). */
async function firmwareApplies(sensor: "VL53L0X" | "VL53L1X", revision: number) {
  clock += 1000;
  return collectors.ingestTelemetry(esp32, real(tube(0), sensor, { hardware_revision: revision }));
}

const change = (distanceSensor: "VL53L0X" | "VL53L1X", actor: Actor = teacher, confirmPhysicalMatch = true, note: string | null = null) =>
  hardware.changeSensor(actor, "EC-001", { distanceSensor, confirmPhysicalMatch, note });

const view = async (code = "EC-001") => {
  const result = await hardware.getView(teacher, code);
  if (!result.ok) throw new Error(result.message);
  return result.value;
};
const snapshot = async () => (await collectors.getSnapshot(student, "EC-001"))!;
const collectorRow = async () =>
  (
    await db.query<{ distance_sensor: string; hardware_revision: number; hardware_updated_by: string | null }>(
      "select distance_sensor, hardware_revision, hardware_updated_by from collectors where code = 'EC-001'",
    )
  ).rows[0]!;
const lastTelemetry = async () =>
  (await db.query<{ volume_source: string; volume_liters: string | null; sensor_model: string }>(
    "select volume_source, volume_liters, sensor_model from telemetry order by id desc limit 1",
  )).rows[0]!;

beforeAll(async () => {
  ({ db } = await createTestDatabase());
}, 60_000);

beforeEach(async () => {
  await resetTestDatabase(db);
  clock = 1_000_000;
  seq = 0;
  collectors = createCollectorService({ db, pepper: TEST_PEPPER, now: () => clock });
  calibrations = createCalibrationService({ db, now: () => clock });
  bench = createBenchService({ db, now: () => clock });
  hardware = createHardwareService({ db, now: () => clock });
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

describe("seleção do sensor (persistida na plataforma)", () => {
  it("captadores existentes ficam com o VL53L1X, revisão 1, sem histórico", async () => {
    expect(await collectorRow()).toMatchObject({ distance_sensor: "VL53L1X", hardware_revision: 1 });
    const current = await view();
    expect(current.configuration).toMatchObject({ distanceSensor: "VL53L1X", revision: 1, updatedAt: null });
    expect(current.history).toEqual([]);
    expect(current.collector).toMatchObject({ code: "EC-001", isSimulated: false, deviceKey: "ESP32-001" });
  });

  it("configuração VL53L0X: persistida com nova revisão, autor, nota e confirmação no histórico", async () => {
    const result = await change("VL53L0X", teacher, true, "módulo GY-530 instalado");
    expect(result.ok).toBe(true);
    expect(await collectorRow()).toEqual({ distance_sensor: "VL53L0X", hardware_revision: 2, hardware_updated_by: IDS.teacher });

    // Outra instância do serviço (outra função serverless) lê a mesma configuração do banco.
    const fresh = await createHardwareService({ db, now: () => clock }).getView(teacher, "EC-001");
    expect(fresh.ok && fresh.value.configuration).toMatchObject({ distanceSensor: "VL53L0X", revision: 2, updatedBy: "Prof. Rê" });
    expect(fresh.ok && fresh.value.history).toEqual([
      expect.objectContaining({ revision: 2, previousSensor: "VL53L1X", newSensor: "VL53L0X", changedBy: "Prof. Rê", note: "módulo GY-530 instalado", isSimulated: false }),
    ]);
    const { rows } = await db.query<{ physical_match_confirmed: boolean }>("select physical_match_confirmed from collector_hardware_changes");
    expect(rows).toEqual([{ physical_match_confirmed: true }]);
  });

  it("configuração VL53L1X: voltar ao VL53L1X cria a revisão 3", async () => {
    await change("VL53L0X");
    expect(await change("VL53L1X")).toMatchObject({ ok: true });
    expect(await collectorRow()).toMatchObject({ distance_sensor: "VL53L1X", hardware_revision: 3 });
    expect((await view()).history.map((item) => [item.revision, item.newSensor])).toEqual([
      [3, "VL53L1X"],
      [2, "VL53L0X"],
    ]);
  });

  it("nunca é silenciosa: exige educador, a confirmação do sensor físico e uma troca de fato", async () => {
    expect(await change("VL53L0X", student)).toMatchObject({ ok: false, status: 403 });
    expect(await change("VL53L0X", staff)).toMatchObject({ ok: false, status: 403 });
    expect(await change("VL53L0X", otherSchoolTeacher)).toMatchObject({ ok: false, status: 404 });
    expect(await change("VL53L0X", teacher, false)).toMatchObject({ ok: false, status: 422 });
    expect(await change("VL53L1X")).toMatchObject({ ok: false, status: 409 });
    expect(await collectorRow()).toMatchObject({ distance_sensor: "VL53L1X", hardware_revision: 1 });
    expect((await view()).history).toEqual([]);

    // Contrato HTTP: a confirmação tem de ser explicitamente `true`.
    expect(hardwareChangeRequestSchema.safeParse({ distance_sensor: "VL53L0X", confirm_physical_match: true }).success).toBe(true);
    expect(hardwareChangeRequestSchema.safeParse({ distance_sensor: "VL53L0X", confirm_physical_match: false }).success).toBe(false);
    expect(hardwareChangeRequestSchema.safeParse({ distance_sensor: "VL53L0X" }).success).toBe(false);
    expect(hardwareChangeRequestSchema.safeParse({ distance_sensor: "HC-SR04", confirm_physical_match: true }).success).toBe(false);
  });

  it("estudantes e funcionários não abrem a configuração de hardware", async () => {
    expect(await hardware.getView(student, "EC-001")).toMatchObject({ ok: false, status: 403 });
    expect(await hardware.getView(staff, "EC-001")).toMatchObject({ ok: false, status: 403 });
    expect(await hardware.getView(otherSchoolTeacher, "EC-001")).toMatchObject({ ok: false, status: 404 });
  });
});

describe("driver correto no firmware", () => {
  it("a resposta de cada telemetria leva o sensor configurado e a revisão", async () => {
    const before = await collectors.ingestTelemetry(esp32, real(1236));
    expect(before.hardware).toEqual({ distance_sensor: "VL53L1X", revision: 1 });

    await change("VL53L0X");
    clock += 1000;
    const after = await collectors.ingestTelemetry(esp32, real(1236));
    expect(after.hardware).toEqual({ distance_sensor: "VL53L0X", revision: 2 });
    // A troca não cria comando nenhum para o dispositivo (nada de válvula).
    expect(after.command).toBeNull();
    const { rows } = await db.query("select 1 from device_commands");
    expect(rows).toEqual([]);
  });

  it("firmware ainda sem configuração: recebe o sensor e aparece como aguardando", async () => {
    const response = await collectors.ingestTelemetry(
      esp32,
      real(null, "VL53L1X", { sensor_model: undefined, hardware_revision: null, sensor_diagnostics: { sensor_state: "not_configured", samples: 0 } }),
    );
    expect(response.hardware.distance_sensor).toBe("VL53L1X");
    expect((await snapshot()).hardware).toMatchObject({ compatibility: "awaiting_config", reportedSensor: null });
  });

  it("mostra o sensor e a revisão que o firmware informa ter aplicado", async () => {
    await change("VL53L0X");
    clock += 1000;
    await collectors.ingestTelemetry(esp32, real(1236, "VL53L0X", { hardware_revision: 2 }));
    const current = await view();
    expect(current.device).toMatchObject({ online: true, reportedSensor: "VL53L0X", reportedRevision: 2, sensorState: "ready", modelId: "0xEE", i2cAck: true, i2cClockHz: 100_000 });
    expect(current.compatibility.state).toBe("compatible");
  });
});

describe("leituras e estado do sensor", () => {
  it("leitura válida: distância registrada, sensor compatível", async () => {
    await collectors.ingestTelemetry(esp32, real(1236));
    const current = await snapshot();
    expect(current.telemetry.distanceMm).toBe(1236);
    expect(current.hardware).toMatchObject({ distanceSensor: "VL53L1X", reportedSensor: "VL53L1X", compatibility: "compatible" });
  });

  it("leitura inválida: sem distância e sem volume", async () => {
    await collectors.ingestTelemetry(esp32, real(null, "VL53L1X", { sensor_diagnostics: { ...READY.VL53L1X, valid_samples: 2 } }));
    const current = await snapshot();
    expect(current.telemetry.distanceMm).toBeNull();
    expect(current.telemetry.volumeSource).toBe("none");
    expect(await lastTelemetry()).toMatchObject({ volume_source: "none", volume_liters: null });
  });

  it("sensor ausente: nenhum dispositivo respondeu no I²C", async () => {
    await collectors.ingestTelemetry(esp32, real(null, "VL53L1X", { sensor_diagnostics: { sensor_state: "not_found", i2c_ack: false, model_id: null } }));
    const current = await snapshot();
    expect(current.hardware).toMatchObject({ compatibility: "sensor_missing", sensorState: "not_found" });
    expect(current.hardware!.message).toContain("GPIO21");
  });

  it("timeout: o sensor parou de responder", async () => {
    await collectors.ingestTelemetry(esp32, real(null, "VL53L1X", { sensor_diagnostics: { sensor_state: "timeout", i2c_ack: true, samples: 9, valid_samples: 0 } }));
    expect((await snapshot()).hardware).toMatchObject({ compatibility: "sensor_fault", sensorState: "timeout" });
  });

  it("a janela de estabilização recomeça quando o driver do firmware muda", async () => {
    await hold(1236, "VL53L1X", 10);
    await change("VL53L0X");
    await hold(1236, "VL53L1X", 5); // firmware ainda no driver anterior
    clock += 1000;
    await collectors.ingestTelemetry(esp32, real(1236, "VL53L0X"));
    const { rows } = await db.query<{ samples: number }>(
      "select jsonb_array_length(distance_samples) as samples from collector_state s join collectors c on c.id = s.collector_id where c.code = 'EC-001'",
    );
    expect(rows[0]!.samples).toBe(1);
  });
});

describe("divergência entre o sensor configurado e o reportado", () => {
  it("⚠️ INCOMPATIBILIDADE DE HARDWARE: sem volume, em erro, sem calibração nem validação", async () => {
    await calibrate("VL53L1X");
    await bench.endBench(teacher, "EC-001");
    await hold(tube(3));
    expect((await snapshot()).telemetry.volumeSource).toBe("calibration");

    // Leituras que dizem vir do VL53L0X num captador configurado com o VL53L1X (firmware errado).
    await hold(tube(3), "VL53L0X", 3);
    expect(await lastTelemetry()).toMatchObject({ volume_source: "none", volume_liters: null, sensor_model: "VL53L0X" });
    const current = await snapshot();
    expect(current.hardware).toMatchObject({ distanceSensor: "VL53L1X", reportedSensor: "VL53L0X", compatibility: "incompatible" });
    expect(current.telemetry.status).toBe("ERROR");
    expect(current.telemetry.volumeSource).toBe("none");

    const start = await calibrations.startSession(teacher, "EC-001");
    expect(start).toMatchObject({ ok: false, status: 409 });
    expect(!start.ok && start.message).toContain("INCOMPATIBILIDADE DE HARDWARE");
    await bench.startBench(teacher, "EC-001");
    const validation = await bench.recordValidation(teacher, "EC-001", { known_volume_liters: 3, measurement_method: "balanca" });
    expect(validation).toMatchObject({ ok: false, status: 409 });

    const benchView = await bench.getView(teacher, "EC-001");
    expect(benchView.ok && benchView.value.hardware.compatibility).toBe("incompatible");
    expect(benchView.ok && benchView.value.live.volume).toBeNull();
  });

  it("o sensor ligado não se identifica como o configurado", async () => {
    await change("VL53L0X");
    clock += 1000;
    await collectors.ingestTelemetry(
      esp32,
      real(null, "VL53L0X", { hardware_revision: 2, sensor_diagnostics: { sensor_state: "not_found", i2c_ack: true, model_id: "0x10" } }),
    );
    const current = await view();
    expect(current.compatibility.state).toBe("incompatible");
    expect(current.compatibility.message).toContain("não se identificou como VL53L0X");
  });

  it("uma etapa de calibração é recusada se o firmware trocar de driver no meio", async () => {
    expect(await calibrations.startSession(teacher, "EC-001")).toMatchObject({ ok: true });
    await hold(POINTS.zero, "VL53L0X");
    const point = await calibrations.registerPoint(teacher, "EC-001", "zero");
    expect(point).toMatchObject({ ok: false, status: 409 });
    expect(!point.ok && point.message).toContain("INCOMPATIBILIDADE DE HARDWARE");
  });
});

describe("troca do sensor e proteção da calibração", () => {
  it("VL53L1X → VL53L0X: a calibração anterior é substituída, o volume fica desconhecido e as missões param", async () => {
    const first = await calibrate("VL53L1X");
    expect(first.status).toBe("active");
    await bench.endBench(teacher, "EC-001");
    await hold(tube(4));
    expect((await snapshot()).calibration).toMatchObject({ version: 1, sensorModel: "VL53L1X", hardwareRevision: 1, appliesToDevice: true });

    const result = await change("VL53L0X");
    expect(result.ok && result.value.change).toMatchObject({ supersededCalibrationVersion: 1, cancelledCalibration: false });
    const { rows } = await db.query<{ status: string; sensor_model: string; hardware_revision: number }>(
      "select status, sensor_model, hardware_revision from collector_calibrations where version = 1",
    );
    expect(rows).toEqual([{ status: "superseded", sensor_model: "VL53L1X", hardware_revision: 1 }]);

    const current = await snapshot();
    expect(current.calibration).toBeNull();
    expect(current.telemetry.volumeSource).toBe("none");
    expect(current.benchMode).toBe(true);
    expect(current.telemetry.status).toBe("MAINTENANCE");
    // Mesmo com leituras do driver certo, sem calibração do novo sensor não há volume.
    await hold(tube(4), "VL53L0X", 3, { hardware_revision: 2 });
    expect(await lastTelemetry()).toMatchObject({ volume_source: "none" });
  });

  it("a nova calibração fica vinculada ao novo sensor e à revisão atual", async () => {
    await calibrate("VL53L1X");
    await change("VL53L0X");
    // Até o firmware aplicar a configuração, as leituras são do driver anterior: calibrar é recusado.
    expect(await calibrations.startSession(teacher, "EC-001")).toMatchObject({ ok: false, status: 409 });
    await firmwareApplies("VL53L0X", 2);
    const second = await calibrate("VL53L0X", { hardware_revision: 2 });
    expect(second).toMatchObject({ status: "active", version: 2 });
    const { rows } = await db.query<{ version: number; status: string; sensor_model: string; hardware_revision: number }>(
      "select version, status, sensor_model, hardware_revision from collector_calibrations where version is not null order by version",
    );
    expect(rows).toEqual([
      { version: 1, status: "superseded", sensor_model: "VL53L1X", hardware_revision: 1 },
      { version: 2, status: "active", sensor_model: "VL53L0X", hardware_revision: 2 },
    ]);
    await hold(tube(2), "VL53L0X", 3, { hardware_revision: 2 });
    expect(await lastTelemetry()).toMatchObject({ volume_source: "calibration" });
    expect((await snapshot()).calibration).toMatchObject({ version: 2, sensorModel: "VL53L0X", hardwareRevision: 2, appliesToDevice: true, mismatch: null });
  });

  it("voltar ao sensor anterior não reaproveita a calibração antiga", async () => {
    await calibrate("VL53L1X");
    await change("VL53L0X");
    await firmwareApplies("VL53L0X", 2);
    await calibrate("VL53L0X", { hardware_revision: 2 });
    await change("VL53L1X");

    const { rows } = await db.query<{ version: number; status: string }>(
      "select version, status from collector_calibrations where version is not null order by version",
    );
    expect(rows).toEqual([
      { version: 1, status: "superseded" },
      { version: 2, status: "superseded" },
    ]);
    await hold(tube(2), "VL53L1X", 3, { hardware_revision: 3 });
    expect(await lastTelemetry()).toMatchObject({ volume_source: "none" });
    expect((await snapshot()).calibration).toBeNull();
    expect((await view()).history.map((item) => item.supersededCalibrationVersion)).toEqual([2, 1]);
  });

  it("uma calibração em andamento é cancelada pela troca", async () => {
    expect(await calibrations.startSession(teacher, "EC-001")).toMatchObject({ ok: true });
    await hold(POINTS.zero);
    expect(await calibrations.registerPoint(teacher, "EC-001", "zero")).toMatchObject({ ok: true });

    const result = await change("VL53L0X");
    expect(result.ok && result.value.change.cancelledCalibration).toBe(true);
    expect(await calibrations.registerPoint(teacher, "EC-001", "one")).toMatchObject({ ok: false, status: 409 });
    const { rows } = await db.query<{ status: string }>("select status from collector_calibrations");
    expect(rows).toEqual([{ status: "cancelled" }]);
  });

  it("a troca não altera o balanço hídrico já medido", async () => {
    await calibrate("VL53L1X");
    await bench.endBench(teacher, "EC-001");
    await hold(tube(5));
    const before = (await snapshot()).totals;
    await change("VL53L0X");
    await firmwareApplies("VL53L0X", 2);
    await calibrate("VL53L0X", { hardware_revision: 2 });
    await hold(tube(5), "VL53L0X", 5, { hardware_revision: 2 });
    const after = (await snapshot()).totals;
    expect(after.capturedLiters).toBeCloseTo(before.capturedLiters, 1);
    expect(after.reusedLiters).toBe(before.reusedLiters);
  });

  it("a troca espera a liberação em andamento terminar (SIMULAÇÃO)", async () => {
    clock += 1000;
    await collectors.ingestTelemetry(virtual, {
      device_id: "VIRTUAL-001",
      collector_code: "SIM-001",
      seq: ++seq,
      uptime_ms: seq * 1000,
      distance_mm: 824,
      volume_liters: 6.6,
      sensor_model: "VL53L1X",
      valve: "closed",
      status: "READY",
      fw_version: "virtual-0.3.0",
    });
    const dispense = await collectors.requestDispense(student, "SIM-001", {
      command_id: "6b3c2d4e-7f8a-4b9c-8d0e-1f2a3b4c5d6e",
      execution_id: "7c4d3e5f-8a9b-4c0d-9e1f-2a3b4c5d6e7f",
      mission_id: "hidratar-mudas",
    });
    expect(dispense.ok && dispense.value.status).toBe("QUEUED");
    expect(await hardware.changeSensor(teacher, "SIM-001", { distanceSensor: "VL53L0X", confirmPhysicalMatch: true })).toMatchObject({
      ok: false,
      status: 409,
    });
    expect((await view("SIM-001")).dispenseActive).toBe(true);
  });
});
