import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createCollectorSetupService } from "./collector-setup-service";
import { registerCollector } from "./collector-registry";
import { listSchools, registerSchool } from "./school-registry";
import { createTestDatabase } from "./db/test-db";
import type { Actor } from "./actor";
import type { Database } from "./db/types";

const PEPPER = "pepper-de-teste-com-32-caracteres!!";
const TUBO = { nominalDiameterMm: 100, nominalUsefulHeightMm: 1500, reserveLiters: 0.5 };

let pg: PGlite;
let db: Database;
let escola: string;
let service: ReturnType<typeof createCollectorSetupService>;

const admin: Actor = { profileId: "", schoolId: null, role: "admin", platformAdmin: true, adminOfSchool: null, stewardOf: [] };
const estudante: Actor = { profileId: "", schoolId: null, role: "student", platformAdmin: false, adminOfSchool: null, stewardOf: [] };

async function criarPessoa(email: string, role: "admin" | "student") {
  const { rows } = await db.query<{ id: string }>("insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id", [email]);
  const id = rows[0]!.id;
  await db.query("insert into public.profiles (id, role, nickname, avatar_id) values ($1, $2, 'Pessoa', 'cientista')", [id, role]);
  return id;
}

const cadastrar = (location: string) =>
  db.transaction((tx) => registerCollector(tx, { schoolId: escola, location, ...TUBO, createdBy: null, pepper: PEPPER }));

/** O ESP32 falou: é o fato que cumpre a etapa de conexão. */
const placaFalou = (collectorId: string) =>
  db.query("update public.collector_state set last_seen_at = now(), status = 'MAINTENANCE' where collector_id = $1", [collectorId]);

beforeAll(async () => {
  ({ pg, db } = await createTestDatabase());
  const { rows } = await db.query<{ id: string }>(
    "insert into public.schools (name, city, state) values ('EE Prof.ª Clarinda', 'Três Lagoas', 'MS') returning id",
  );
  escola = rows[0]!.id;
  admin.profileId = await criarPessoa("admin@escola.exemplo", "admin");
  estudante.profileId = await criarPessoa("estudante@escola.exemplo", "student");
  service = createCollectorSetupService({ db });
}, 60_000);

afterAll(async () => {
  await pg.close();
});

describe("o que eu faço agora", () => {
  it("recém-cadastrado, a vez é da montagem — e a escola aparece com município e estado", async () => {
    const captador = await cadastrar("Horta dos fundos");
    const resultado = await service.journey(admin, captador.code);
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;

    expect(resultado.value.code).toBe(captador.code);
    expect(resultado.value.journey.currentStep).toBe("montagem");
    expect(resultado.value.journey.completed).toBe(1);
    expect(resultado.value.nextAction).toBe("Baixar o manual e montar o captador");
    expect(resultado.value.school).toMatchObject({ name: "EE Prof.ª Clarinda", city: "Três Lagoas", state: "MS" });
  });

  it("mostra a rede do captador: é o que o app pede ao estudante no resgate", async () => {
    const captador = await cadastrar("Pátio coberto");
    const resultado = await service.journey(admin, captador.code);
    if (!resultado.ok) throw new Error(resultado.message);
    expect(resultado.value.network).toEqual(captador.network);
    expect(resultado.value.connectivity).toBe("school_network");
  });

  it("diz honestamente quando o material fixo ainda não existe", async () => {
    const captador = await cadastrar("Quadra");
    const resultado = await service.journey(admin, captador.code);
    if (!resultado.ok) throw new Error(resultado.message);
    const artes = resultado.value.resources.find((item) => item.id === "artes")!;
    // A pasta de materiais está vazia neste repositório: nada de link quebrado.
    expect(artes.href).toBeNull();
    expect(artes.pending).toMatch(/preparação/);
  });

  it("captador que não existe não vira jornada", async () => {
    const resultado = await service.journey(admin, "PROTO-404");
    expect(resultado).toMatchObject({ ok: false, status: 404 });
  });

  it("não é área de estudante, mesmo logado", async () => {
    const captador = await cadastrar("Sala 12");
    expect(await service.journey(estudante, captador.code)).toMatchObject({ ok: false, status: 403 });
  });
});

describe("marcar o que a plataforma não tem como ver", () => {
  it("montagem e identificação se marcam à mão, e a vez anda", async () => {
    const captador = await cadastrar("Jardim lateral");
    const montado = await service.markStep(admin, captador.code, "montagem", true);
    if (!montado.ok) throw new Error(montado.message);
    expect(montado.value.journey.currentStep).toBe("identificacao");

    const personalizado = await service.markStep(admin, captador.code, "identificacao", true);
    if (!personalizado.ok) throw new Error(personalizado.message);
    expect(personalizado.value.journey.currentStep).toBe("firmware");
  });

  it("desmarcar devolve a etapa: quem errou o botão não fica preso", async () => {
    const captador = await cadastrar("Corredor");
    await service.markStep(admin, captador.code, "montagem", true);
    const desfeito = await service.markStep(admin, captador.code, "montagem", false);
    if (!desfeito.ok) throw new Error(desfeito.message);
    expect(desfeito.value.journey.currentStep).toBe("montagem");
  });

  it("calibração não se marca: ela vem da medição", async () => {
    const captador = await cadastrar("Depósito");
    const recusa = await service.markStep(admin, captador.code, "calibracao", true);
    expect(recusa).toMatchObject({ ok: false, status: 422 });
  });

  it("conexão não se marca: ou a placa falou, ou não falou", async () => {
    const captador = await cadastrar("Telhado");
    expect(await service.markStep(admin, captador.code, "conexao", true)).toMatchObject({ ok: false, status: 422 });
  });

  it("registra quem marcou — numa escola, isso é quem responde pelo captador", async () => {
    const captador = await cadastrar("Estufa");
    await service.markStep(admin, captador.code, "montagem", true);
    const { rows } = await db.query<{ marked_by: string }>(
      "select marked_by from public.collector_setup_marks where collector_id = $1 and step = 'montagem'",
      [captador.id],
    );
    expect(rows[0]!.marked_by).toBe(admin.profileId);
  });
});

describe("o programa do ESP32", () => {
  const gerar = (code: string, confirmReplacement?: boolean) =>
    service.issueFirmware(admin, code, { apiBaseUrl: "https://ecohorta.exemplo/", pepper: PEPPER, confirmReplacement });

  it("sai pronto para aquele captador, com a rede dele dentro", async () => {
    const captador = await cadastrar("Lateral do bloco B");
    const pacote = await gerar(captador.code);
    if (!pacote.ok) throw new Error(pacote.message);

    expect(pacote.value.fileName).toBe("secrets.h");
    expect(pacote.value.content).toContain(`#define COLLECTOR_CODE "${captador.code}"`);
    expect(pacote.value.content).toContain(`#define SETUP_AP_SSID "${captador.network.ssid}"`);
    // Barra final removida: a URL é concatenada com a rota no firmware.
    expect(pacote.value.content).toContain('#define API_BASE_URL "https://ecohorta.exemplo"');
    expect(pacote.value.guide.length).toBeGreaterThan(5);
  });

  it("registra a placa — e é esse fato que cumpre a etapa do firmware", async () => {
    const captador = await cadastrar("Bloco C");
    const pacote = await gerar(captador.code);
    if (!pacote.ok) throw new Error(pacote.message);

    const { rows } = await db.query<{ device_key: string; is_simulated: boolean }>(
      "select device_key, is_simulated from public.devices where collector_id = $1 and active",
      [captador.id],
    );
    expect(rows[0]).toMatchObject({ device_key: pacote.value.identity.deviceKey, is_simulated: false });

    await service.markStep(admin, captador.code, "montagem", true);
    await service.markStep(admin, captador.code, "identificacao", true);
    const depois = await service.journey(admin, captador.code);
    if (!depois.ok) throw new Error(depois.message);
    expect(depois.value.journey.steps.find((step) => step.id === "firmware")!.state).toBe("done");
    expect(depois.value.journey.currentStep).toBe("conexao");
  });

  it("o token só existe nesta resposta: o banco guarda o hash", async () => {
    const captador = await cadastrar("Bloco D");
    const pacote = await gerar(captador.code);
    if (!pacote.ok) throw new Error(pacote.message);
    const { rows } = await db.query<{ token_hash: string }>("select token_hash from public.devices where collector_id = $1", [captador.id]);
    expect(rows[0]!.token_hash).not.toContain(pacote.value.identity.deviceToken);
  });

  it("com placa já enviando dados, exige confirmação antes de calar o captador", async () => {
    const captador = await cadastrar("Bloco E");
    await gerar(captador.code);
    await placaFalou(captador.id);

    const semAviso = await gerar(captador.code);
    expect(semAviso).toMatchObject({ ok: false, status: 409 });
    if (!semAviso.ok) expect(semAviso.message).toMatch(/parar até ser regravada/);

    const confirmado = await gerar(captador.code, true);
    expect(confirmado.ok).toBe(true);
    if (confirmado.ok) expect(confirmado.value.replacedPreviousDevice).toBe(true);
  });

  it("a placa que fala cumpre firmware e conexão juntos", async () => {
    const captador = await cadastrar("Bloco F");
    await service.markStep(admin, captador.code, "montagem", true);
    await service.markStep(admin, captador.code, "identificacao", true);
    await placaFalou(captador.id);

    const resultado = await service.journey(admin, captador.code);
    if (!resultado.ok) throw new Error(resultado.message);
    expect(resultado.value.journey.currentStep).toBe("calibracao");
    expect(resultado.value.journey.completed).toBe(5);
    expect(resultado.value.lastSeenAt).not.toBeNull();
    // Ainda não é captador da rede: falta medir.
    expect(resultado.value.journey.live).toBe(false);
    expect(resultado.value.protoCode).toBeNull();
  });

  it("não é estudante que gera o programa de um captador", async () => {
    const captador = await cadastrar("Bloco G");
    const recusa = await service.issueFirmware(estudante, captador.code, { apiBaseUrl: "https://x.exemplo", pepper: PEPPER });
    expect(recusa).toMatchObject({ ok: false, status: 403 });
  });
});

/*
 * A escola é cadastrada junto do primeiro captador dela, então estes testes vivem
 * aqui: aproveitam o mesmo banco e a mesma escola da jornada, em vez de pagar
 * outra inicialização de PostgreSQL só para contar duas colunas.
 */
describe("escolas da rede", () => {
  it("conta captadores que medem e protótipos separadamente", async () => {
    const lista = await listSchools(db);
    const clarinda = lista.find((item) => item.name === "EE Prof.ª Clarinda")!;
    expect(clarinda).toMatchObject({ city: "Três Lagoas", state: "MS" });
    // Nada foi calibrado neste arquivo de teste: é tudo obra.
    expect(clarinda.activeCollectors).toBe(0);
    expect(clarinda.prototypes).toBeGreaterThan(0);
  });

  it("cadastrar a mesma escola de novo completa município e estado, sem duplicar", async () => {
    const nova = await db.transaction((tx) => registerSchool(tx, { name: "EE Nova Esperança", city: "Campo Grande", state: "MS" }));
    const mesma = await db.transaction((tx) => registerSchool(tx, { name: "EE Nova Esperança", city: "Campo Grande", state: "MS" }));
    expect(mesma.id).toBe(nova.id);
  });

  it("recusa estado que não é sigla de unidade federativa", async () => {
    await expect(
      db.transaction((tx) => registerSchool(tx, { name: "EE Fora do Mapa", city: "Lisboa", state: "XX" as never })),
    ).rejects.toThrow(/estado/);
  });
});
