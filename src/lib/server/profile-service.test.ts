import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "./actor";
import { createCollectorService } from "./collector-service";
import { createTestDatabase, IDS, resetTestDatabase, TEST_DEVICE_TOKEN, TEST_PEPPER } from "./db/test-db";
import type { Database } from "./db/types";
import { findActor, getMe, updateIdentity } from "./profile-service";

let db: Database;
const student: Actor = { profileId: IDS.student, schoolId: IDS.school, role: "student" };

beforeAll(async () => {
  ({ db } = await createTestDatabase());
}, 60_000);

beforeEach(async () => {
  await resetTestDatabase(db);
});

describe("perfil do usuário autenticado", () => {
  it("encontra somente perfis ativos", async () => {
    expect(await findActor(db, IDS.student)).toEqual(student);
    await db.query("update profiles set status = 'inactive' where id = $1", [IDS.student]);
    expect(await findActor(db, IDS.student)).toBeNull();
    expect(await findActor(db, "99999999-0000-4000-8000-000000000000")).toBeNull();
  });

  it("monta identidade de exibição com turma do banco e sem dados cadastrais", async () => {
    const me = await getMe(db, student);
    expect(me).toMatchObject({ role: "student", schoolName: "Escola de Teste", xp: 0, history: [] });
    expect(me.identity).toEqual({
      role: "student",
      nickname: "Jhow",
      avatarId: "broto",
      classId: IDS.class6c,
      className: "6º Ano C",
      educationLevel: "elementary",
    });
    expect(JSON.stringify(me)).not.toMatch(/João|Silva|2012-04-15|6C-AAAA/);
  });

  it("exige primeiro acesso quando não há apelido e salva apelido e avatar validados", async () => {
    await db.query("update profiles set nickname = null, avatar_id = null, onboarded_at = null where id = $1", [IDS.student]);
    expect((await getMe(db, student)).identity).toBeNull();

    expect(await updateIdentity(db, student, { nickname: "<b>", avatarId: "broto" })).toMatchObject({ ok: false, status: 422 });
    expect(await updateIdentity(db, student, { nickname: "Jhow", avatarId: "foto" })).toMatchObject({ ok: false, status: 422 });
    expect(await updateIdentity(db, student, { nickname: "Jhow", avatarId: "gota" })).toEqual({ ok: true, value: undefined });

    const me = await getMe(db, student);
    expect(me.identity).toMatchObject({ nickname: "Jhow", avatarId: "gota" });
    const { rows } = await db.query<{ onboarded_at: Date | null }>("select onboarded_at from profiles where id = $1", [IDS.student]);
    expect(rows[0]?.onboarded_at).not.toBeNull();
  });

  it("XP e histórico vêm do banco, a partir da missão confirmada pelo sensor", async () => {
    let clock = 1_000_000;
    const service = createCollectorService({ db, pepper: TEST_PEPPER, now: () => clock });
    const device = (await service.authenticateDevice(`Bearer ${TEST_DEVICE_TOKEN}`, "VIRTUAL-001"))!;
    const base = { device_id: "VIRTUAL-001", collector_code: "EC-001", distance_mm: 700, valve: "closed" as const, status: "READY" as const, fw_version: "t" };
    await service.ingestTelemetry(device, { ...base, seq: 1, uptime_ms: 1000, volume_liters: 8 });
    const commandId = "0b7c6a8e-1f2d-4c3b-9a8e-7f6d5c4b3a21";
    const executionId = "2d9e8c0a-3f4e-4e5d-9c0a-9f8e7d6c5b43";
    await service.requestDispense(student, "EC-001", { command_id: commandId, execution_id: executionId, mission_id: "irrigar-horta" });
    clock += 60_000;
    await service.ingestTelemetry(device, {
      ...base,
      seq: 2,
      uptime_ms: 70_000,
      volume_liters: 6,
      command_report: {
        command_id: commandId,
        status: "COMPLETED",
        delivered_liters: 1.99,
        start_volume_liters: 8,
        end_volume_liters: 6,
        failure: null,
        started_uptime_ms: 2000,
        finished_uptime_ms: 62_000,
      },
    });

    const me = await getMe(db, student);
    expect(me.xp).toBe(50);
    expect(me.history).toEqual([
      expect.objectContaining({ executionId, missionId: "irrigar-horta", status: "COMPLETED", deliveredLiters: 1.99, xpAwarded: 50, origin: "simulation" }),
    ]);
  });
});
