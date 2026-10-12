import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { isEducator, isStewardOf, type Actor } from "./actor";
import { ACTORS, createTestDatabase, hashDeviceToken, IDS, resetTestDatabase, TEST_PEPPER } from "./db/test-db";
import type { Database } from "./db/types";
import { findActor } from "./profile-service";
import { createAdministrator, ensureDevice, ensureSchool, recordGuardianConsent, revokeGuardianConsent } from "./provisioning";

/*
 * Provisionamento no modelo de CADASTRO ABERTO.
 *
 * Pessoas não são mais criadas por script: entram pelo app e declaram a função.
 * Sobrou aqui o que exige acesso de fora: escola, dispositivo e a conta de
 * administração — a única função que ninguém pode se autoatribuir.
 */

let db: Database;

/** Supabase Auth de mentira: guarda os ids criados e permite simular falha. */
function fakeAuth() {
  const created: string[] = [];
  const removed: string[] = [];
  let nextId = 0;
  return {
    created,
    removed,
    createUser: async ({ email }: { email: string }) => {
      const id = `70000000-0000-4000-8000-00000000000${++nextId}`;
      // O Supabase Auth cria a linha em auth.users; o perfil referencia ela.
      await db.query("insert into auth.users (id, email) values ($1, $2)", [id, email]);
      created.push(id);
      return id;
    },
    deleteUser: async (id: string) => {
      removed.push(id);
    },
  };
}

beforeAll(async () => {
  ({ db } = await createTestDatabase());
}, 60_000);

beforeEach(async () => {
  await resetTestDatabase(db);
});

describe("escola", () => {
  it("cria uma vez e reaproveita no mesmo nome", async () => {
    const primeira = await ensureSchool(db, "Escola Nova");
    const segunda = await ensureSchool(db, "Escola Nova");
    expect(segunda).toBe(primeira);
  });
});

describe("conta de administração", () => {
  it("é a única pessoa criada fora do app, e nasce com o primeiro acesso concluído", async () => {
    const auth = fakeAuth();
    const criado = await createAdministrator(db, auth, {
      email: "Coordenacao@Escola.Exemplo",
      password: "senha-bem-longa-123",
      name: "Rê",
      schoolId: IDS.school,
    });

    expect(criado.email).toBe("coordenacao@escola.exemplo"); // normalizado
    const { rows } = await db.query<{ role: string; platform_admin: boolean; onboarded_at: Date | null; nickname: string }>(
      "select role, platform_admin, onboarded_at, nickname from public.profiles where id = $1",
      [criado.profileId],
    );
    expect(rows[0]).toMatchObject({ role: "admin", platform_admin: false, nickname: "Rê" });
    expect(rows[0]!.onboarded_at).not.toBeNull();
  });

  it("administração da plataforma não pertence a escola nenhuma: ela cria escolas", async () => {
    const criado = await createAdministrator(db, fakeAuth(), {
      email: "plataforma@ecohorta.exemplo",
      password: "senha-bem-longa-123",
      name: "Plataforma",
      schoolId: null,
      platformAdmin: true,
    });
    const { rows } = await db.query<{ school_id: string | null; platform_admin: boolean }>(
      "select school_id, platform_admin from public.profiles where id = $1",
      [criado.profileId],
    );
    expect(rows[0]).toEqual({ school_id: null, platform_admin: true });
  });

  it("recusa e-mail inválido, senha curta e nome vazio", async () => {
    const auth = fakeAuth();
    const base = { email: "a@b.com", password: "senha-bem-longa-123", name: "Rê", schoolId: IDS.school };
    await expect(createAdministrator(db, auth, { ...base, email: "sem-arroba" })).rejects.toThrow(/e-mail/i);
    await expect(createAdministrator(db, auth, { ...base, password: "curta" })).rejects.toThrow(/senha/i);
    await expect(createAdministrator(db, auth, { ...base, name: " " })).rejects.toThrow(/nome/i);
    expect(auth.created).toHaveLength(0); // nem chega a criar conta no Auth
  });

  it("se o banco falhar, a conta criada no Auth é removida: nunca sobra login sem perfil", async () => {
    const auth = fakeAuth();
    await expect(
      createAdministrator(db, auth, {
        email: "orfao@escola.exemplo",
        password: "senha-bem-longa-123",
        name: "Órfão",
        schoolId: "00000000-0000-4000-8000-000000000000", // escola inexistente
      }),
    ).rejects.toThrow();
    expect(auth.removed).toEqual(auth.created);
  });
});

describe("poder não vem da função declarada", () => {
  it("quem declara professor sem ser responsável não é educador", () => {
    const declarado: Actor = { profileId: IDS.student, schoolId: IDS.school, role: "teacher", platformAdmin: false, adminOfSchool: null, stewardOf: [] };
    expect(isEducator(declarado)).toBe(false);
    expect(isStewardOf(declarado, IDS.collector)).toBe(false);
  });

  it("quem é responsável por um captador é educador, mesmo declarando ser estudante", () => {
    const responsavel: Actor = { profileId: IDS.student, schoolId: IDS.school, role: "student", platformAdmin: false, adminOfSchool: null, stewardOf: [IDS.collector] };
    expect(isEducator(responsavel)).toBe(true);
    expect(isStewardOf(responsavel, IDS.collector)).toBe(true);
    expect(isStewardOf(responsavel, IDS.otherCollector)).toBe(false);
  });

  it("o ator carrega do banco os captadores sob responsabilidade", async () => {
    const professor = await findActor(db, IDS.teacher);
    expect(professor!.stewardOf).toEqual([IDS.collector]);
    expect(isEducator(professor!)).toBe(true);

    const funcionario = await findActor(db, IDS.staff);
    expect(funcionario!.stewardOf).toEqual([]);
    expect(isEducator(funcionario!)).toBe(false);
  });

  it("o cenário de teste reflete isso: staff declarado não abre porta", () => {
    expect(isEducator(ACTORS.staff)).toBe(false);
    expect(isEducator(ACTORS.teacher)).toBe(true);
  });
});

describe("dispositivo", () => {
  it("guarda só o hash do token", async () => {
    const token = "token-novo-de-tamanho-suficiente-para-o-teste";
    await ensureDevice(db, { collectorId: IDS.collector, deviceKey: "VIRTUAL-001", isSimulated: true, token, pepper: TEST_PEPPER });
    const { rows } = await db.query<{ token_hash: string }>("select token_hash from public.devices where device_key = 'VIRTUAL-001'");
    expect(rows[0]!.token_hash).toBe(hashDeviceToken(token));
    expect(rows[0]!.token_hash).not.toContain(token);
  });

  it("trocar de SIMULAÇÃO para REAL recomeça o estado e substitui a calibração ativa", async () => {
    await db.query("update public.collector_state set volume_liters = 7, volume_source = 'device', distance_mm = 800 where collector_id = $1", [IDS.collector]);

    await ensureDevice(db, {
      collectorId: IDS.collector,
      deviceKey: "ESP32-NOVO",
      isSimulated: false,
      token: "token-do-esp32-de-tamanho-suficiente",
      pepper: TEST_PEPPER,
    });

    const { rows } = await db.query<{ volume_liters: string | null; volume_source: string; distance_mm: string | null; status: string }>(
      "select volume_liters, volume_source, distance_mm, status from public.collector_state where collector_id = $1",
      [IDS.collector],
    );
    expect(rows[0]).toMatchObject({ volume_liters: null, volume_source: "none", distance_mm: null, status: "OFFLINE" });
  });
});

describe("consentimento por finalidade", () => {
  it("participar do projeto e publicar imagem são autorizações separadas", async () => {
    await recordGuardianConsent(db, { profileId: IDS.student, purpose: "participacao", recordedBy: null, method: "termo_impresso" });
    const { rows } = await db.query<{ purpose: string }>("select purpose from public.guardian_consents where profile_id = $1", [IDS.student]);
    expect(rows.map((r) => r.purpose)).toEqual(["participacao"]);

    await recordGuardianConsent(db, { profileId: IDS.student, purpose: "uso_de_imagem", recordedBy: IDS.teacher, method: "termo_digital" });
    const dois = await db.query<{ purpose: string }>("select purpose from public.guardian_consents where profile_id = $1 order by purpose", [IDS.student]);
    expect(dois.rows.map((r) => r.purpose)).toEqual(["participacao", "uso_de_imagem"]);
  });

  it("retirar o consentimento de imagem não derruba o de participação", async () => {
    await recordGuardianConsent(db, { profileId: IDS.student, purpose: "participacao", recordedBy: null, method: "termo_impresso" });
    await recordGuardianConsent(db, { profileId: IDS.student, purpose: "uso_de_imagem", recordedBy: null, method: "termo_impresso" });
    await revokeGuardianConsent(db, IDS.student, "uso_de_imagem");

    const { rows } = await db.query<{ purpose: string; revoked_at: Date | null }>(
      "select purpose, revoked_at from public.guardian_consents where profile_id = $1 order by purpose",
      [IDS.student],
    );
    expect(rows[0]).toMatchObject({ purpose: "participacao", revoked_at: null });
    expect(rows[1]!.revoked_at).not.toBeNull();
  });

  it("a linha fica depois de retirada: o histórico de que houve autorização não se apaga", async () => {
    await recordGuardianConsent(db, { profileId: IDS.student, purpose: "uso_de_imagem", recordedBy: null, method: "termo_impresso" });
    await revokeGuardianConsent(db, IDS.student, "uso_de_imagem");
    const { rows } = await db.query("select 1 from public.guardian_consents where profile_id = $1 and purpose = 'uso_de_imagem'", [IDS.student]);
    expect(rows).toHaveLength(1);
  });
});
