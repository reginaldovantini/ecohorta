import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createCollectorService } from "./collector-service";
import { ACTORS, createTestDatabase, IDS, makeCollectorReal, resetTestDatabase, TEST_DEVICE_TOKEN, TEST_PEPPER } from "./db/test-db";
import type { Database } from "./db/types";
import { collectiveImpact, getRanking, participantRanking, schoolRanking } from "./ranking-service";

const { otherStudent, student, student2, teacher } = ACTORS;

let db: Database;
let missao = 0;

/**
 * Registra uma missão concluída com a água que o sensor mediu.
 * `delivered` é o volume MEDIDO; `target` é o que a missão pediu — o ranking
 * precisa somar o primeiro, nunca o segundo.
 */
async function concluir(
  profileId: string,
  collectorId: string,
  { delivered, target = delivered, simulated = false, status = "COMPLETED" } = {} as {
    delivered: number;
    target?: number;
    simulated?: boolean;
    status?: string;
  },
) {
  const commandId = `60000000-0000-4000-8000-${String(++missao).padStart(12, "0")}`;
  // O banco exige horário de fim em comando terminal e motivo quando há falha.
  await db.query(
    `insert into device_commands (id, collector_id, requested_by, target_liters, delivered_liters, status, failure, is_simulated, queued_at, finished_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, now(), now())`,
    [commandId, collectorId, profileId, target, delivered, status, status === "FAILED" ? "NO_FLOW" : null, simulated],
  );
  await db.query(
    `insert into mission_executions (id, profile_id, collector_id, command_id, mission_id, mission_category, target_liters, delivered_liters, status, created_at, finished_at)
     values (gen_random_uuid(), $1, $2, $3, 'regar-jardim', 'action', $4, $5, $6, now(), now())`,
    [profileId, collectorId, commandId, target, delivered, status],
  );
}

beforeAll(async () => {
  ({ db } = await createTestDatabase());
}, 60_000);

beforeEach(async () => {
  await resetTestDatabase(db);
  missao = 0;
  // Impacto e ranking só existem com captador físico.
  await makeCollectorReal(db);
});

describe("impacto coletivo", () => {
  it("começa em zero e conta o que foi medido, não o que foi pedido", async () => {
    expect(await collectiveImpact(db)).toEqual({ liters: 0, missions: 0, participants: 0, schools: 0 });

    await concluir(IDS.student, IDS.collector, { delivered: 2.87, target: 3 });
    expect(await collectiveImpact(db)).toMatchObject({ liters: 2.87, missions: 1, participants: 1, schools: 1 });
  });

  it("soma as escolas todas: é o impacto de quem joga junto", async () => {
    await concluir(IDS.student, IDS.collector, { delivered: 3 });
    await concluir(IDS.otherStudent, IDS.otherCollector, { delivered: 5 });
    expect(await collectiveImpact(db)).toMatchObject({ liters: 8, missions: 2, participants: 2, schools: 2 });
  });

  it("ignora missão que falhou ou foi cancelada", async () => {
    await concluir(IDS.student, IDS.collector, { delivered: 3 });
    await concluir(IDS.student, IDS.collector, { delivered: 2, status: "FAILED" });
    await concluir(IDS.student, IDS.collector, { delivered: 1, status: "CANCELLED" });
    expect(await collectiveImpact(db)).toMatchObject({ liters: 3, missions: 1 });
  });

  it("água de captador simulado não entra no impacto do projeto", async () => {
    await concluir(IDS.student, IDS.collector, { delivered: 3 });
    await concluir(IDS.student2, IDS.collector, { delivered: 10, simulated: true });
    expect(await collectiveImpact(db)).toMatchObject({ liters: 3, missions: 1, participants: 1 });
  });
});

describe("ranking de escolas", () => {
  it("ordena por água reutilizada e marca a escola de quem está olhando", async () => {
    await concluir(IDS.student, IDS.collector, { delivered: 4 });
    await concluir(IDS.otherStudent, IDS.otherCollector, { delivered: 9 });

    const lista = await schoolRanking(db, student);
    expect(lista.map((s) => [s.position, s.name, s.liters])).toEqual([
      [1, "Outra Escola", 9],
      [2, "Escola de Teste", 4],
    ]);
    expect(lista.find((s) => s.mine)?.name).toBe("Escola de Teste");
  });

  it("conta quantas pessoas participaram de cada escola", async () => {
    await concluir(IDS.student, IDS.collector, { delivered: 2 });
    await concluir(IDS.student2, IDS.collector, { delivered: 3 });
    await concluir(IDS.student, IDS.collector, { delivered: 1 });

    const [escola] = await schoolRanking(db, student);
    expect(escola).toMatchObject({ liters: 6, missions: 3, participants: 2 });
  });

  it("escola sem missão concluída não aparece na lista", async () => {
    await concluir(IDS.student, IDS.collector, { delivered: 2 });
    expect((await schoolRanking(db, student)).map((s) => s.name)).toEqual(["Escola de Teste"]);
  });
});

describe("ranking de colegas", () => {
  it("lista só a escola atual: colega é quem está na mesma escola", async () => {
    await concluir(IDS.student, IDS.collector, { delivered: 3 });
    await concluir(IDS.otherStudent, IDS.otherCollector, { delivered: 50 });

    const lista = await participantRanking(db, student);
    expect(lista.map((p) => p.nickname)).toEqual(["Jhow"]);
  });

  it("ordena por litros e marca quem está olhando", async () => {
    await concluir(IDS.student, IDS.collector, { delivered: 2 });
    await concluir(IDS.student2, IDS.collector, { delivered: 7 });
    await concluir(IDS.teacher, IDS.collector, { delivered: 4 });

    const lista = await participantRanking(db, student);
    expect(lista.map((p) => [p.position, p.nickname, p.liters])).toEqual([
      [1, "Ana", 7],
      [2, "Prof. Rê", 4],
      [3, "Jhow", 2],
    ]);
    expect(lista.find((p) => p.mine)?.nickname).toBe("Jhow");
  });

  it("mostra só dado de exibição — nome, sexo e nascimento ficam fora", async () => {
    await concluir(IDS.student, IDS.collector, { delivered: 3 });
    const lista = await participantRanking(db, student);
    expect(lista[0]).toMatchObject({ nickname: "Jhow", avatarId: "broto", gradePhase: "ano_9" });
    expect(JSON.stringify(lista)).not.toMatch(/João|masculino|2010-04-15/);
  });

  it("quem ainda não concluiu missão não aparece", async () => {
    await concluir(IDS.student, IDS.collector, { delivered: 3 });
    expect((await participantRanking(db, student)).map((p) => p.nickname)).toEqual(["Jhow"]);
  });

  it("sem escola, não há colegas para comparar", async () => {
    await db.query("update profiles set school_id = null where id = $1", [IDS.student]);
    expect(await participantRanking(db, { ...student, schoolId: null })).toEqual([]);
  });
});

describe("a visão completa do ranking", () => {
  it("entrega impacto, escolas, colegas e a própria posição", async () => {
    await concluir(IDS.student, IDS.collector, { delivered: 2 });
    await concluir(IDS.student2, IDS.collector, { delivered: 6 });
    await concluir(IDS.otherStudent, IDS.otherCollector, { delivered: 3 });

    const view = await getRanking(db, student);
    expect(view.impact).toMatchObject({ liters: 11, missions: 3, participants: 3, schools: 2 });
    expect(view.schools.map((s) => s.name)).toEqual(["Escola de Teste", "Outra Escola"]);
    expect(view.participants.map((p) => p.nickname)).toEqual(["Ana", "Jhow"]);
    expect(view.myPosition).toBe(2);
  });

  it("sem nenhuma missão concluída, a posição é nula em vez de inventada", async () => {
    const view = await getRanking(db, teacher);
    expect(view.myPosition).toBeNull();
    expect(view.impact.liters).toBe(0);
  });

  it("o professor também aparece entre os colegas da escola", async () => {
    await concluir(IDS.teacher, IDS.collector, { delivered: 5 });
    const view = await getRanking(db, teacher);
    expect(view.myPosition).toBe(1);
  });

  it("quem é de outra escola vê o próprio ranking, não o da primeira", async () => {
    await concluir(IDS.student, IDS.collector, { delivered: 9 });
    await concluir(IDS.otherStudent, IDS.otherCollector, { delivered: 1 });

    const view = await getRanking(db, otherStudent);
    expect(view.participants.map((p) => p.nickname)).toEqual(["Outro"]);
    expect(view.schools.find((s) => s.mine)?.name).toBe("Outra Escola");
    // O impacto coletivo é de todos: esse número não muda com quem olha.
    expect(view.impact.liters).toBe(10);
  });
});

describe("quem ainda não concluiu o primeiro acesso", () => {
  it("fica fora da lista em vez de aparecer sem nome", async () => {
    // Perfil recém-criado no primeiro login: sem apelido e sem avatar ainda.
    const recem = "90000000-0000-4000-8000-0000000000f1";
    await db.query("insert into auth.users (id, email) values ($1, 'recem@gmail.com')", [recem]);
    await db.query("insert into profiles (id, school_id, role) values ($1, $2, 'student')", [recem, IDS.school]);
    await db.query("insert into school_members (profile_id, school_id) values ($1, $2)", [recem, IDS.school]);

    await concluir(recem, IDS.collector, { delivered: 9 });
    await concluir(IDS.student, IDS.collector, { delivered: 1 });
    expect((await participantRanking(db, student)).map((p) => p.nickname)).toEqual(["Jhow"]);
  });
});

describe("o captador de teste não contamina nada", () => {
  it("missão simulada não gera XP: teste não vira conquista", async () => {
    await db.query("update collectors set prefix = 'SIM', code = 'SIM-001' where id = $1", [IDS.collector]);
    await db.query("update devices set is_simulated = true where collector_id = $1", [IDS.collector]);

    const service = createCollectorService({ db, pepper: TEST_PEPPER });
    const device = (await service.authenticateDevice(`Bearer ${TEST_DEVICE_TOKEN}`, "VIRTUAL-001", "SIM-001"))!;
    const commandId = "60000000-0000-4000-8000-0000000000ff";
    await db.query(
      `insert into device_commands (id, collector_id, requested_by, target_liters, status, is_simulated, queued_at)
       values ($1, $2, $3, 1, 'EXECUTING', true, now())`,
      [commandId, IDS.collector, IDS.student],
    );
    await db.query(
      `insert into mission_executions (id, profile_id, collector_id, command_id, mission_id, mission_category, target_liters, status, created_at)
       values (gen_random_uuid(), $1, $2, $3, 'hidratar-mudas', 'action', 1, 'EXECUTING', now())`,
      [IDS.student, IDS.collector, commandId],
    );

    await service.ingestTelemetry(device, {
      device_id: "VIRTUAL-001",
      collector_code: "SIM-001",
      seq: 1,
      uptime_ms: 1000,
      distance_mm: 900,
      valve: "closed",
      status: "READY",
      fw_version: "teste",
      command_report: {
        command_id: commandId,
        status: "COMPLETED",
        delivered_liters: 1,
        start_volume_liters: 5,
        end_volume_liters: 4,
        failure: null,
        started_uptime_ms: 0,
        finished_uptime_ms: 500,
      },
    });

    const execucao = await db.query<{ status: string; xp_awarded: number }>(
      "select status, xp_awarded from mission_executions where command_id = $1",
      [commandId],
    );
    // A missão é registrada — ela aconteceu — mas sem XP nenhum.
    expect(execucao.rows[0]).toMatchObject({ status: "COMPLETED", xp_awarded: 0 });
    const xp = await db.query("select 1 from xp_transactions where profile_id = $1", [IDS.student]);
    expect(xp.rows).toHaveLength(0);
  });

  it("o captador de teste não aparece para estudante, professor nem funcionário", async () => {
    await db.query("update collectors set prefix = 'SIM', code = 'SIM-001' where id = $1", [IDS.collector]);
    const service = createCollectorService({ db, pepper: TEST_PEPPER });

    expect(await service.listCollectors(student)).toEqual([]);
    expect(await service.listCollectors(ACTORS.staff)).toEqual([]);
    // Nem para quem é responsável pelo tubo: responsabilidade é sobre o captador, não administração.
    expect(await service.listCollectors(teacher)).toEqual([]);
  });

  it("aparece para a administração, que é quem o usa para testar", async () => {
    await db.query("update collectors set prefix = 'SIM', code = 'SIM-001' where id = $1", [IDS.collector]);
    const service = createCollectorService({ db, pepper: TEST_PEPPER });
    const admin = { ...student, role: "admin" as const };
    expect((await service.listCollectors(admin)).map((c) => c.code)).toEqual(["SIM-001"]);
  });
});
