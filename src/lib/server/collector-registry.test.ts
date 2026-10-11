import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  checkScan,
  claimStewardship,
  formatCollectorCode,
  generateStewardCode,
  hashStewardCode,
  nextCollectorSeq,
  normalizeStewardCode,
  registerCollector,
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

    expect([primeiro.code, segundo.code, terceiro.code]).toEqual(["EC-001", "EC-002", "EC-003"]);
    expect([primeiro.seq, segundo.seq, terceiro.seq]).toEqual([1, 2, 3]);
  });

  it("cada escola tem a própria sequência: duas escolas podem ter o EC-001 delas", async () => {
    const outraEscola = await registrar(escolaB, "Quadra");
    expect(outraEscola.code).toBe("EC-001");

    const { rows } = await db.query<{ n: number }>("select count(*)::int as n from public.collectors where code = 'EC-001'");
    expect(rows[0]!.n).toBe(2);
  });

  it("o banco recusa a repetição do número dentro da mesma escola", async () => {
    await expect(
      db.query("insert into public.collectors (school_id, seq, code, name, location, capacity_liters, reserve_liters) values ($1, 1, 'EC-009', 'x', 'y', 10, 0)", [escolaA]),
    ).rejects.toThrow();
  });

  it("a sequência não volta atrás depois de desativar um captador", async () => {
    await db.query("update public.collectors set active = false where school_id = $1 and seq = 2", [escolaA]);
    const novo = await registrar(escolaA, "Refeitório");
    expect(novo.seq).toBeGreaterThan(3);
    expect(novo.code).not.toBe("EC-002");
  });

  it("formata o código com três dígitos", () => {
    expect(formatCollectorCode(1)).toBe("EC-001");
    expect(formatCollectorCode(42)).toBe("EC-042");
    expect(formatCollectorCode(137)).toBe("EC-137");
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

  it("não troca a escola de quem já pertence a uma", async () => {
    const naEscolaA = await registrar(escolaA, "Tubo A");
    const naEscolaB = await registrar(escolaB, "Tubo B");
    const pessoa = await criarPessoa("ja-tem-escola@escola.exemplo");

    await db.transaction((tx) => scanCollector(tx, pessoa, naEscolaA.qrToken));
    const segunda = (await db.transaction((tx) => scanCollector(tx, pessoa, naEscolaB.qrToken)))!;

    expect(segunda.joinedSchool).toBe(false);
    const { rows } = await db.query<{ school_id: string }>("select school_id from public.profiles where id = $1", [pessoa]);
    expect(rows[0]!.school_id).toBe(escolaA);
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

describe("prefixo: EC é físico, SIM é simulação", () => {
  it("cada prefixo numera por conta própria — a simulação não ocupa o número do físico", async () => {
    const escola = (await db.query<{ id: string }>("insert into public.schools (name) values ('Escola Prefixo') returning id")).rows[0]!.id;

    const simulado = await db.transaction((tx) =>
      registerCollector(tx, { schoolId: escola, location: "Simulação", ...TUBO, prefix: "SIM", createdBy: null, pepper: PEPPER }),
    );
    const fisico = await db.transaction((tx) =>
      registerCollector(tx, { schoolId: escola, location: "Horta", ...TUBO, createdBy: null, pepper: PEPPER }),
    );

    expect(simulado.code).toBe("SIM-001");
    expect(fisico.code).toBe("EC-001"); // e não EC-002
    expect([simulado.seq, fisico.seq]).toEqual([1, 1]);
  });

  it("segue sequencial dentro de cada prefixo", async () => {
    const escola = (await db.query<{ id: string }>("insert into public.schools (name) values ('Escola Duas Faixas') returning id")).rows[0]!.id;
    const codigos: string[] = [];
    for (const prefix of ["EC", "EC", "SIM", "EC", "SIM"] as const) {
      const criado = await db.transaction((tx) =>
        registerCollector(tx, { schoolId: escola, location: `Local ${codigos.length}`, ...TUBO, prefix, createdBy: null, pepper: PEPPER }),
      );
      codigos.push(criado.code);
    }
    expect(codigos).toEqual(["EC-001", "EC-002", "SIM-001", "EC-003", "SIM-002"]);
  });

  it("formata o código com o prefixo pedido", () => {
    expect(formatCollectorCode(1)).toBe("EC-001");
    expect(formatCollectorCode(2, "SIM")).toBe("SIM-002");
  });
});
