import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { administersSchool, isAdministrator, isPlatformAdmin, isStewardOf } from "./actor";
import { findActor } from "./profile-service";
import { createTestDatabase, IDS, resetTestDatabase } from "./db/test-db";
import type { Database } from "./db/types";

/*
 * QUEM PODE ADMINISTRAR — e por que a função declarada não entra nessa conta.
 *
 * Com cadastro aberto pelo Google, qualquer pessoa marca "Professor(a)" no
 * primeiro acesso. Se isso desse acesso à administração, qualquer pessoa
 * cadastraria captador — e cadastrar captador é o ato que coloca um tubo na
 * rede de uma escola.
 *
 * Então a autoridade vem de uma autorização explícita, por e-mail, dada pelo
 * administrador da plataforma. Estes testes são a cerca: cada um deles
 * descreve uma porta que precisa continuar fechada.
 */

let pg: PGlite;
let db: Database;

const EMAIL = "professora@escola.exemplo";

/** Cria a conta e o perfil de alguém que declarou ser professor(a). */
async function criarPessoa(id: string, email: string, role = "teacher") {
  await db.query("insert into auth.users (id, email) values ($1, $2)", [id, email]);
  // O banco exige ano/série de quem é estudante — e faz bem.
  await db.query(
    `insert into public.profiles (id, school_id, role, nickname, avatar_id, grade_phase, onboarded_at)
     values ($1, $2, $3, 'Alguém', 'cientista', $4, now())`,
    [id, IDS.school, role, role === "student" ? "ano_9" : null],
  );
}

const autorizar = (email: string, schoolId: string | null, platform = false) =>
  db.query("insert into public.admin_grants (email, school_id, platform_admin) values ($1, $2, $3)", [email, schoolId, platform]);

const PESSOA = "90000000-0000-4000-8000-000000000001";

beforeAll(async () => {
  ({ pg, db } = await createTestDatabase());
}, 60_000);

beforeEach(async () => {
  await resetTestDatabase(db);
});

afterAll(async () => {
  await pg.close();
});

describe("a função declarada não dá poder", () => {
  it("quem se declara professor(a) e não foi autorizado não administra nada", async () => {
    await criarPessoa(PESSOA, EMAIL, "teacher");
    const actor = (await findActor(db, PESSOA))!;

    expect(actor.adminOfSchool).toBeNull();
    expect(isAdministrator(actor)).toBe(false);
    expect(administersSchool(actor, IDS.school)).toBe(false);
  });

  it("nem quem tem 'admin' gravado no perfil, sem autorização", async () => {
    await criarPessoa(PESSOA, EMAIL, "admin");
    const actor = (await findActor(db, PESSOA))!;
    expect(isAdministrator(actor)).toBe(false);
  });
});

describe("a autorização por e-mail", () => {
  it("transforma a pessoa em administradora daquela escola", async () => {
    await criarPessoa(PESSOA, EMAIL, "teacher");
    await autorizar(EMAIL, IDS.school);

    const actor = (await findActor(db, PESSOA))!;
    expect(actor.adminOfSchool).toBe(IDS.school);
    expect(isAdministrator(actor)).toBe(true);
    expect(administersSchool(actor, IDS.school)).toBe(true);
  });

  it("vale mesmo para quem se declarou estudante: quem decide é quem autoriza", async () => {
    await criarPessoa(PESSOA, EMAIL, "student");
    await autorizar(EMAIL, IDS.school);
    expect(isAdministrator((await findActor(db, PESSOA))!)).toBe(true);
  });

  it("existe ANTES de a pessoa entrar pela primeira vez", async () => {
    // Autoriza o e-mail de quem ainda não tem conta…
    await autorizar(EMAIL, IDS.school);
    // …e, quando a conta nasce, ela já chega administradora.
    await criarPessoa(PESSOA, EMAIL, "teacher");
    expect(isAdministrator((await findActor(db, PESSOA))!)).toBe(true);
  });

  it("não alcança o e-mail parecido de outra pessoa", async () => {
    await criarPessoa(PESSOA, "professora2@escola.exemplo", "teacher");
    await autorizar(EMAIL, IDS.school);
    expect(isAdministrator((await findActor(db, PESSOA))!)).toBe(false);
  });
});

describe("cada administração fica na sua escola", () => {
  it("quem administra uma escola não alcança a outra", async () => {
    await criarPessoa(PESSOA, EMAIL, "teacher");
    await autorizar(EMAIL, IDS.school);
    const actor = (await findActor(db, PESSOA))!;

    expect(administersSchool(actor, IDS.school)).toBe(true);
    expect(administersSchool(actor, IDS.otherSchool)).toBe(false);
  });

  it("e não conduz o captador da outra escola", async () => {
    await criarPessoa(PESSOA, EMAIL, "teacher");
    await autorizar(EMAIL, IDS.school);
    const actor = (await findActor(db, PESSOA))!;

    expect(isStewardOf(actor, IDS.collector, IDS.school)).toBe(true);
    expect(isStewardOf(actor, IDS.otherCollector, IDS.otherSchool)).toBe(false);
  });

  it("a administração da plataforma atravessa as duas", async () => {
    await criarPessoa(PESSOA, EMAIL, "teacher");
    await autorizar(EMAIL, null, true);
    const actor = (await findActor(db, PESSOA))!;

    expect(isPlatformAdmin(actor)).toBe(true);
    expect(administersSchool(actor, IDS.school)).toBe(true);
    expect(administersSchool(actor, IDS.otherSchool)).toBe(true);
    expect(isStewardOf(actor, IDS.otherCollector, IDS.otherSchool)).toBe(true);
  });
});

describe("revogar", () => {
  it("tira o poder na requisição seguinte, sem mexer no perfil", async () => {
    await criarPessoa(PESSOA, EMAIL, "teacher");
    await autorizar(EMAIL, IDS.school);
    expect(isAdministrator((await findActor(db, PESSOA))!)).toBe(true);

    await db.query("update public.admin_grants set revoked_at = now() where email = $1", [EMAIL]);

    // Nada foi desfeito no perfil: a autoridade nunca esteve gravada lá.
    expect(isAdministrator((await findActor(db, PESSOA))!)).toBe(false);
    const { rows } = await db.query<{ role: string }>("select role from public.profiles where id = $1", [PESSOA]);
    expect(rows[0]!.role).toBe("teacher");
  });

  it("a linha permanece: o histórico de quem teve acesso não se apaga", async () => {
    await autorizar(EMAIL, IDS.school);
    await db.query("update public.admin_grants set revoked_at = now() where email = $1", [EMAIL]);
    const { rows } = await db.query<{ n: number }>("select count(*)::int as n from public.admin_grants where email = $1", [EMAIL]);
    expect(rows[0]!.n).toBe(1);
  });
});

describe("a porta de entrada do sistema", () => {
  it("o e-mail configurado no servidor é administração da plataforma, sem linha no banco", async () => {
    await criarPessoa(PESSOA, EMAIL, "student");
    const actor = (await findActor(db, PESSOA, EMAIL))!;
    expect(isPlatformAdmin(actor)).toBe(true);
  });

  it("sem a configuração, ninguém entra por essa porta", async () => {
    await criarPessoa(PESSOA, EMAIL, "student");
    expect(isPlatformAdmin((await findActor(db, PESSOA, undefined))!)).toBe(false);
    expect(isPlatformAdmin((await findActor(db, PESSOA, "outro@exemplo.com"))!)).toBe(false);
  });
});

describe("o banco protege as próprias regras", () => {
  it("administração de plataforma não tem escola; de escola exige uma", async () => {
    await expect(autorizar(EMAIL, IDS.school, true)).rejects.toThrow();
    await expect(autorizar(EMAIL, null, false)).rejects.toThrow();
  });

  it("recusa e-mail com maiúscula ou espaço: a busca é por minúsculas", async () => {
    await expect(autorizar("Professora@Escola.Exemplo", IDS.school)).rejects.toThrow();
    await expect(autorizar(" professora@escola.exemplo ", IDS.school)).rejects.toThrow();
  });

  it("o mesmo e-mail não é autorizado duas vezes", async () => {
    await autorizar(EMAIL, IDS.school);
    await expect(autorizar(EMAIL, IDS.otherSchool)).rejects.toThrow();
  });
});
