import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { TelemetryPayload } from "@/lib/iot/api-schema";
import type { Actor } from "./actor";
import { createCollectorService, IDLE_POLL_MS, ACTIVE_POLL_MS, type AuthenticatedDevice, type CollectorService } from "./collector-service";
import { createTestDatabase, IDS, resetTestDatabase, TEST_DEVICE_TOKEN, TEST_PEPPER } from "./db/test-db";
import type { Database } from "./db/types";

const CMD = {
  a: "0b7c6a8e-1f2d-4c3b-9a8e-7f6d5c4b3a21",
  b: "1c8d7b9f-2e3d-4d4c-8b9f-8e7d6c5b4a32",
  c: "3e0f9d1b-4a5f-4f6e-8d1b-0a9f8e7d6c54",
};
const EXEC = {
  a: "2d9e8c0a-3f4e-4e5d-9c0a-9f8e7d6c5b43",
  b: "4f1a0e2c-5b6a-4a7f-9e2c-1b0a9f8e7d65",
  c: "5a2b1f3d-6c7b-4b8a-8f3d-2c1b0a9f8e76",
};

const student: Actor = { profileId: IDS.student, schoolId: IDS.school, role: "student" };
const student2: Actor = { profileId: IDS.student2, schoolId: IDS.school, role: "student" };
const teacher: Actor = { profileId: IDS.teacher, schoolId: IDS.school, role: "teacher" };
const staff: Actor = { profileId: IDS.staff, schoolId: IDS.school, role: "staff" };
const otherStudent: Actor = { profileId: IDS.otherStudent, schoolId: IDS.otherSchool, role: "student" };

let pg: PGlite;
let db: Database;
let clock = 1_000_000;
let seq = 0;
let service: CollectorService;
let device: AuthenticatedDevice;

function telemetry(patch: Partial<TelemetryPayload> = {}): TelemetryPayload {
  seq++;
  return {
    device_id: "VIRTUAL-001",
    collector_code: "EC-001",
    seq,
    uptime_ms: seq * 1000,
    distance_mm: 700,
    volume_liters: 8,
    valve: "closed",
    status: "READY",
    fw_version: "sim-1",
    ...patch,
  };
}

const dispense = (commandId: string, executionId: string, missionId = "regar-jardim") => ({
  command_id: commandId,
  execution_id: executionId,
  mission_id: missionId,
});

const report = (commandId: string, patch: Partial<NonNullable<TelemetryPayload["command_report"]>> = {}) => ({
  command_id: commandId,
  status: "EXECUTING" as const,
  delivered_liters: 0.4,
  start_volume_liters: 8,
  end_volume_liters: null,
  failure: null,
  started_uptime_ms: 5000,
  finished_uptime_ms: null,
  ...patch,
});

const ingest = (patch: Partial<TelemetryPayload> = {}) => service.ingestTelemetry(device, telemetry(patch));

beforeAll(async () => {
  ({ pg, db } = await createTestDatabase());
}, 60_000);

beforeEach(async () => {
  await resetTestDatabase(db);
  clock = 1_000_000;
  seq = 0;
  service = createCollectorService({ db, pepper: TEST_PEPPER, now: () => clock });
  device = (await service.authenticateDevice(`Bearer ${TEST_DEVICE_TOKEN}`, "VIRTUAL-001", "EC-001"))!;
});

describe("autenticação do dispositivo", () => {
  it("aceita somente o token correto do dispositivo cadastrado", async () => {
    expect(device).toMatchObject({ collectorCode: "EC-001", isSimulated: true, deviceKey: "VIRTUAL-001" });
    expect(await service.authenticateDevice("Bearer errado", "VIRTUAL-001", "EC-001")).toBeNull();
    expect(await service.authenticateDevice(`Bearer ${TEST_DEVICE_TOKEN}`, "OUTRO", "EC-001")).toBeNull();
    expect(await service.authenticateDevice(null, "VIRTUAL-001", "EC-001")).toBeNull();
    // Token certo, mas informando o captador de outro dispositivo.
    expect(await service.authenticateDevice(`Bearer ${TEST_DEVICE_TOKEN}`, "VIRTUAL-001", "EC-900")).toBeNull();
  });

  it("guarda somente o hash do token", async () => {
    const { rows } = await db.query<{ token_hash: string }>("select token_hash from devices where device_key = 'VIRTUAL-001'");
    expect(rows[0]?.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0]?.token_hash).not.toContain(TEST_DEVICE_TOKEN);
  });
});

describe("snapshot", () => {
  it("fica OFFLINE sem telemetria recente e aceita códigos sem hífen", async () => {
    expect((await service.getSnapshot(student, "ec001"))?.telemetry.status).toBe("OFFLINE");
    await ingest();
    expect((await service.getSnapshot(student, "EC001"))?.telemetry).toMatchObject({ status: "READY", volumeLiters: 8, origin: "simulation" });
    clock += 16_000;
    expect((await service.getSnapshot(student, "EC-001"))?.telemetry.status).toBe("OFFLINE");
  });
});

describe("ciclo de liberação", () => {
  beforeEach(async () => {
    await ingest();
  });

  it("entrega o comando ao dispositivo até receber o primeiro relatório", async () => {
    const created = await service.requestDispense(student, "EC-001", dispense(CMD.a, EXEC.a));
    expect(created.ok && created.value.status).toBe("QUEUED");

    expect((await ingest()).command).toMatchObject({ command_id: CMD.a, action: "dispense", target_liters: 3 });
    expect((await ingest()).command?.command_id).toBe(CMD.a);

    const response = await ingest({ valve: "open", status: "DISPENSING", command_report: report(CMD.a) });
    expect(response.command).toBeNull();
    expect(response.next_poll_ms).toBe(ACTIVE_POLL_MS);
    expect((await service.getProgress(student, "EC-001", CMD.a))?.status).toBe("EXECUTING");
  });

  it("é idempotente e registra o reúso medido e o XP uma única vez", async () => {
    await service.requestDispense(student, "EC-001", dispense(CMD.a, EXEC.a));
    expect((await service.requestDispense(student, "EC-001", dispense(CMD.a, EXEC.a))).ok).toBe(true);

    const completed = report(CMD.a, { status: "COMPLETED", delivered_liters: 2.98, end_volume_liters: 5.02, finished_uptime_ms: 119_000 });
    await ingest({ volume_liters: 5.02, command_report: completed });
    await ingest({ volume_liters: 5.02, command_report: completed });

    const progress = (await service.getProgress(student, "EC-001", CMD.a))!;
    expect(progress.status).toBe("COMPLETED");
    expect(progress.finishedAt! - progress.startedAt!).toBe(114_000);
    expect((await service.getSnapshot(student, "EC-001"))?.totals.reusedLiters).toBe(2.98);

    const xp = await db.query<{ amount: number; source_id: string }>("select amount, source_id from xp_transactions where profile_id = $1", [IDS.student]);
    expect(xp.rows).toEqual([{ amount: 50, source_id: EXEC.a }]);
    const execution = await db.query<{ status: string; xp_awarded: number }>("select status, xp_awarded from mission_executions where id = $1", [EXEC.a]);
    expect(execution.rows[0]).toEqual({ status: "COMPLETED", xp_awarded: 50 });
  });

  it("recusa uma segunda liberação simultânea", async () => {
    await service.requestDispense(student, "EC-001", dispense(CMD.a, EXEC.a));
    const busy = await service.requestDispense(student2, "EC-001", dispense(CMD.b, EXEC.b, "hidratar-mudas"));
    expect(busy.ok && busy.value).toMatchObject({ status: "FAILED", failure: "DEVICE_BUSY" });
  });

  it("recusa volume acima do disponível", async () => {
    await ingest({ volume_liters: 3 });
    const tooMuch = await service.requestDispense(student, "EC-001", dispense(CMD.a, EXEC.a));
    expect(tooMuch.ok && tooMuch.value).toMatchObject({ status: "FAILED", failure: "INSUFFICIENT_WATER" });
  });

  it("cancela imediatamente enquanto na fila e expira se o dispositivo não buscar", async () => {
    await service.requestDispense(student, "EC-001", dispense(CMD.a, EXEC.a));
    const cancelled = await service.requestCancel(student, "EC-001", CMD.a);
    expect(cancelled.ok && cancelled.value.status).toBe("CANCELLED");

    await service.requestDispense(student, "EC-001", dispense(CMD.b, EXEC.b, "hidratar-mudas"));
    clock += 31_000;
    expect(await service.getProgress(student, "EC-001", CMD.b)).toMatchObject({ status: "FAILED", failure: "DEVICE_OFFLINE" });
  });

  it("repassa o cancelamento ao dispositivo durante a liberação", async () => {
    await service.requestDispense(student, "EC-001", dispense(CMD.a, EXEC.a));
    await ingest({ valve: "open", command_report: report(CMD.a, { delivered_liters: 0.5 }) });
    await service.requestCancel(student, "EC-001", CMD.a);
    expect((await ingest({ valve: "open" })).command).toEqual({ command_id: CMD.a, action: "cancel" });
  });

  it("concede XP somente quando o sensor confirma a conclusão", async () => {
    await service.requestDispense(student, "EC-001", dispense(CMD.a, EXEC.a));
    await ingest({ command_report: report(CMD.a, { status: "FAILED", failure: "NO_FLOW", delivered_liters: 0, finished_uptime_ms: 11_000 }) });
    const xp = await db.query("select 1 from xp_transactions");
    expect(xp.rows).toHaveLength(0);
    expect((await service.getProgress(student, "EC-001", CMD.a))?.failure).toBe("NO_FLOW");
  });
});

describe("regras de negócio decididas no servidor", () => {
  beforeEach(async () => {
    await ingest();
  });

  it("usa o volume da missão, ignorando o valor enviado pelo navegador", async () => {
    const created = await service.requestDispense(student, "EC-001", { ...dispense(CMD.a, EXEC.a), target_liters: 50 } as never);
    expect(created.ok && created.value.targetLiters).toBe(3);
  });

  it("recusa missão desconhecida e resgate fora da faixa de atenção", async () => {
    expect(await service.requestDispense(student, "EC-001", dispense(CMD.a, EXEC.a, "missao-inventada"))).toMatchObject({ ok: false, status: 422 });
    expect(await service.requestDispense(student, "EC-001", dispense(CMD.b, EXEC.b, "resgate"))).toMatchObject({ ok: false, status: 409 });
  });

  it("calcula o volume do resgate a partir do nível medido", async () => {
    await ingest({ volume_liters: 11.6 });
    const rescue = await service.requestDispense(student, "EC-001", dispense(CMD.a, EXEC.a, "resgate"));
    expect(rescue.ok && rescue.value).toMatchObject({ status: "QUEUED", targetLiters: 3 });
  });

  it("não reaproveita command_id de outra pessoa", async () => {
    await service.requestDispense(student, "EC-001", dispense(CMD.a, EXEC.a));
    expect(await service.requestDispense(student2, "EC-001", dispense(CMD.a, EXEC.b))).toMatchObject({ ok: false, status: 409 });
  });
});

describe("autorização", () => {
  beforeEach(async () => {
    await ingest();
    await service.requestDispense(student, "EC-001", dispense(CMD.a, EXEC.a));
  });

  it("outro estudante não vê nem cancela o comando de alguém", async () => {
    expect(await service.getProgress(student2, "EC-001", CMD.a)).toBeNull();
    expect(await service.requestCancel(student2, "EC-001", CMD.a)).toMatchObject({ ok: false, status: 404 });
  });

  it("professor acompanha e cancela comandos da escola", async () => {
    expect((await service.getProgress(teacher, "EC-001", CMD.a))?.status).toBe("QUEUED");
    expect(await service.requestCancel(teacher, "EC-001", CMD.a)).toMatchObject({ ok: true, value: { status: "CANCELLED" } });
  });

  it("usuário de outra escola não enxerga o captador", async () => {
    expect(await service.getSnapshot(otherStudent, "EC-001")).toBeNull();
    expect(await service.listCollectors(otherStudent)).toEqual([{ code: "EC-900", name: "Captador Externo", location: "Pátio" }]);
    expect(await service.requestDispense(otherStudent, "EC-001", dispense(CMD.b, EXEC.b))).toMatchObject({ ok: false, status: 404 });
  });

  it("simulação é restrita a professores e administradores", async () => {
    expect(await service.updateSimulation(student, "EC-001", { settings: { timeScale: 120 } })).toMatchObject({ ok: false, status: 403 });
    expect(await service.updateSimulation(staff, "EC-001", { settings: { timeScale: 120 } })).toMatchObject({ ok: false, status: 403 });
    expect(await service.updateSimulation(teacher, "EC-001", { settings: { timeScale: 30 } })).toMatchObject({ ok: true });
  });
});

describe("simulação", () => {
  beforeEach(async () => {
    await ingest();
  });

  it("entrega ações ao dispositivo virtual até a confirmação", async () => {
    const result = await service.updateSimulation(teacher, "EC-001", { settings: { timeScale: 30 }, action: { type: "set_level", ratio: 0.97 } });
    expect(result.ok).toBe(true);

    const response = await ingest();
    expect(response.simulation?.settings.timeScale).toBe(30);
    expect(response.simulation?.action).toMatchObject({ id: 1, type: "set_level", ratio: 0.97 });
    expect(response.next_poll_ms).toBe(IDLE_POLL_MS);

    const acknowledged = await ingest({ applied_simulation_action_id: 1 });
    expect(acknowledged.simulation?.action).toBeNull();
  });

  it("ajuste de nível confirmado recomeça a tendência sem apagar o reúso medido", async () => {
    await service.requestDispense(student, "EC-001", { command_id: CMD.a, execution_id: EXEC.a, mission_id: "irrigar-horta" });
    await ingest({
      volume_liters: 6,
      command_report: report(CMD.a, { status: "COMPLETED", delivered_liters: 2, end_volume_liters: 6, started_uptime_ms: 3000, finished_uptime_ms: 60_000 }),
    });

    await service.updateSimulation(teacher, "EC-001", { action: { type: "set_level", ratio: 0.95 } });
    await ingest({ volume_liters: 6 });
    await ingest({ volume_liters: 11.4, applied_simulation_action_id: 1 });
    for (let i = 0; i < 5; i++) await ingest({ volume_liters: 11.4 });

    const snapshot = (await service.getSnapshot(student, "EC-001"))!;
    expect(snapshot.totals.reusedLiters).toBe(2);
    expect(snapshot.telemetry.trend).toBe("stable");
  });

  it("reiniciar a simulação zera o balanço após a confirmação", async () => {
    await service.updateSimulation(teacher, "EC-001", { action: { type: "reset" } });
    await ingest({ volume_liters: 6.6, applied_simulation_action_id: 1 });
    expect((await service.getSnapshot(student, "EC-001"))!.totals.reusedLiters).toBe(0);
  });

  it("recusa comandos de simulação para captadores reais", async () => {
    await db.query("update collector_state set simulation = null where collector_id = $1", [IDS.collector]);
    expect(await service.updateSimulation(teacher, "EC-001", { settings: { timeScale: 30 } })).toMatchObject({ ok: false, status: 403 });
  });
});

describe("persistência", () => {
  it("mantém estado, comandos e balanço quando o servidor reinicia", async () => {
    await ingest();
    await service.requestDispense(student, "EC-001", dispense(CMD.a, EXEC.a));
    await ingest({ volume_liters: 5, command_report: report(CMD.a, { status: "COMPLETED", delivered_liters: 3, end_volume_liters: 5, finished_uptime_ms: 60_000 }) });

    // Nova instância do serviço = novo processo / nova função serverless.
    const restarted = createCollectorService({ db, pepper: TEST_PEPPER, now: () => clock });
    const snapshot = (await restarted.getSnapshot(student, "EC-001"))!;
    expect(snapshot.telemetry).toMatchObject({ status: "READY", volumeLiters: 5 });
    expect(snapshot.totals.reusedLiters).toBe(3);
    expect((await restarted.getProgress(student, "EC-001", CMD.a))?.status).toBe("COMPLETED");
  });

  it("armazena histórico de telemetria de forma amostrada", async () => {
    for (let i = 0; i < 10; i++) {
      await ingest({ volume_liters: 8 });
      clock += 1000;
    }
    const count = async () => Number((await pg.query<{ n: number }>("select count(*)::int as n from telemetry")).rows[0]?.n);
    expect(await count()).toBe(1);

    await ingest({ volume_liters: 8, valve: "open" }); // mudança de válvula
    expect(await count()).toBe(2);

    clock += 31_000;
    await ingest({ volume_liters: 8, valve: "open" }); // intervalo de 30 s
    expect(await count()).toBe(3);

    const { rows } = await db.query<{ level_state: string; is_simulated: boolean }>("select level_state, is_simulated from telemetry order by id limit 1");
    expect(rows[0]).toEqual({ level_state: "available", is_simulated: true });
  });
});
