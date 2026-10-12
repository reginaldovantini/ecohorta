import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { approvePartnership, declinePartnership, listPartnershipRequests, requestPartnership } from "./partnership-service";
import { findActor } from "./profile-service";
import { isAdministrator, type Actor } from "./actor";
import { ACTORS, createTestDatabase, resetTestDatabase } from "./db/test-db";
import type { Database } from "./db/types";

let pg: PGlite;
let db: Database;
let plataforma: Actor;

const DONO = "90000000-0000-4000-8000-00000000000a";
const EMAIL_DONO = "dono@ecohorta.exemplo";
const VAZIO = "00000000-0000-4000-8000-000000000000";

const PEDIDO = {
  name: "Professora Ana",
  email: "ana@escola.exemplo",
  jobTitle: "Coordenadora de Ciências",
  schoolName: "EE Monteiro Lobato",
  city: "Campo Grande",
  state: "MS",
  message: "Temos cinco aparelhos de ar-condicionado e uma horta começando.",
};

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
  plataforma = (await findActor(db, DONO, EMAIL_DONO))!;
});

afterAll(async () => {
  await pg.close();
});

async function pedirEObterId() {
  await requestPartnership(db, PEDIDO);
  const lista = await listPartnershipRequests(db, plataforma);
  if (!lista.ok) throw new Error(lista.message);
  return lista.value[0]!.id;
}

describe("candidatar-se", () => {
  it("qualquer pessoa pode: quem preenche ainda não tem conta", async () => {
    expect((await requestPartnership(db, PEDIDO)).ok).toBe(true);
  });

  it("normaliza o e-mail e a sigla do estado", async () => {
    await requestPartnership(db, { ...PEDIDO, email: " Ana@Escola.Exemplo ", state: "ms" });
    const lista = await listPartnershipRequests(db, plataforma);
    if (!lista.ok) throw new Error(lista.message);
    expect(lista.value[0]).toMatchObject({ email: "ana@escola.exemplo", state: "MS" });
  });

  it("recusa dados incompletos antes de tocar no banco", async () => {
    expect(await requestPartnership(db, { ...PEDIDO, email: "sem-arroba" })).toMatchObject({ ok: false, status: 422 });
    expect(await requestPartnership(db, { ...PEDIDO, state: "XX" })).toMatchObject({ ok: false, status: 422 });
    expect(await requestPartnership(db, { ...PEDIDO, schoolName: "EE" })).toMatchObject({ ok: false, status: 422 });
  });

  it("um pedido em aberto por e-mail", async () => {
    await requestPartnership(db, PEDIDO);
    expect(await requestPartnership(db, PEDIDO)).toMatchObject({ ok: false, status: 409 });
  });

  it("depois de respondido, a mesma pessoa pode se candidatar de novo", async () => {
    await declinePartnership(db, plataforma, await pedirEObterId());
    expect((await requestPartnership(db, PEDIDO)).ok).toBe(true);
  });
});

describe("a mesa de controle", () => {
  it("só a administração da plataforma vê e responde", async () => {
    await requestPartnership(db, PEDIDO);
    expect(await listPartnershipRequests(db, ACTORS.teacher)).toMatchObject({ ok: false, status: 403 });
    expect(await approvePartnership(db, ACTORS.teacher, VAZIO)).toMatchObject({ ok: false, status: 403 });
    expect(await declinePartnership(db, ACTORS.teacher, VAZIO)).toMatchObject({ ok: false, status: 403 });
  });

  it("pendentes aparecem primeiro", async () => {
    await declinePartnership(db, plataforma, await pedirEObterId());
    await requestPartnership(db, { ...PEDIDO, email: "bruno@escola.exemplo" });

    const lista = await listPartnershipRequests(db, plataforma);
    if (!lista.ok) throw new Error(lista.message);
    expect(lista.value[0]!.status).toBe("pending");
    expect(lista.value[1]!.status).toBe("declined");
  });
});

describe("aprovar fecha o ciclo num toque", () => {
  it("cria a escola com município e estado", async () => {
    expect((await approvePartnership(db, plataforma, await pedirEObterId())).ok).toBe(true);
    const { rows } = await db.query<{ city: string; state: string }>("select city, state from public.schools where name = $1", [
      PEDIDO.schoolName,
    ]);
    expect(rows[0]).toMatchObject({ city: "Campo Grande", state: "MS" });
  });

  it("autoriza o e-mail a administrar justamente aquela escola", async () => {
    await approvePartnership(db, plataforma, await pedirEObterId());
    const { rows } = await db.query<{ school_id: string; revoked_at: Date | null }>(
      "select school_id, revoked_at from public.admin_grants where email = $1",
      [PEDIDO.email],
    );
    expect(rows[0]!.revoked_at).toBeNull();

    // E a pessoa, quando entrar, já chega administradora dessa escola.
    const PESSOA = "90000000-0000-4000-8000-00000000000b";
    await db.query("insert into auth.users (id, email) values ($1, $2)", [PESSOA, PEDIDO.email]);
    await db.query(
      "insert into public.profiles (id, role, nickname, avatar_id, onboarded_at) values ($1, 'teacher', 'Ana', 'folha', now())",
      [PESSOA],
    );
    const actor = (await findActor(db, PESSOA))!;
    expect(isAdministrator(actor)).toBe(true);
    expect(actor.adminOfSchool).toBe(rows[0]!.school_id);
  });

  it("marca o pedido e guarda a escola que ele virou", async () => {
    const result = await approvePartnership(db, plataforma, await pedirEObterId());
    if (!result.ok) throw new Error(result.message);
    expect(result.value).toMatchObject({ status: "approved" });
    expect(result.value.schoolId).not.toBeNull();
    expect(result.value.handledAt).not.toBeNull();
  });

  it("não aprova duas vezes", async () => {
    const id = await pedirEObterId();
    await approvePartnership(db, plataforma, id);
    expect(await approvePartnership(db, plataforma, id)).toMatchObject({ ok: false, status: 404 });
  });

  it("escola que já existe é reaproveitada, e ganha o município que faltava", async () => {
    await db.query("insert into public.schools (name) values ($1)", [PEDIDO.schoolName]);
    await approvePartnership(db, plataforma, await pedirEObterId());

    const total = await db.query<{ n: number }>("select count(*)::int as n from public.schools where name = $1", [PEDIDO.schoolName]);
    expect(total.rows[0]!.n).toBe(1);
    const escola = await db.query<{ city: string }>("select city from public.schools where name = $1", [PEDIDO.schoolName]);
    expect(escola.rows[0]!.city).toBe("Campo Grande");
  });
});

describe("recusar", () => {
  it("responde o pedido e preserva a linha", async () => {
    expect((await declinePartnership(db, plataforma, await pedirEObterId())).ok).toBe(true);
    const { rows } = await db.query<{ n: number }>("select count(*)::int as n from public.partnership_requests");
    expect(rows[0]!.n).toBe(1);
  });

  it("recusar não cria escola nem autorização", async () => {
    await declinePartnership(db, plataforma, await pedirEObterId());
    const escolas = await db.query<{ n: number }>("select count(*)::int as n from public.schools where name = $1", [PEDIDO.schoolName]);
    const grants = await db.query<{ n: number }>("select count(*)::int as n from public.admin_grants where email = $1", [PEDIDO.email]);
    expect(escolas.rows[0]!.n).toBe(0);
    expect(grants.rows[0]!.n).toBe(0);
  });
});
