import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  activateCollector,
  checkScan,
  claimStewardship,
  formatCollectorCode,
  generateStewardCode,
  hashStewardCode,
  nextCollectorSeq,
  normalizeStewardCode,
  registerCollector,
  reissueStewardCode,
  SCAN_VALIDITY_MS,
  scanCollector,
} from "./collector-registry";
import { createTestDatabase } from "./db/test-db";
import type { Database } from "./db/types";

const PEPPER = "pepper-de-teste";
const TUBO = { nominalDiameterMm: 100, nominalUsefulHeightMm: 1500, reserveLiters: 0.5 };

let pg: PGlite;
let db: Database;
let escolaA: string;
let escolaB: string;

async function criarPessoa(email: string) {
  const { rows } = await db.query<{ id: string }>("insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id", [email]);
  const id = rows[0]!.id;
  await db.query("insert into public.profiles (id, role, nickname, avatar_id) values ($1, 'student', 'Pessoa', 'cientista')", [id]);
  return id;
}

const registrar = (schoolId: string, location: string) =>
  db.transaction((tx) => registerCollector(tx, { schoolId, location, ...TUBO, createdBy: null, pepper: PEPPER }));

beforeAll(async () => {
  ({ pg, db } = await createTestDatabase());
  const a = await db.query<{ id: string }>("insert into public.schools (name) values ('Escola Alfa') returning id");
  const b = await db.query<{ id: string }>("insert into public.schools (name) values ('Escola Beta') returning id");
  escolaA = a.rows[0]!.id;
  escolaB = b.rows[0]!.id;
  // Criar o banco e aplicar as migrations passa dos 10 s padrão quando os arquivos
  // de teste rodam em paralelo — o mesmo limite usado nos demais testes de banco.
}, 60_000);

afterAll(async () => {
  await pg.close();
});

describe("código sequencial por escola", () => {
  it("numera a partir de 001 e segue em sequência", async () => {
    const primeiro = await registrar(escolaA, "Horta dos fundos");
    const segundo = await registrar(escolaA, "Pátio coberto");
    const terceiro = await registrar(escolaA, "Sala de aula 12");

    // Nascem protótipos: ECO só vem com a calibração aceita.
    expect([primeiro.code, segundo.code, terceiro.code]).toEqual(["PROTO-001", "PROTO-002", "PROTO-003"]);
    expect([primeiro.seq, segundo.seq, terceiro.seq]).toEqual([1, 2, 3]);
  });

  it("cada escola tem a própria sequência: duas escolas podem ter o PROTO-001 delas", async () => {
    const outraEscola = await registrar(escolaB, "Quadra");
    expect(outraEscola.code).toBe("PROTO-001");

    const { rows } = await db.query<{ n: number }>("select count(*)::int as n from public.collectors where code = 'PROTO-001'");
    expect(rows[0]!.n).toBe(2);
  });

  it("o banco recusa a repetição do número dentro da mesma escola", async () => {
    await expect(
      db.query("insert into public.collectors (school_id, seq, code, name, location, capacity_liters, reserve_liters) values ($1, 1, 'PROTO-009', 'x', 'y', 10, 0)", [escolaA]),
    ).rejects.toThrow();
  });

  it("a sequência não volta atrás depois de desativar um captador", async () => {
    await db.query("update public.collectors set active = false where school_id = $1 and seq = 2", [escolaA]);
    const novo = await registrar(escolaA, "Refeitório");
    expect(novo.seq).toBeGreaterThan(3);
    expect(novo.code).not.toBe("PROTO-002");
  });

  it("formata o código com três dígitos", () => {
    expect(formatCollectorCode(1)).toBe("ECO-001");
    expect(formatCollectorCode(42)).toBe("ECO-042");
    expect(formatCollectorCode(137)).toBe("ECO-137");
  });

  it("o próximo número de uma escola sem captador é 1", async () => {
    const vazia = await db.query<{ id: string }>("insert into public.schools (name) values ('Escola Gama') returning id");
    await expect(db.transaction((tx) => nextCollectorSeq(tx, vazia.rows[0]!.id))).resolves.toBe(1);
  });
});

describe("cadastro do captador", () => {
  it("usa a localização como nome quando nenhum nome é informado", async () => {
    const criado = await registrar(escolaB, "Jardim lateral");
    expect(criado.name).toBe("Jardim lateral");
    expect(criado.location).toBe("Jardim lateral");
  });

  it("estima a capacidade pela geometria do tubo, sem ninguém digitar litros", async () => {
    const criado = await registrar(escolaB, "Estufa");
    // π/4 · 100² · 1500 mm³ ≈ 11,78 L
    expect(criado.estimatedCapacityLiters).toBeCloseTo(11.781, 2);
  });

  it("nasce sem dispositivo e sem calibração: não entrega litros até ser calibrado", async () => {
    const criado = await registrar(escolaB, "Horta nova");
    const { rows } = await db.query<{ device_id: string | null; volume_source: string; volume_liters: string | null }>(
      "select device_id, volume_source, volume_liters from public.collector_state where collector_id = $1",
      [criado.id],
    );
    expect(rows[0]).toMatchObject({ device_id: null, volume_source: "none", volume_liters: null });
    const calibracoes = await db.query("select 1 from public.collector_calibrations where collector_id = $1", [criado.id]);
    expect(calibracoes.rows).toHaveLength(0);
  });

  it("recusa localização vazia e reserva maior que a capacidade", async () => {
    await expect(registrar(escolaB, " ")).rejects.toThrow(/onde o captador/i);
    await expect(
      db.transaction((tx) =>
        registerCollector(tx, { schoolId: escolaB, location: "Teste", ...TUBO, reserveLiters: 50, createdBy: null, pepper: PEPPER }),
      ),
    ).rejects.toThrow(/reserva/i);
  });

  it("guarda só o hash do código de responsável", async () => {
    const criado = await registrar(escolaB, "Depósito");
    const { rows } = await db.query<{ steward_code_hash: string; qr_token: string }>(
      "select steward_code_hash, qr_token from public.collectors where id = $1",
      [criado.id],
    );
    expect(rows[0]!.steward_code_hash).not.toContain(criado.stewardCode);
    expect(rows[0]!.steward_code_hash).toBe(hashStewardCode(criado.stewardCode, PEPPER));
    expect(rows[0]!.qr_token).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("código de responsável", () => {
  it("é legível: sem 0/O e 1/I, em três grupos de quatro", () => {
    for (let i = 0; i < 50; i++) {
      const code = generateStewardCode();
      expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
      expect(code).not.toMatch(/[01OI]/);
    }
  });

  it("aceita o código digitado com ou sem hífen, em qualquer caixa", () => {
    expect(normalizeStewardCode("h7kq3m9ptr24")).toBe("H7KQ-3M9P-TR24");
    expect(normalizeStewardCode("H7KQ-3M9P-TR24")).toBe("H7KQ-3M9P-TR24");
    expect(normalizeStewardCode("h7kq 3m9p tr24")).toBe("H7KQ-3M9P-TR24");
    expect(normalizeStewardCode("curto")).toBeNull();
    expect(normalizeStewardCode("H7KQ-3M9P-TR2O")).toBeNull(); // letra O não existe no alfabeto
  });

  it("quem digita o código certo vira responsável; quem erra, não", async () => {
    const criado = await registrar(escolaB, "Casa de máquinas");
    const pessoa = await criarPessoa("responsavel@escola.exemplo");

    const errado = await db.transaction((tx) => claimStewardship(tx, pessoa, criado.id, "AAAA-BBBB-CCCC", PEPPER));
    expect(errado).toBe(false);

    const certo = await db.transaction((tx) => claimStewardship(tx, pessoa, criado.id, criado.stewardCode.toLowerCase(), PEPPER));
    expect(certo).toBe(true);

    const { rows } = await db.query("select 1 from public.collector_stewards where collector_id = $1 and profile_id = $2", [criado.id, pessoa]);
    expect(rows).toHaveLength(1);
  });

  it("digitar duas vezes não duplica o vínculo", async () => {
    const criado = await registrar(escolaB, "Almoxarifado");
    const pessoa = await criarPessoa("duas-vezes@escola.exemplo");
    await db.transaction((tx) => claimStewardship(tx, pessoa, criado.id, criado.stewardCode, PEPPER));
    await db.transaction((tx) => claimStewardship(tx, pessoa, criado.id, criado.stewardCode, PEPPER));
    const { rows } = await db.query("select 1 from public.collector_stewards where collector_id = $1 and profile_id = $2", [criado.id, pessoa]);
    expect(rows).toHaveLength(1);
  });
});

/*
 * PERDER O PAPEL DENTRO DA CAIXA.
 *
 * Acontece: a caixa é aberta, o papel some, e meses depois alguém precisa
 * conduzir a calibração. O código não se recupera — o banco tem só o hash — e
 * essa é a propriedade que estes testes protegem. O que existe é emitir outro.
 */
describe("emitir um código de responsável novo", () => {
  it("o código novo funciona e o antigo para de funcionar", async () => {
    const criado = await registrar(escolaB, "Pátio de trás");
    const pessoa = await criarPessoa("novo-codigo@escola.exemplo");

    const novo = await db.transaction((tx) => reissueStewardCode(tx, criado.id, PEPPER));
    expect(novo).not.toBeNull();
    expect(novo).not.toBe(criado.stewardCode);

    expect(await db.transaction((tx) => claimStewardship(tx, pessoa, criado.id, criado.stewardCode, PEPPER))).toBe(false);
    expect(await db.transaction((tx) => claimStewardship(tx, pessoa, criado.id, novo!, PEPPER))).toBe(true);
  });

  it("o novo também só existe como hash", async () => {
    const criado = await registrar(escolaB, "Lateral");
    const novo = await db.transaction((tx) => reissueStewardCode(tx, criado.id, PEPPER));
    const { rows } = await db.query<{ steward_code_hash: string }>("select steward_code_hash from public.collectors where id = $1", [
      criado.id,
    ]);
    expect(rows[0]!.steward_code_hash).not.toContain(novo!);
    expect(rows[0]!.steward_code_hash).toBe(hashStewardCode(novo!, PEPPER));
  });

  it("quem já aderiu continua responsável: o vínculo não depende do código de hoje", async () => {
    const criado = await registrar(escolaB, "Quadra coberta");
    const pessoa = await criarPessoa("ja-aderiu@escola.exemplo");
    await db.transaction((tx) => claimStewardship(tx, pessoa, criado.id, criado.stewardCode, PEPPER));

    await db.transaction((tx) => reissueStewardCode(tx, criado.id, PEPPER));

    const { rows } = await db.query("select 1 from public.collector_stewards where collector_id = $1 and profile_id = $2", [
      criado.id,
      pessoa,
    ]);
    expect(rows).toHaveLength(1);
  });

  it("captador desativado não emite código nenhum", async () => {
    const criado = await registrar(escolaB, "Desativado");
    await db.query("update public.collectors set active = false where id = $1", [criado.id]);
    expect(await db.transaction((tx) => reissueStewardCode(tx, criado.id, PEPPER))).toBeNull();
  });
});

describe("leitura do QR", () => {
  it("vincula quem ainda não tem escola à escola do captador", async () => {
    const criado = await registrar(escolaA, "Horta do QR");
    const pessoa = await criarPessoa("sem-escola@escola.exemplo");

    const leitura = (await db.transaction((tx) => scanCollector(tx, pessoa, criado.qrToken)))!;
    expect(leitura.joinedSchool).toBe(true);
    expect(leitura.location).toBe("Horta do QR");

    const { rows } = await db.query<{ school_id: string }>("select school_id from public.profiles where id = $1", [pessoa]);
    expect(rows[0]!.school_id).toBe(escolaA);
  });

  it("ler o QR de outra escola ADICIONA um vínculo, sem tirar a pessoa de onde ela estava", async () => {
    const naEscolaA = await registrar(escolaA, "Tubo A");
    const naEscolaB = await registrar(escolaB, "Tubo B");
    const pessoa = await criarPessoa("duas-escolas@escola.exemplo");

    await db.transaction((tx) => scanCollector(tx, pessoa, naEscolaA.qrToken));
    const segunda = (await db.transaction((tx) => scanCollector(tx, pessoa, naEscolaB.qrToken)))!;
    expect(segunda.joinedSchool).toBe(true); // entrou em mais uma

    const vinculos = await db.query<{ school_id: string }>(
      "select school_id from public.school_members where profile_id = $1 order by joined_at", [pessoa],
    );
    expect(vinculos.rows.map((r) => r.school_id)).toEqual([escolaA, escolaB]);

    // A escola que ela está vendo continua sendo a primeira: a leitura não a muda de lugar.
    const { rows } = await db.query<{ school_id: string }>("select school_id from public.profiles where id = $1", [pessoa]);
    expect(rows[0]!.school_id).toBe(escolaA);
  });

  it("reler o QR da mesma escola não duplica o vínculo nem reconta como ingresso", async () => {
    const captador = await registrar(escolaA, "Tubo relido");
    const pessoa = await criarPessoa("relido@escola.exemplo");

    const primeira = (await db.transaction((tx) => scanCollector(tx, pessoa, captador.qrToken)))!;
    const segunda = (await db.transaction((tx) => scanCollector(tx, pessoa, captador.qrToken)))!;
    expect([primeira.joinedSchool, segunda.joinedSchool]).toEqual([true, false]);

    const { rows } = await db.query("select 1 from public.school_members where profile_id = $1", [pessoa]);
    expect(rows).toHaveLength(1);
  });

  it("guarda por qual captador a pessoa entrou na escola", async () => {
    const captador = await registrar(escolaA, "Tubo da entrada");
    const pessoa = await criarPessoa("por-qual-tubo@escola.exemplo");
    await db.transaction((tx) => scanCollector(tx, pessoa, captador.qrToken));

    const { rows } = await db.query<{ joined_via_collector: string }>(
      "select joined_via_collector from public.school_members where profile_id = $1", [pessoa],
    );
    expect(rows[0]!.joined_via_collector).toBe(captador.id);
  });

  it("registra a presença a cada leitura", async () => {
    const criado = await registrar(escolaA, "Tubo contado");
    const pessoa = await criarPessoa("contagem@escola.exemplo");
    await db.transaction((tx) => scanCollector(tx, pessoa, criado.qrToken));
    await db.transaction((tx) => scanCollector(tx, pessoa, criado.qrToken));
    const { rows } = await db.query("select 1 from public.collector_scans where collector_id = $1 and profile_id = $2", [criado.id, pessoa]);
    expect(rows).toHaveLength(2);
  });

  it("recusa token inválido, desconhecido e de captador desativado", async () => {
    const pessoa = await criarPessoa("token-ruim@escola.exemplo");
    expect(await db.transaction((tx) => scanCollector(tx, pessoa, "nao-e-token"))).toBeNull();
    expect(await db.transaction((tx) => scanCollector(tx, pessoa, "f".repeat(32)))).toBeNull();

    const desativado = await registrar(escolaA, "Tubo desativado");
    await db.query("update public.collectors set active = false where id = $1", [desativado.id]);
    expect(await db.transaction((tx) => scanCollector(tx, pessoa, desativado.qrToken))).toBeNull();
  });
});

describe("presença física: a leitura que autoriza a válvula", () => {
  /** Cria um comando de liberação amarrado a uma leitura, como a rota de missão fará. */
  const usarEmUmaMissao = (collectorId: string, profileId: string, scanId: string) =>
    db.query(
      `insert into public.device_commands (id, collector_id, requested_by, target_liters, status, is_simulated, queued_at, scan_id)
       values (gen_random_uuid(), $1, $2, 1, 'QUEUED', false, now(), $3)`,
      [collectorId, profileId, scanId],
    );

  it("aceita a leitura recente, da pessoa certa e do captador certo", async () => {
    const captador = await registrar(escolaA, "Tubo da presença");
    const pessoa = await criarPessoa("presente@escola.exemplo");
    const leitura = (await db.transaction((tx) => scanCollector(tx, pessoa, captador.qrToken)))!;

    const recusa = await db.transaction((tx) =>
      checkScan(tx, { scanId: leitura.scanId, profileId: pessoa, collectorId: captador.id, nowMs: Date.now() }),
    );
    expect(recusa).toBeNull();
  });

  it("recusa o QR de outro captador: ler o tubo A não libera o tubo B", async () => {
    const tuboA = await registrar(escolaA, "Tubo A da sala");
    const tuboB = await registrar(escolaA, "Tubo B do pátio");
    const pessoa = await criarPessoa("tubo-errado@escola.exemplo");
    const leituraA = (await db.transaction((tx) => scanCollector(tx, pessoa, tuboA.qrToken)))!;

    const recusa = await db.transaction((tx) =>
      checkScan(tx, { scanId: leituraA.scanId, profileId: pessoa, collectorId: tuboB.id, nowMs: Date.now() }),
    );
    expect(recusa).toBe("other_collector");
  });

  it("recusa a leitura de outra pessoa: ninguém usa o QR lido pelo colega", async () => {
    const captador = await registrar(escolaA, "Tubo emprestado");
    const quemLeu = await criarPessoa("quem-leu@escola.exemplo");
    const outra = await criarPessoa("outra-pessoa@escola.exemplo");
    const leitura = (await db.transaction((tx) => scanCollector(tx, quemLeu, captador.qrToken)))!;

    const recusa = await db.transaction((tx) =>
      checkScan(tx, { scanId: leitura.scanId, profileId: outra, collectorId: captador.id, nowMs: Date.now() }),
    );
    expect(recusa).toBe("other_person");
  });

  it("recusa leitura antiga: a foto do QR guardada no celular não serve depois", async () => {
    const captador = await registrar(escolaA, "Tubo do tempo");
    const pessoa = await criarPessoa("foto-antiga@escola.exemplo");
    const leitura = (await db.transaction((tx) => scanCollector(tx, pessoa, captador.qrToken)))!;

    const depois = Date.now() + SCAN_VALIDITY_MS + 1000;
    const recusa = await db.transaction((tx) =>
      checkScan(tx, { scanId: leitura.scanId, profileId: pessoa, collectorId: captador.id, nowMs: depois }),
    );
    expect(recusa).toBe("expired");
  });

  it("uma leitura autoriza UMA liberação", async () => {
    const captador = await registrar(escolaA, "Tubo de uma vez");
    const pessoa = await criarPessoa("uma-vez@escola.exemplo");
    const leitura = (await db.transaction((tx) => scanCollector(tx, pessoa, captador.qrToken)))!;

    await usarEmUmaMissao(captador.id, pessoa, leitura.scanId);

    const recusa = await db.transaction((tx) =>
      checkScan(tx, { scanId: leitura.scanId, profileId: pessoa, collectorId: captador.id, nowMs: Date.now() }),
    );
    expect(recusa).toBe("already_used");
  });

  it("o banco impede a mesma leitura em dois comandos, mesmo em duas abas ao mesmo tempo", async () => {
    const captador = await registrar(escolaA, "Tubo de duas abas");
    const pessoa = await criarPessoa("duas-abas@escola.exemplo");
    const leitura = (await db.transaction((tx) => scanCollector(tx, pessoa, captador.qrToken)))!;

    await usarEmUmaMissao(captador.id, pessoa, leitura.scanId);
    await expect(usarEmUmaMissao(captador.id, pessoa, leitura.scanId)).rejects.toThrow();
  });

  it("recusa leitura inexistente", async () => {
    const pessoa = await criarPessoa("inexistente@escola.exemplo");
    const captador = await registrar(escolaA, "Tubo fantasma");
    const recusa = await db.transaction((tx) =>
      checkScan(tx, { scanId: "00000000-0000-4000-8000-000000000000", profileId: pessoa, collectorId: captador.id, nowMs: Date.now() }),
    );
    expect(recusa).toBe("not_found");
  });
});

describe("prefixo: PROTO é obra, ECO é rede, SIM é simulação", () => {
  it("cada prefixo numera por conta própria — a simulação não ocupa o número do físico", async () => {
    const escola = (await db.query<{ id: string }>("insert into public.schools (name) values ('Escola Prefixo') returning id")).rows[0]!.id;

    const simulado = await db.transaction((tx) =>
      registerCollector(tx, { schoolId: escola, location: "Simulação", ...TUBO, prefix: "SIM", createdBy: null, pepper: PEPPER }),
    );
    const fisico = await db.transaction((tx) =>
      registerCollector(tx, { schoolId: escola, location: "Horta", ...TUBO, createdBy: null, pepper: PEPPER }),
    );

    expect(simulado.code).toBe("SIM-001");
    expect(fisico.code).toBe("PROTO-001"); // e não PROTO-002
    expect([simulado.seq, fisico.seq]).toEqual([1, 1]);
  });

  it("segue sequencial dentro de cada prefixo", async () => {
    const escola = (await db.query<{ id: string }>("insert into public.schools (name) values ('Escola Duas Faixas') returning id")).rows[0]!.id;
    const codigos: string[] = [];
    for (const prefix of ["PROTO", "PROTO", "SIM", "PROTO", "SIM"] as const) {
      const criado = await db.transaction((tx) =>
        registerCollector(tx, { schoolId: escola, location: `Local ${codigos.length}`, ...TUBO, prefix, createdBy: null, pepper: PEPPER }),
      );
      codigos.push(criado.code);
    }
    expect(codigos).toEqual(["PROTO-001", "PROTO-002", "SIM-001", "PROTO-003", "SIM-002"]);
  });

  it("formata o código com o prefixo pedido", () => {
    expect(formatCollectorCode(1)).toBe("ECO-001");
    expect(formatCollectorCode(2, "SIM")).toBe("SIM-002");
  });
});

describe("o estudante que visita outra escola", () => {
  /*
   * A regra combinada: joga na escola a que pertence, com os captadores dela.
   * Visitou outra escola e leu o QR de um captador de lá? Passa a jogar ali
   * também — sem pedir nada a ninguém, e sem deixar de pertencer à sua escola.
   */
  it("não alcança o captador da outra escola antes de ler o QR dele", async () => {
    const daVisita = await registrar(escolaB, "Horta da escola vizinha");
    const estudante = await criarPessoa("visitante@escola.exemplo");
    const doSeuColegio = await registrar(escolaA, "Horta da minha escola");
    await db.transaction((tx) => scanCollector(tx, estudante, doSeuColegio.qrToken));

    const minhas = await db.query<{ school_id: string }>("select school_id from public.school_members where profile_id = $1", [estudante]);
    expect(minhas.rows.map((r) => r.school_id)).toEqual([escolaA]);
    expect(minhas.rows.map((r) => r.school_id)).not.toContain(daVisita.id);
  });

  it("ao ler o QR durante a visita, passa a jogar lá também — e continua na própria escola", async () => {
    const daMinhaEscola = await registrar(escolaA, "Pátio da minha escola");
    const daVisita = await registrar(escolaB, "Quadra da escola visitada");
    const estudante = await criarPessoa("em-visita@escola.exemplo");

    await db.transaction((tx) => scanCollector(tx, estudante, daMinhaEscola.qrToken));
    const visita = (await db.transaction((tx) => scanCollector(tx, estudante, daVisita.qrToken)))!;

    expect(visita.joinedSchool).toBe(true);
    expect(visita.location).toBe("Quadra da escola visitada");

    const escolas = await db.query<{ school_id: string }>(
      "select school_id from public.school_members where profile_id = $1 order by joined_at", [estudante],
    );
    expect(escolas.rows.map((r) => r.school_id)).toEqual([escolaA, escolaB]);

    // E a leitura da visita autoriza a missão naquele captador, ali, naquele momento.
    const recusa = await db.transaction((tx) =>
      checkScan(tx, { scanId: visita.scanId, profileId: estudante, collectorId: visita.collectorId, nowMs: Date.now() }),
    );
    expect(recusa).toBeNull();
  });

  it("a leitura da visita não autoriza missão no captador da própria escola", async () => {
    const daMinhaEscola = await registrar(escolaA, "Horta de casa");
    const daVisita = await registrar(escolaB, "Horta visitada");
    const estudante = await criarPessoa("so-onde-esta@escola.exemplo");

    const visita = (await db.transaction((tx) => scanCollector(tx, estudante, daVisita.qrToken)))!;
    const recusa = await db.transaction((tx) =>
      checkScan(tx, { scanId: visita.scanId, profileId: estudante, collectorId: daMinhaEscola.id, nowMs: Date.now() }),
    );
    expect(recusa).toBe("other_collector");
  });
});

describe("habilitar: o captador assume o número da escola", () => {
  const habilitar = (collectorId: string) => db.transaction((tx) => activateCollector(tx, collectorId));

  it("PROTO vira ECO e guarda o código de protótipo", async () => {
    const escola = (await db.query<{ id: string }>("insert into public.schools (name) values ('Escola Habilita') returning id")).rows[0]!.id;
    const obra = await db.transaction((tx) =>
      registerCollector(tx, { schoolId: escola, location: "Horta nova", ...TUBO, createdBy: null, pepper: PEPPER }),
    );
    expect(obra.code).toBe("PROTO-001");

    const habilitado = await habilitar(obra.id);
    expect(habilitado).toMatchObject({ code: "ECO-001", previousCode: "PROTO-001", seq: 1 });

    const { rows } = await db.query<{ code: string; proto_code: string; prefix: string; activated_at: Date | null }>(
      "select code, proto_code, prefix, activated_at from public.collectors where id = $1",
      [obra.id],
    );
    // O código de protótipo fica: a placa gravada antes da calibração ainda o envia.
    expect(rows[0]).toMatchObject({ code: "ECO-001", proto_code: "PROTO-001", prefix: "ECO" });
    expect(rows[0]!.activated_at).not.toBeNull();
  });

  it("a numeração ECO é a da ordem de habilitação, não a do cadastro", async () => {
    const escola = (await db.query<{ id: string }>("insert into public.schools (name) values ('Escola Ordem') returning id")).rows[0]!.id;
    const criar = (local: string) =>
      db.transaction((tx) => registerCollector(tx, { schoolId: escola, location: local, ...TUBO, createdBy: null, pepper: PEPPER }));

    const primeiro = await criar("Tubo A");
    const segundo = await criar("Tubo B");
    const terceiro = await criar("Tubo C");
    expect([primeiro.code, segundo.code, terceiro.code]).toEqual(["PROTO-001", "PROTO-002", "PROTO-003"]);

    // O terceiro tubo foi o primeiro a ficar de pé: ele é o ECO-001 da escola.
    expect((await habilitar(terceiro.id))!.code).toBe("ECO-001");
    expect((await habilitar(primeiro.id))!.code).toBe("ECO-002");
    // O segundo nunca calibrou: segue PROTO-002, e não ocupa número de captador que mede.
    const parado = await db.query<{ code: string }>("select code from public.collectors where id = $1", [segundo.id]);
    expect(parado.rows[0]!.code).toBe("PROTO-002");
  });

  it("habilitar de novo não dá número novo — recalibrar é rotina", async () => {
    const escola = (await db.query<{ id: string }>("insert into public.schools (name) values ('Escola Recalibra') returning id")).rows[0]!.id;
    const captador = await db.transaction((tx) =>
      registerCollector(tx, { schoolId: escola, location: "Pátio", ...TUBO, createdBy: null, pepper: PEPPER }),
    );
    expect((await habilitar(captador.id))!.code).toBe("ECO-001");
    // Trocou o sensor, calibrou outra vez: continua ECO-001, inclusive no adesivo.
    expect(await habilitar(captador.id)).toBeNull();
    const { rows } = await db.query<{ code: string }>("select code from public.collectors where id = $1", [captador.id]);
    expect(rows[0]!.code).toBe("ECO-001");
  });

  it("o captador da simulação nunca entra na numeração da escola", async () => {
    const escola = (await db.query<{ id: string }>("insert into public.schools (name) values ('Escola Simula') returning id")).rows[0]!.id;
    const simulado = await db.transaction((tx) =>
      registerCollector(tx, { schoolId: escola, location: "Bancada", ...TUBO, prefix: "SIM", createdBy: null, pepper: PEPPER }),
    );
    expect(await habilitar(simulado.id)).toBeNull();
    const { rows } = await db.query<{ code: string }>("select code from public.collectors where id = $1", [simulado.id]);
    expect(rows[0]!.code).toBe("SIM-001");
  });

  it("não se cadastra um ECO direto: o número se conquista calibrando", async () => {
    const escola = (await db.query<{ id: string }>("insert into public.schools (name) values ('Escola Atalho') returning id")).rows[0]!.id;
    await expect(
      db.transaction((tx) => registerCollector(tx, { schoolId: escola, location: "Atalho", ...TUBO, prefix: "ECO", createdBy: null, pepper: PEPPER })),
    ).rejects.toThrow(/calibração/);
  });

  it("cada captador nasce com a própria rede de configuração", async () => {
    const escola = (await db.query<{ id: string }>("insert into public.schools (name) values ('Escola Rede') returning id")).rows[0]!.id;
    const criar = (local: string) =>
      db.transaction((tx) => registerCollector(tx, { schoolId: escola, location: local, ...TUBO, createdBy: null, pepper: PEPPER }));
    const um = await criar("Tubo 1");
    const dois = await criar("Tubo 2");

    expect(um.network.ssid).toMatch(/^EcoHorta-[A-Z2-9]{4}$/);
    expect(um.network.password.length).toBeGreaterThanOrEqual(8);
    expect(um.network.ssid).not.toBe(dois.network.ssid);
    // O nome da rede não carrega o código: o código muda, e a placa já estaria gravada.
    expect(um.network.ssid).not.toContain("PROTO");

    const { rows } = await db.query<{ hotspot_ssid: string; connectivity: string }>(
      "select hotspot_ssid, connectivity from public.collectors where id = $1",
      [um.id],
    );
    expect(rows[0]).toMatchObject({ hotspot_ssid: um.network.ssid, connectivity: "school_network" });
  });
});
