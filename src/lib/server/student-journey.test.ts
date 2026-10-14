import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { getLevelProgress } from "@/lib/gamification/levels";
import { MISSION_CATALOG } from "@/lib/missions/catalog";
import type { TelemetryPayload } from "@/lib/iot/api-schema";
import { createCollectorService, type AuthenticatedDevice, type CollectorService } from "./collector-service";
import { getMe } from "./profile-service";
import {
  ACTORS,
  createTestDatabase,
  IDS,
  makeCollectorReal,
  resetTestDatabase,
  scanForRelease,
  TEST_DEVICE_TOKEN,
  TEST_PEPPER,
} from "./db/test-db";
import type { Database } from "./db/types";

/*
 * O CICLO INTEIRO DE UM ESTUDANTE, DO QR AO IMPACTO.
 *
 * Os outros testes cuidam de uma peça cada. Este percorre o caminho do jeito
 * que ele acontece no pátio, na ordem em que acontece:
 *
 *   ler o adesivo → pedir a missão → a placa abre, mede e fecha
 *   → a missão conclui pelo volume MEDIDO → o XP entra → o nível anda
 *
 * Ele existe porque cada peça pode estar certa e a corrente, quebrada. E porque
 * a regra que mais importa no projeto — a missão conclui pelo que o sensor
 * mediu, nunca pelo que alguém pediu — só aparece quando se olha o caminho
 * todo de uma vez.
 */

let pg: PGlite;
let db: Database;
let collectors: CollectorService;
let device: AuthenticatedDevice;
let clock = 0;
let seq = 0;

const student = ACTORS.student;
const CMD = "a1b2c3d4-0000-4000-8000-000000000001";
const EXEC = "a1b2c3d4-0000-4000-8000-000000000002";

/** A missão de três litros do catálogo: é a que o projeto usa de exemplo. */
const MISSAO = MISSION_CATALOG.find((m) => m.liters === 3)!;

const telemetria = (patch: Partial<TelemetryPayload> = {}): TelemetryPayload => {
  seq++;
  return {
    device_id: "VIRTUAL-001",
    collector_code: "ECO-001",
    seq,
    uptime_ms: seq * 1000,
    distance_mm: 700,
    volume_liters: 9,
    valve: "closed",
    status: "READY",
    fw_version: "esp32-0.5.0",
    ...patch,
  };
};

beforeAll(async () => {
  ({ pg, db } = await createTestDatabase());
}, 60_000);

beforeEach(async () => {
  await resetTestDatabase(db);
  await makeCollectorReal(db);
  clock = 1_700_000_000_000;
  seq = 0;
  collectors = createCollectorService({ db, pepper: TEST_PEPPER, now: () => clock });
  const autenticado = await collectors.authenticateDevice(`Bearer ${TEST_DEVICE_TOKEN}`, "VIRTUAL-001", "ECO-001");
  if (!autenticado) throw new Error("dispositivo de teste não autenticou");
  device = autenticado;
  await collectors.ingestTelemetry(device, telemetria());
});

afterAll(async () => {
  await pg.close();
});

const perfil = () => getMe(db, student);

describe("uma missão de três litros, do começo ao fim", () => {
  it("o estudante começa sem XP e sem histórico", async () => {
    const antes = await perfil();
    expect(antes.xp).toBe(0);
    expect(antes.history).toHaveLength(0);
    expect(getLevelProgress(antes.xp).level).toBe(1);
  });

  it("percorre o ciclo e o impacto chega ao perfil", async () => {
    // 1. A leitura do adesivo colado no tubo. Sem ela não há missão.
    const leitura = await scanForRelease(db, IDS.student);

    // 2. O pedido da missão: o volume é do catálogo, não do aplicativo.
    const pedido = await collectors.requestDispense(student, "ECO-001", {
      command_id: CMD,
      execution_id: EXEC,
      mission_id: MISSAO.id,
      scan_id: leitura,
    });
    if (!pedido.ok) throw new Error(pedido.message);
    expect(pedido.value.targetLiters).toBe(3);

    // 3. O comando chega à placa com o alvo e o teto de tempo.
    clock += 1000;
    const paraPlaca = await collectors.ingestTelemetry(device, telemetria());
    expect(paraPlaca.command).toMatchObject({ command_id: CMD, action: "dispense" });

    // 4. A válvula abriu: a água está saindo e o nível cai.
    clock += 2000;
    await collectors.ingestTelemetry(
      device,
      telemetria({
        valve: "open",
        status: "DISPENSING",
        volume_liters: 7.4,
        command_report: {
          command_id: CMD,
          status: "EXECUTING",
          delivered_liters: 1.6,
          start_volume_liters: 9,
          end_volume_liters: null,
          failure: null,
          started_uptime_ms: 2000,
          finished_uptime_ms: null,
        },
      }),
    );
    const meio = await collectors.getSnapshot(student, "ECO-001");
    expect(meio!.telemetry.valve).toBe("open");

    // 5. A placa fechou no volume MEDIDO e relatou o fim.
    clock += 8000;
    await collectors.ingestTelemetry(
      device,
      telemetria({
        volume_liters: 6,
        command_report: {
          command_id: CMD,
          status: "COMPLETED",
          delivered_liters: 3,
          start_volume_liters: 9,
          end_volume_liters: 6,
          failure: null,
          started_uptime_ms: 2000,
          finished_uptime_ms: 14_000,
        },
      }),
    );

    // 6. A execução fecha com o volume medido, e o XP é concedido pelo servidor.
    const execucao = await db.query<{ status: string; delivered_liters: string; xp_awarded: number }>(
      "select status, delivered_liters, xp_awarded from mission_executions where id = $1",
      [EXEC],
    );
    expect(execucao.rows[0]!.status).toBe("COMPLETED");
    expect(Number(execucao.rows[0]!.delivered_liters)).toBeCloseTo(3, 2);
    expect(execucao.rows[0]!.xp_awarded).toBe(MISSAO.xp);

    // 7. O impacto chega ao perfil: XP, histórico e nível.
    const depois = await perfil();
    expect(depois.xp).toBe(MISSAO.xp);
    expect(depois.history[0]).toMatchObject({ status: "COMPLETED", missionId: MISSAO.id });
    expect(Number(depois.history[0]!.deliveredLiters)).toBeCloseTo(3, 2);
    expect(getLevelProgress(depois.xp).xp).toBe(MISSAO.xp);

    // 8. E a leitura não serve de novo: a próxima missão exige ler o tubo outra vez.
    const repetida = await collectors.requestDispense(student, "ECO-001", {
      command_id: "a1b2c3d4-0000-4000-8000-000000000003",
      execution_id: "a1b2c3d4-0000-4000-8000-000000000004",
      mission_id: MISSAO.id,
      scan_id: leitura,
    });
    expect(repetida).toMatchObject({ ok: false, status: 409 });
  });

  it("o XP vem do volume MEDIDO, não do volume pedido", async () => {
    const leitura = await scanForRelease(db, IDS.student);
    await collectors.requestDispense(student, "ECO-001", {
      command_id: CMD,
      execution_id: EXEC,
      mission_id: MISSAO.id,
      scan_id: leitura,
    });

    // A placa pediu 3 L e a torneira entregou 3; mas se ela falhasse no meio,
    // nada de XP — nem proporcional, nem "quase lá".
    clock += 5000;
    await collectors.ingestTelemetry(
      device,
      telemetria({
        volume_liters: 8.2,
        command_report: {
          command_id: CMD,
          status: "FAILED",
          delivered_liters: 0.8,
          start_volume_liters: 9,
          end_volume_liters: 8.2,
          failure: "NO_FLOW",
          started_uptime_ms: 2000,
          finished_uptime_ms: 12_000,
        },
      }),
    );

    const depois = await perfil();
    expect(depois.xp).toBe(0);
    // E o motivo chega junto: "não concluída" sozinho deixaria o estudante sem
    // saber o que fazer diferente da próxima vez.
    expect(depois.history[0]).toMatchObject({ status: "FAILED", xpAwarded: 0, failure: "NO_FLOW" });
    expect(Number(depois.history[0]!.deliveredLiters)).toBeCloseTo(0.8, 2);
  });

  it("missões seguidas somam, e o nível avança quando o XP alcança a faixa", async () => {
    let total = 0;
    for (let i = 0; i < 4; i++) {
      const comando = `b1b2c3d4-0000-4000-8000-00000000000${i}`;
      const execucao = `c1b2c3d4-0000-4000-8000-00000000000${i}`;
      const leitura = await scanForRelease(db, IDS.student);
      clock += 1000;
      // O tubo volta a encher entre as missões: o ar-condicionado não para.
      await collectors.ingestTelemetry(device, telemetria({ volume_liters: 9 }));
      const pedido = await collectors.requestDispense(student, "ECO-001", {
        command_id: comando,
        execution_id: execucao,
        mission_id: MISSAO.id,
        scan_id: leitura,
      });
      if (!pedido.ok) throw new Error(pedido.message);

      clock += 10_000;
      await collectors.ingestTelemetry(
        device,
        telemetria({
          volume_liters: 6,
          command_report: {
            command_id: comando,
            status: "COMPLETED",
            delivered_liters: 3,
            start_volume_liters: 9,
            end_volume_liters: 6,
            failure: null,
            started_uptime_ms: 1000,
            finished_uptime_ms: 11_000,
          },
        }),
      );
      total += MISSAO.xp;
    }

    const depois = await perfil();
    expect(depois.xp).toBe(total);
    expect(depois.history).toHaveLength(4);
    // Quatro missões de três litros tiram o estudante do primeiro nível.
    expect(getLevelProgress(depois.xp).level).toBeGreaterThan(1);
  });
});
