import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { grantAdmin, listGrants, revokeAdmin } from "./admin-grants";
import { findActor } from "./profile-service";
import { createTestDatabase, IDS, resetTestDatabase, ACTORS } from "./db/test-db";
import type { Actor } from "./actor";
import type { Database } from "./db/types";

let pg: PGlite;
let db: Database;
let plataforma: Actor;

const DONO = "90000000-0000-4000-8000-000000000009";
const EMAIL_DONO = "dono@ecohorta.exemplo";
const CONVIDADA = "professora@escola.exemplo";

beforeAll(async () => {
  ({ pg, db } = await createTestDatabase());
}, 60_000);

beforeEach(async () => {
  await resetTestDatabase(db);
  await db.query("insert into auth.users (id, email) values ($1, $2)", [DONO, EMAIL_DONO]);
  await db.query(
    "insert into public.profiles (id, role, nickname, avatar_id, onboarded_at) values ($1, 'teacher', 'Dono', 'estrela', now())",
    [DONO],
  );
  // A porta de entrada do sistema: configurada no servidor, não no banco.
  plataforma = (await findActor(db, DONO, EMAIL_DONO))!;
});

afterAll(async () => {
  await pg.close();
});

describe("só a administração da plataforma autoriza", () => {
  it("recusa estudante, professor e administrador de escola", async () => {
    for (const quem of [ACTORS.student, ACTORS.teacher]) {
      expect(await grantAdmin(db, quem, { email: CONVIDADA, schoolId: IDS.school })).toMatchObject({ ok: false, status: 403 });
      expect(await listGrants(db, quem)).toMatchObject({ ok: false, status: 403 });
      expect(await revokeAdmin(db, quem, CONVIDADA)).toMatchObject({ ok: false, status: 403 });
    }
    // Nem quem administra uma escola: autorizar é poder sobre a plataforma.
    const daEscola: Actor = { ...ACTORS.teacher, adminOfSchool: IDS.school };
    expect(await grantAdmin(db, daEscola, { email: CONVIDADA, schoolId: IDS.school })).toMatchObject({ ok: false, status: 403 });
  });
});

describe("autorizar", () => {
  it("registra o e-mail, a escola e quem concedeu", async () => {
    const result = await grantAdmin(db, plataforma, { email: CONVIDADA, schoolId: IDS.school, note: "coordenação" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({ email: CONVIDADA, schoolId: IDS.school, platformAdmin: false, note: "coordenação" });

    const { rows } = await db.query<{ granted_by: string }>("select granted_by from public.admin_grants where email = $1", [CONVIDADA]);
    expect(rows[0]!.granted_by).toBe(DONO);
  });

  it("normaliza o e-mail: quem digita com maiúscula não cria uma segunda autorização", async () => {
    await grantAdmin(db, plataforma, { email: " Professora@Escola.Exemplo ", schoolId: IDS.school });
    const lista = await listGrants(db, plataforma);
    if (!lista.ok) throw new Error(lista.message);
    expect(lista.value.map((g) => g.email)).toEqual([CONVIDADA]);
  });

  it("recusa e-mail inválido", async () => {
    expect(await grantAdmin(db, plataforma, { email: "não-é-email", schoolId: IDS.school })).toMatchObject({ ok: false, status: 422 });
  });

  it("recusa escola que não existe", async () => {
    const resultado = await grantAdmin(db, plataforma, {
      email: CONVIDADA,
      schoolId: "00000000-0000-4000-8000-000000000000",
    });
    expect(resultado).toMatchObject({ ok: false, status: 422 });
  });

  it("trocar a escola de alguém reaproveita a mesma linha", async () => {
    await grantAdmin(db, plataforma, { email: CONVIDADA, schoolId: IDS.school });
    await grantAdmin(db, plataforma, { email: CONVIDADA, schoolId: IDS.otherSchool });

    const lista = await listGrants(db, plataforma);
    if (!lista.ok) throw new Error(lista.message);
    expect(lista.value).toHaveLength(1);
    expect(lista.value[0]!.schoolId).toBe(IDS.otherSchool);
  });
});

describe("revogar", () => {
  it("encerra o acesso e guarda a data", async () => {
    await grantAdmin(db, plataforma, { email: CONVIDADA, schoolId: IDS.school });
    expect(await revokeAdmin(db, plataforma, CONVIDADA)).toMatchObject({ ok: true });

    const lista = await listGrants(db, plataforma);
    if (!lista.ok) throw new Error(lista.message);
    expect(lista.value[0]!.revokedAt).not.toBeNull();
  });

  it("a linha permanece: o histórico de acesso não se apaga", async () => {
    await grantAdmin(db, plataforma, { email: CONVIDADA, schoolId: IDS.school });
    await revokeAdmin(db, plataforma, CONVIDADA);
    const { rows } = await db.query<{ n: number }>("select count(*)::int as n from public.admin_grants");
    expect(rows[0]!.n).toBe(1);
  });

  it("reautorizar depois de revogar reativa a mesma linha", async () => {
    await grantAdmin(db, plataforma, { email: CONVIDADA, schoolId: IDS.school });
    await revokeAdmin(db, plataforma, CONVIDADA);
    await grantAdmin(db, plataforma, { email: CONVIDADA, schoolId: IDS.school });

    const lista = await listGrants(db, plataforma);
    if (!lista.ok) throw new Error(lista.message);
    expect(lista.value).toHaveLength(1);
    expect(lista.value[0]!.revokedAt).toBeNull();
  });

  it("recusa o que não existe ou já foi revogado", async () => {
    expect(await revokeAdmin(db, plataforma, "ninguem@exemplo.com")).toMatchObject({ ok: false, status: 404 });
    await grantAdmin(db, plataforma, { email: CONVIDADA, schoolId: IDS.school });
    await revokeAdmin(db, plataforma, CONVIDADA);
    expect(await revokeAdmin(db, plataforma, CONVIDADA)).toMatchObject({ ok: false, status: 404 });
  });

  it("não deixa o sistema sem dono: a administração da plataforma não se revoga por aqui", async () => {
    await db.query("insert into public.admin_grants (email, school_id, platform_admin) values ($1, null, true)", [EMAIL_DONO]);
    expect(await revokeAdmin(db, plataforma, EMAIL_DONO)).toMatchObject({ ok: false, status: 409 });
  });
});

describe("a lista", () => {
  it("mostra o nome da escola e põe as ativas na frente", async () => {
    await grantAdmin(db, plataforma, { email: "a@escola.exemplo", schoolId: IDS.school });
    await grantAdmin(db, plataforma, { email: CONVIDADA, schoolId: IDS.otherSchool });
    await revokeAdmin(db, plataforma, "a@escola.exemplo");

    const lista = await listGrants(db, plataforma);
    if (!lista.ok) throw new Error(lista.message);
    expect(lista.value[0]).toMatchObject({ email: CONVIDADA, revokedAt: null });
    expect(lista.value[0]!.schoolName).toBeTruthy();
    expect(lista.value[1]!.email).toBe("a@escola.exemplo");
  });
});
