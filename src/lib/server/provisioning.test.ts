import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, IDS, resetTestDatabase, TEST_PEPPER } from "./db/test-db";
import type { Database } from "./db/types";
import { createCollectorService } from "./collector-service";
import { createParticipant, ensureClass, ensureCollector, ensureSchool, recordGuardianConsent, type AuthAdmin } from "./provisioning";

let db: Database;
const createdEmails: string[] = [];
const deleted: string[] = [];

/** Auth falso: grava em auth.users do banco de teste, como o Supabase faria. */
const fakeAuth: AuthAdmin = {
  async createUser({ email }) {
    const id = randomUUID();
    await db.query("insert into auth.users (id, email) values ($1, $2)", [id, email]);
    createdEmails.push(email);
    return id;
  },
  async deleteUser(userId) {
    deleted.push(userId);
    await db.query("delete from auth.users where id = $1", [userId]);
  },
};

beforeAll(async () => {
  ({ db } = await createTestDatabase());
}, 60_000);

beforeEach(async () => {
  await resetTestDatabase(db);
  createdEmails.length = 0;
  deleted.length = 0;
});

describe("provisionamento", () => {
  it("é idempotente para escola, turma e captador", async () => {
    const school = await ensureSchool(db, "Escola de Teste");
    expect(school).toBe(IDS.school);
    const classA = await ensureClass(db, school, { name: "6º Ano C", educationLevel: "elementary", grade: 6, section: "C", schoolYear: 2026 });
    expect(classA).toBe(IDS.class6c);

    const first = await ensureCollector(db, {
      schoolId: school,
      code: "ec002",
      name: "Captador 2",
      location: "Pátio",
      capacityLiters: 20,
      reserveLiters: 1,
      device: { deviceKey: "ESP32-002", isSimulated: false, token: "token-real-1", pepper: TEST_PEPPER },
    });
    const again = await ensureCollector(db, {
      schoolId: school,
      code: "EC-002",
      name: "Captador 2",
      location: "Pátio",
      capacityLiters: 20,
      reserveLiters: 1,
      device: { deviceKey: "ESP32-002", isSimulated: false, token: "token-real-2", pepper: TEST_PEPPER },
    });
    expect(again).toEqual(first);

    // O token rotacionado passa a valer; o anterior deixa de valer.
    const service = createCollectorService({ db, pepper: TEST_PEPPER });
    expect(await service.authenticateDevice("Bearer token-real-1", "ESP32-002")).toBeNull();
    expect(await service.authenticateDevice("Bearer token-real-2", "ESP32-002")).toMatchObject({ collectorCode: "EC-002", isSimulated: false });
  });

  it("cria estudante com código + PIN, sem e-mail pessoal, separando cadastro e exibição", async () => {
    const created = await createParticipant(db, fakeAuth, {
      role: "student",
      schoolId: IDS.school,
      classId: IDS.class6c,
      firstName: "Maria",
      lastName: "Oliveira",
      birthDate: "2013-05-20",
    });
    expect(created.accessCode).toMatch(/^6C-[A-Z2-9]{4}$/);
    expect(created.pin).toMatch(/^\d{6}$/);
    expect(created.email).toBe(`${created.accessCode!.toLowerCase()}@alunos.ecohorta.invalid`);

    const profile = await db.query<{ role: string; nickname: string | null; access_code: string }>(
      "select role, nickname, access_code from profiles where id = $1",
      [created.profileId],
    );
    expect(profile.rows[0]).toEqual({ role: "student", nickname: null, access_code: created.accessCode });
    const record = await db.query<{ first_name: string }>("select first_name from person_records where profile_id = $1", [created.profileId]);
    expect(record.rows[0]?.first_name).toBe("Maria");

    await recordGuardianConsent(db, { studentId: created.profileId, recordedBy: IDS.teacher, method: "termo_impresso" });
    const consent = await db.query("select 1 from guardian_consents where profile_id = $1", [created.profileId]);
    expect(consent.rows).toHaveLength(1);
  });

  it("cria professor, funcionário e administrador com e-mail e senha forte", async () => {
    const teacher = await createParticipant(db, fakeAuth, {
      role: "teacher",
      schoolId: IDS.school,
      firstName: "Carlos",
      lastName: "Mendes",
      jobTitle: "Professor de Matemática",
      email: "Carlos@Escola.Exemplo",
      password: "senha-muito-forte",
    });
    expect(teacher.email).toBe("carlos@escola.exemplo");
    expect(teacher.pin).toBeUndefined();

    await expect(
      createParticipant(db, fakeAuth, {
        role: "staff",
        schoolId: IDS.school,
        firstName: "Rita",
        lastName: "Alves",
        jobTitle: "Secretária",
        sector: "secretaria",
        email: "rita@escola.exemplo",
        password: "curta",
      }),
    ).rejects.toThrow(/10 caracteres/);
  });

  it("valida dados cadastrais e desfaz a conta do Auth se o banco recusar", async () => {
    await expect(
      createParticipant(db, fakeAuth, { role: "student", schoolId: IDS.school, classId: IDS.class6c, firstName: "Ana", lastName: "Lima", birthDate: "20/05/2013" }),
    ).rejects.toThrow(/Dados inválidos/);
    expect(createdEmails).toHaveLength(0);

    await expect(
      createParticipant(db, fakeAuth, {
        role: "student",
        schoolId: IDS.school,
        classId: IDS.class6c,
        firstName: "Ana",
        lastName: "Lima",
        birthDate: new Date(Date.now() + 86_400_000 * 10).toISOString().slice(0, 10),
      }),
    ).rejects.toThrow(/futuro/);
    expect(deleted).toHaveLength(1);
  });

  it("não permite turma de outra escola", async () => {
    await expect(
      createParticipant(db, fakeAuth, { role: "student", schoolId: IDS.school, classId: IDS.otherClass, firstName: "Ana", lastName: "Lima", birthDate: "2013-01-01" }),
    ).rejects.toThrow(/Turma não encontrada/);
  });
});
