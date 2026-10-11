import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createCollectorService } from "./collector-service";
import { ACTORS, createTestDatabase, IDS, resetTestDatabase, TEST_DEVICE_TOKEN, TEST_PEPPER } from "./db/test-db";
import type { Database } from "./db/types";
import { addSchoolMember, completeOnboarding, ensureProfile, findActor, getMe, switchSchool, updateIdentity } from "./profile-service";

let db: Database;
const { student } = ACTORS;

beforeAll(async () => {
  ({ db } = await createTestDatabase());
}, 60_000);

beforeEach(async () => {
  await resetTestDatabase(db);
});

describe("perfil do usuário autenticado", () => {
  it("encontra somente perfis ativos", async () => {
    expect(await findActor(db, IDS.student)).toEqual({ ...student, stewardOf: [] });
    await db.query("update profiles set status = 'inactive' where id = $1", [IDS.student]);
    expect(await findActor(db, IDS.student)).toBeNull();
    expect(await findActor(db, "99999999-0000-4000-8000-000000000000")).toBeNull();
  });

  it("monta identidade de exibição com o ano/fase do banco e sem dados cadastrais", async () => {
    const me = await getMe(db, student);
    expect(me).toMatchObject({ role: "student", schoolName: "Escola de Teste", xp: 0, history: [] });
    expect(me.identity).toEqual({ role: "student", nickname: "Jhow", avatarId: "broto", gradePhase: "ano_9" });
    // Nome, sexo e data de nascimento nunca saem do banco para o navegador.
    expect(JSON.stringify(me)).not.toMatch(/João|masculino|2010-04-15/);
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

describe("primeiro acesso (cadastro aberto)", () => {
  const NOVO = "80000000-0000-4000-8000-000000000001";

  beforeEach(async () => {
    await db.query("insert into auth.users (id, email) values ($1, 'novo@gmail.com')", [NOVO]);
  });

  it("o perfil nasce no primeiro login: sem escola, sem privilégio e sem cadastro concluído", async () => {
    await ensureProfile(db, NOVO);
    const actor = (await findActor(db, NOVO))!;
    expect(actor).toMatchObject({ schoolId: null, role: "student", platformAdmin: false, stewardOf: [] });

    const me = await getMe(db, actor);
    expect(me.identity).toBeNull(); // leva ao primeiro acesso
    expect(me.schoolName).toBeNull();
  });

  it("entrar de novo não recria nem sobrescreve o perfil", async () => {
    await ensureProfile(db, NOVO);
    await db.query("update profiles set role = 'teacher', nickname = 'Rê' where id = $1", [NOVO]);
    await ensureProfile(db, NOVO);
    const { rows } = await db.query<{ role: string; nickname: string }>("select role, nickname from profiles where id = $1", [NOVO]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ role: "teacher", nickname: "Rê" });
  });

  it("conclui o cadastro de estudante e guarda os dados pessoais fora do perfil de exibição", async () => {
    await ensureProfile(db, NOVO);
    const actor = (await findActor(db, NOVO))!;
    const result = await completeOnboarding(db, actor, {
      name: "Jhow",
      sex: "masculino",
      birthDate: "2010-04-15",
      role: "student",
      gradePhase: "ano_9",
      avatarId: "broto",
    });
    expect(result.ok).toBe(true);

    const me = await getMe(db, (await findActor(db, NOVO))!);
    expect(me.identity).toEqual({ role: "student", nickname: "Jhow", avatarId: "broto", gradePhase: "ano_9" });
    expect(JSON.stringify(me)).not.toMatch(/masculino|2010-04-15/);

    const { rows } = await db.query<{ first_name: string; sex: string; birth_date: Date }>(
      "select first_name, sex, birth_date from person_records where profile_id = $1",
      [NOVO],
    );
    expect(rows[0]).toMatchObject({ first_name: "Jhow", sex: "masculino" });
  });

  it("professor e funcionário não recebem ano/fase", async () => {
    await ensureProfile(db, NOVO);
    const actor = (await findActor(db, NOVO))!;
    await completeOnboarding(db, actor, {
      name: "Rê",
      sex: "feminino",
      birthDate: "1985-02-10",
      role: "teacher",
      gradePhase: "ano_1",
      avatarId: "cientista",
    });
    const { rows } = await db.query<{ role: string; grade_phase: string | null }>("select role, grade_phase from profiles where id = $1", [NOVO]);
    expect(rows[0]).toEqual({ role: "teacher", grade_phase: null });
  });

  it("recusa função de administração: ela não é autoatribuível", async () => {
    await ensureProfile(db, NOVO);
    const actor = (await findActor(db, NOVO))!;
    const result = await completeOnboarding(db, actor, {
      name: "Esperto",
      sex: "masculino",
      birthDate: "2000-01-01",
      role: "admin",
      avatarId: "estrela",
    });
    expect(result.ok).toBe(false);
    const { rows } = await db.query<{ role: string }>("select role from profiles where id = $1", [NOVO]);
    expect(rows[0]!.role).toBe("student");
  });

  it("recusa estudante sem ano/fase", async () => {
    await ensureProfile(db, NOVO);
    const actor = (await findActor(db, NOVO))!;
    const result = await completeOnboarding(db, actor, {
      name: "Sem Ano",
      sex: "feminino",
      birthDate: "2010-01-01",
      role: "student",
      avatarId: "gota",
    });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toMatch(/ano\/fase/i);
  });
});

describe("jogar em uma escola por vez", () => {
  it("lista as escolas a que a pessoa pertence, marcando a atual", async () => {
    const me = await getMe(db, student);
    expect(me.schools).toEqual([{ id: IDS.school, name: "Escola de Teste", current: true, joinedVia: null }]);
  });

  it("o estudante só enxerga os captadores da escola atual, mesmo pertencendo a duas", async () => {
    await db.query("insert into school_members (profile_id, school_id) values ($1, $2)", [IDS.student, IDS.otherSchool]);
    const service = createCollectorService({ db, pepper: TEST_PEPPER });

    expect((await service.listCollectors(student)).map((c) => c.code)).toEqual(["EC-001"]);

    await switchSchool(db, student, IDS.otherSchool);
    const depois = (await findActor(db, IDS.student))!;
    expect((await service.listCollectors(depois)).map((c) => c.code)).toEqual(["EC-900"]);
  });

  it("trocar de escola muda o que o perfil mostra como atual", async () => {
    await db.query("insert into school_members (profile_id, school_id) values ($1, $2)", [IDS.student, IDS.otherSchool]);
    await switchSchool(db, student, IDS.otherSchool);
    const me = await getMe(db, (await findActor(db, IDS.student))!);
    expect(me.schoolName).toBe("Outra Escola");
    expect(me.schools.find((s) => s.current)?.name).toBe("Outra Escola");
    expect(me.schools).toHaveLength(2);
  });

  it("não troca para uma escola a que não pertence: a leitura do QR é o caminho", async () => {
    const result = await switchSchool(db, student, IDS.otherSchool);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toMatch(/QR Code/i);

    const { rows } = await db.query<{ school_id: string }>("select school_id from profiles where id = $1", [IDS.student]);
    expect(rows[0]!.school_id).toBe(IDS.school); // continua onde estava
  });

  it("recusa escola inexistente ou valor inventado pelo navegador", async () => {
    expect((await switchSchool(db, student, "00000000-0000-4000-8000-000000000000")).ok).toBe(false);
    expect((await switchSchool(db, student, 42)).ok).toBe(false);
    expect((await switchSchool(db, student, null)).ok).toBe(false);
  });

  it("diz por qual captador a pessoa entrou em cada escola", async () => {
    await db.query("insert into school_members (profile_id, school_id, joined_via_collector) values ($1, $2, $3)", [
      IDS.student,
      IDS.otherSchool,
      IDS.otherCollector,
    ]);
    const me = await getMe(db, student);
    const visitada = me.schools.find((s) => s.id === IDS.otherSchool)!;
    expect(visitada.joinedVia).toEqual({ code: "EC-900", location: "Pátio" });
  });
});

describe("captador apagado até a verificação", () => {
  it("o captador aparece apagado enquanto esta pessoa nunca leu o QR dele", async () => {
    const service = createCollectorService({ db, pepper: TEST_PEPPER });
    const [captador] = await service.listCollectors(student);
    expect(captador).toMatchObject({ code: "EC-001", verified: false });
  });

  it("depois de ler o QR, ele acende — e só para quem leu", async () => {
    const service = createCollectorService({ db, pepper: TEST_PEPPER });
    await db.query("insert into collector_scans (collector_id, profile_id) values ($1, $2)", [IDS.collector, IDS.student]);

    expect((await service.listCollectors(student))[0]).toMatchObject({ verified: true });
    // O colega da mesma escola continua precisando ler o dele.
    expect((await service.listCollectors(ACTORS.student2))[0]).toMatchObject({ verified: false });
  });

  it("ao trocar de escola, os captadores de lá começam apagados", async () => {
    await db.query("insert into school_members (profile_id, school_id) values ($1, $2)", [IDS.student, IDS.otherSchool]);
    await db.query("insert into collector_scans (collector_id, profile_id) values ($1, $2)", [IDS.collector, IDS.student]);
    await switchSchool(db, student, IDS.otherSchool);

    const service = createCollectorService({ db, pepper: TEST_PEPPER });
    const naOutra = await service.listCollectors((await findActor(db, IDS.student))!);
    expect(naOutra).toEqual([expect.objectContaining({ code: "EC-900", verified: false })]);
  });

  it("captador desativado some da lista", async () => {
    await db.query("update collectors set active = false where id = $1", [IDS.collector]);
    const service = createCollectorService({ db, pepper: TEST_PEPPER });
    expect(await service.listCollectors(student)).toEqual([]);
  });
});

describe("vínculo criado pela administração", () => {
  const ADMIN = "80000000-0000-4000-8000-0000000000aa";

  async function criarAdmin({ platform = false, schoolId = IDS.school as string | null } = {}) {
    await db.query("insert into auth.users (id, email) values ($1, 'adm@escola.exemplo')", [ADMIN]);
    await db.query(
      "insert into profiles (id, school_id, role, nickname, avatar_id, platform_admin, onboarded_at) values ($1, $2, 'admin', 'Adm', 'estrela', $3, now())",
      [ADMIN, schoolId, platform],
    );
    if (schoolId) await db.query("insert into school_members (profile_id, school_id) values ($1, $2)", [ADMIN, schoolId]);
    return (await findActor(db, ADMIN))!;
  }

  it("vincula quem se transferiu, antes de a pessoa pisar na escola nova", async () => {
    const admin = await criarAdmin({ platform: true, schoolId: null });
    const result = await addSchoolMember(db, admin, { profileId: IDS.student, schoolId: IDS.otherSchool });
    expect(result.ok).toBe(true);

    const me = await getMe(db, (await findActor(db, IDS.student))!);
    expect(me.schools.map((s) => s.name).sort()).toEqual(["Escola de Teste", "Outra Escola"]);
  });

  it("o vínculo dá a escola, não o captador: ele continua apagado até a primeira leitura", async () => {
    const admin = await criarAdmin({ platform: true, schoolId: null });
    await addSchoolMember(db, admin, { profileId: IDS.student, schoolId: IDS.otherSchool });
    await switchSchool(db, student, IDS.otherSchool);

    const service = createCollectorService({ db, pepper: TEST_PEPPER });
    const lista = await service.listCollectors((await findActor(db, IDS.student))!);
    expect(lista).toEqual([expect.objectContaining({ code: "EC-900", verified: false })]);
  });

  it("quem não é administração não vincula ninguém", async () => {
    expect((await addSchoolMember(db, student, { profileId: IDS.student2, schoolId: IDS.otherSchool })).ok).toBe(false);
    // Nem quem é responsável por captador: isso é poder sobre o tubo, não sobre a escola.
    expect((await addSchoolMember(db, ACTORS.teacher, { profileId: IDS.student, schoolId: IDS.otherSchool })).ok).toBe(false);
  });

  it("administração de escola só mexe na própria", async () => {
    const admin = await criarAdmin();
    expect((await addSchoolMember(db, admin, { profileId: IDS.student, schoolId: IDS.otherSchool })).ok).toBe(false);
    expect((await addSchoolMember(db, admin, { profileId: IDS.otherStudent, schoolId: IDS.school })).ok).toBe(true);
  });

  it("recusa escola e pessoa inexistentes", async () => {
    const admin = await criarAdmin({ platform: true, schoolId: null });
    const inexistente = "00000000-0000-4000-8000-000000000000";
    const semEscola = await addSchoolMember(db, admin, { profileId: IDS.student, schoolId: inexistente });
    const semPessoa = await addSchoolMember(db, admin, { profileId: inexistente, schoolId: IDS.school });
    expect(semEscola.ok === false && semEscola.status).toBe(404);
    expect(semPessoa.ok === false && semPessoa.status).toBe(404);
  });

  it("vincular duas vezes não duplica", async () => {
    const admin = await criarAdmin({ platform: true, schoolId: null });
    await addSchoolMember(db, admin, { profileId: IDS.student, schoolId: IDS.otherSchool });
    await addSchoolMember(db, admin, { profileId: IDS.student, schoolId: IDS.otherSchool });
    const { rows } = await db.query("select 1 from school_members where profile_id = $1 and school_id = $2", [IDS.student, IDS.otherSchool]);
    expect(rows).toHaveLength(1);
  });
});
