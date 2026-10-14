import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { telemetryPayloadSchema, type TelemetryPayload } from "@/lib/iot/api-schema";
import { CALIBRATION_STEP_IDS } from "@/lib/collector/volume-calibration";
import { createCalibrationService } from "./calibration-service";
import { BENCH_MODE_TTL_MS } from "./collector-service";
import { createCollectorService, type AuthenticatedDevice, type CollectorService } from "./collector-service";
import {
  ACTORS,
  createTestDatabase,
  IDS,
  makeCollectorReal,
  resetTestDatabase,
  scanForRelease,
  seedPhysicalScenario,
  TEST_PEPPER,
} from "./db/test-db";
import type { Database } from "./db/types";

/*
 * O CONTRATO DA PLACA, PALAVRA POR PALAVRA.
 *
 * Os outros testes exercitam o serviço com um payload conveniente. Este exercita
 * o payload que o FIRMWARE realmente monta (firmware/src/main.cpp): os mesmos
 * campos, os mesmos nomes, os mesmos estados.
 *
 * Ele existe porque o jeito mais caro de descobrir uma divergência de contrato é
 * com a placa gravada, no pátio, com um estudante esperando a água sair.
 */

let pg: PGlite;
let db: Database;
let service: CollectorService;
let esp32: AuthenticatedDevice;
let clock = 0;
let seq = 0;

const ESP32_TOKEN = "token-do-esp32-de-teste-suficientemente-longo";
const MM_PER_LITER = 1_000_000 / ((Math.PI / 4) * 96.8 ** 2);
const tubo = (litros: number) => 1700 - litros * MM_PER_LITER;

/** O que o firmware envia. Os nomes e os tipos vêm de `sendTelemetry()`. */
function daPlaca(patch: Partial<TelemetryPayload> = {}): TelemetryPayload {
  seq++;
  return {
    device_id: "ESP32-001",
    collector_code: "ECO-001",
    seq,
    uptime_ms: seq * 1000,
    distance_mm: tubo(8),
    sensor_model: "VL53L1X",
    hardware_revision: 1,
    sensor_diagnostics: {
      sensor_state: "ready",
      model_id: "0xEACC",
      i2c_ack: true,
      i2c_clock_hz: 100_000,
      samples: 9,
      valid_samples: 9,
      distance_mode: "long",
      roi: "16x16",
      rssi_dbm: -62,
    },
    valve: "closed",
    status: "READY",
    fw_version: "esp32-0.5.0",
    command_report: null,
    ...patch,
  };
}

/** O relatório que o firmware monta a partir do `DispenseReport` do núcleo. */
const relatorio = (commandId: string, patch: Record<string, unknown> = {}) => ({
  command_id: commandId,
  status: "EXECUTING" as const,
  delivered_liters: 0.4,
  start_volume_liters: 8,
  end_volume_liters: 7.6,
  start_distance_mm: tubo(8),
  end_distance_mm: tubo(7.6),
  failure: null,
  started_uptime_ms: 5000,
  finished_uptime_ms: null,
  ...patch,
});

async function calibrar() {
  const calibrations = createCalibrationService({ db, now: () => clock });
  expect(await calibrations.startSession(ACTORS.teacher, "ECO-001")).toMatchObject({ ok: true });
  const pontos = { zero: tubo(0), one: tubo(1), two: tubo(2), three: tubo(3), max: 200 } as const;
  for (const passo of CALIBRATION_STEP_IDS) {
    for (let i = 0; i < 20; i++) {
      clock += 400;
      await service.ingestTelemetry(esp32, daPlaca({ distance_mm: pontos[passo] + (i % 3) - 1, status: "MAINTENANCE" }));
    }
    expect(await calibrations.registerPoint(ACTORS.teacher, "ECO-001", passo)).toMatchObject({ ok: true });
  }
  const pronta = await calibrations.completeSession(ACTORS.teacher, "ECO-001");
  if (!pronta.ok) throw new Error(pronta.message);
  // Calibrar liga o modo de bancada, que bloqueia missões. No pátio ele expira
  // sozinho; aqui o relógio anda para depois dele.
  clock += BENCH_MODE_TTL_MS + 1000;
}

beforeAll(async () => {
  ({ pg, db } = await createTestDatabase());
}, 60_000);

beforeEach(async () => {
  await resetTestDatabase(db);
  await seedPhysicalScenario(db, ESP32_TOKEN);
  await makeCollectorReal(db);
  clock = 1_700_000_000_000;
  seq = 0;
  service = createCollectorService({ db, pepper: TEST_PEPPER, now: () => clock });
  const device = await service.authenticateDevice(`Bearer ${ESP32_TOKEN}`, "ESP32-001", "ECO-001");
  if (!device) throw new Error("dispositivo de teste não autenticou");
  esp32 = device;
});

afterAll(async () => {
  await pg.close();
});

describe("o que a placa envia é aceito como está", () => {
  it("a telemetria do firmware passa pelo esquema sem ajuste", () => {
    expect(telemetryPayloadSchema.safeParse(daPlaca()).success).toBe(true);
  });

  it("os três estados novos da placa são válidos", () => {
    for (const status of ["READY", "DISPENSING", "MAINTENANCE", "ERROR"] as const) {
      expect(telemetryPayloadSchema.safeParse(daPlaca({ status })).success).toBe(true);
    }
    for (const valve of ["open", "closed"] as const) {
      expect(telemetryPayloadSchema.safeParse(daPlaca({ valve })).success).toBe(true);
    }
  });

  it("o relatório com as distâncias do sensor é aceito", () => {
    const payload = daPlaca({
      valve: "open",
      status: "DISPENSING",
      command_report: relatorio("9f1d0e8a-1111-4a2b-8c3d-4e5f60718293"),
    });
    expect(telemetryPayloadSchema.safeParse(payload).success).toBe(true);
  });
});

describe("a calibração chega à placa", () => {
  it("sem calibração, nada — e com ela, os quatro números da conta", async () => {
    const antes = await service.ingestTelemetry(esp32, daPlaca({ status: "MAINTENANCE" }));
    expect(antes.hardware.calibration).toBeNull();

    await calibrar();
    clock += 1000;
    const depois = await service.ingestTelemetry(esp32, daPlaca());
    const c = depois.hardware.calibration;
    expect(c).not.toBeNull();

    // A conta que a placa faz: litros = k × (zero − distância), limitada à capacidade.
    const litros = c!.constant_liters_per_mm * (c!.zero_distance_mm - tubo(3));
    expect(litros).toBeCloseTo(3, 1);
  });
});

describe("uma missão inteira, do comando ao relatório", () => {
  const COMANDO = "9f1d0e8a-1111-4a2b-8c3d-4e5f60718293";
  const EXECUCAO = "9f1d0e8a-2222-4a2b-8c3d-4e5f60718293";

  async function pedirLiberacao() {
    const pedido = await service.requestDispense(ACTORS.student, "ECO-001", {
      command_id: COMANDO,
      execution_id: EXECUCAO,
      mission_id: "regar-jardim",
      scan_id: await scanForRelease(db, IDS.student),
    });
    if (!pedido.ok) throw new Error(pedido.message);
    return pedido.value;
  }

  it("o comando chega à placa com alvo e teto de tempo", async () => {
    await calibrar();
    clock += 1000;
    await service.ingestTelemetry(esp32, daPlaca());
    await pedirLiberacao();

    clock += 1000;
    const resposta = await service.ingestTelemetry(esp32, daPlaca());
    expect(resposta.command).toMatchObject({ command_id: COMANDO, action: "dispense" });
    expect(resposta.command!.action === "dispense" && resposta.command!.target_liters).toBeGreaterThan(0);
    expect(resposta.command!.action === "dispense" && resposta.command!.max_duration_ms).toBeGreaterThan(0);
  });

  it("o relatório terminal conclui a execução, e o comando para de ser enviado", async () => {
    await calibrar();
    clock += 1000;
    await service.ingestTelemetry(esp32, daPlaca());
    await pedirLiberacao();

    // A placa abriu: relatório em andamento, válvula aberta.
    clock += 1000;
    await service.ingestTelemetry(
      esp32,
      daPlaca({ valve: "open", status: "DISPENSING", distance_mm: tubo(7.6), command_report: relatorio(COMANDO) }),
    );

    // A placa fechou, mediu e mandou o terminal.
    clock += 5000;
    const fim = await service.ingestTelemetry(
      esp32,
      daPlaca({
        distance_mm: tubo(6),
        command_report: relatorio(COMANDO, {
          status: "COMPLETED",
          delivered_liters: 2,
          end_volume_liters: 6,
          end_distance_mm: tubo(6),
          finished_uptime_ms: 20_000,
        }),
      }),
    );

    // Comando terminado não volta: é assim que a placa sabe que pode esquecê-lo.
    expect(fim.command).toBeNull();

    const { rows } = await db.query<{ status: string; delivered_liters: string }>(
      "select status, delivered_liters from public.mission_executions where command_id = $1",
      [COMANDO],
    );
    expect(rows[0]!.status).toBe("COMPLETED");
    expect(Number(rows[0]!.delivered_liters)).toBeCloseTo(2, 2);
  });

  it("a falha da placa chega inteira, com o motivo", async () => {
    await calibrar();
    clock += 1000;
    await service.ingestTelemetry(esp32, daPlaca());
    await pedirLiberacao();

    clock += 9000;
    await service.ingestTelemetry(
      esp32,
      daPlaca({
        command_report: relatorio(COMANDO, {
          status: "FAILED",
          failure: "NO_FLOW",
          delivered_liters: 0,
          end_volume_liters: 8,
          end_distance_mm: tubo(8),
          finished_uptime_ms: 13_000,
        }),
      }),
    );

    const { rows } = await db.query<{ status: string; failure: string | null }>(
      "select status, failure from public.device_commands where id = $1",
      [COMANDO],
    );
    expect(rows[0]).toMatchObject({ status: "FAILED", failure: "NO_FLOW" });
  });
});

describe("o captador fica no ar para as missões", () => {
  it("sem calibração a placa diz MAINTENANCE, e não há modelo de volume ativo", async () => {
    const resposta = await service.ingestTelemetry(esp32, daPlaca({ status: "MAINTENANCE" }));
    expect(resposta.hardware.calibration).toBeNull();
    const snapshot = await service.getSnapshot(ACTORS.student, "ECO-001");
    expect(snapshot!.calibration).toBeNull();
  });

  it("com calibração a placa diz READY, e o volume sai da distância medida", async () => {
    await calibrar();
    clock += 1000;
    await service.ingestTelemetry(esp32, daPlaca({ distance_mm: tubo(5) }));
    const snapshot = await service.getSnapshot(ACTORS.student, "ECO-001");
    expect(snapshot!.telemetry.volumeLiters).toBeCloseTo(5, 1);
  });
});
