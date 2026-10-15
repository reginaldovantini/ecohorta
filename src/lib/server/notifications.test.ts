import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import webpush from "web-push";
import { ALERT_COOLDOWN_MS, alertMessage, claimAlert, clearAlerts, removeSubscription, saveSubscription } from "./notifications";
import type { TelemetryPayload } from "@/lib/iot/api-schema";
import { createCollectorService } from "./collector-service";
import { ACTORS, createTestDatabase, IDS, makeCollectorReal, resetTestDatabase, TEST_DEVICE_TOKEN, TEST_PEPPER } from "./db/test-db";
import type { Database } from "./db/types";

/*
 * O AVISO É ÚTIL ENQUANTO É RARO.
 *
 * A telemetria chega a cada três segundos. Sem as contenções testadas aqui,
 * "o tubo está cheio" viraria um aviso a cada três segundos — e a pessoa
 * desligaria o canal no primeiro dia, perdendo também o aviso que importava.
 */

let pg: PGlite;
let db: Database;
let clock = 1_700_000_000_000;

const INSCRICAO = {
  endpoint: "https://fcm.googleapis.com/fcm/send/exemplo-de-endereco-longo-o-bastante",
  keys: { p256dh: "chave-publica-de-exemplo-com-tamanho", auth: "segredo-de-exemplo" },
};

beforeAll(async () => {
  ({ pg, db } = await createTestDatabase());
  /*
   * Chaves de verdade, geradas para este teste.
   *
   * Sem elas `pushConfigured()` é falso e o caminho inteiro desliga — inclusive
   * a marcação do aviso, que é justamente o que este arquivo prova. Nenhuma
   * mensagem sai: não há aparelho inscrito, e o envio para na lista vazia.
   */
  const chaves = webpush.generateVAPIDKeys();
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = chaves.publicKey;
  process.env.VAPID_PRIVATE_KEY = chaves.privateKey;
  process.env.VAPID_SUBJECT = "mailto:teste@ecohorta.exemplo";
}, 60_000);

beforeEach(async () => {
  await resetTestDatabase(db);
  clock = 1_700_000_000_000;
});

afterAll(async () => {
  await pg.close();
});

describe("um aparelho se inscreve", () => {
  it("guarda a inscrição e reinscrever não duplica", async () => {
    expect(await saveSubscription(db, ACTORS.student, INSCRICAO)).toMatchObject({ ok: true });
    expect(await saveSubscription(db, ACTORS.student, INSCRICAO)).toMatchObject({ ok: true });
    const { rows } = await db.query<{ n: number }>("select count(*)::int as n from public.push_subscriptions");
    expect(rows[0]!.n).toBe(1);
  });

  it("o mesmo aparelho em outra conta passa a avisar quem está usando", async () => {
    await saveSubscription(db, ACTORS.student, INSCRICAO);
    await saveSubscription(db, ACTORS.student2, INSCRICAO);
    const { rows } = await db.query<{ profile_id: string }>("select profile_id from public.push_subscriptions");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.profile_id).toBe(IDS.student2);
  });

  it("inscrição sem as chaves da criptografia é recusada", async () => {
    expect(await saveSubscription(db, ACTORS.student, { endpoint: INSCRICAO.endpoint })).toMatchObject({ ok: false, status: 422 });
    expect(await saveSubscription(db, ACTORS.student, { ...INSCRICAO, endpoint: "curto" })).toMatchObject({ ok: false, status: 422 });
  });

  it("desinscrever tira só o aparelho de quem pediu", async () => {
    await saveSubscription(db, ACTORS.student, INSCRICAO);
    expect(await removeSubscription(db, ACTORS.student2, INSCRICAO.endpoint)).toMatchObject({ ok: true });
    expect((await db.query("select 1 from public.push_subscriptions")).rows).toHaveLength(1);

    expect(await removeSubscription(db, ACTORS.student, INSCRICAO.endpoint)).toMatchObject({ ok: true });
    expect((await db.query("select 1 from public.push_subscriptions")).rows).toHaveLength(0);
  });
});

describe("o mesmo aviso não se repete", () => {
  it("o primeiro passa; o segundo, dentro do silêncio, não", async () => {
    expect(await claimAlert(db, IDS.collector, "critical", clock)).toBe(true);
    clock += 60_000;
    expect(await claimAlert(db, IDS.collector, "critical", clock)).toBe(false);
  });

  it("passado o silêncio, avisa de novo: o tubo continua cheio", async () => {
    await claimAlert(db, IDS.collector, "critical", clock);
    clock += ALERT_COOLDOWN_MS + 1000;
    expect(await claimAlert(db, IDS.collector, "critical", clock)).toBe(true);
  });

  it("atenção e crítico são avisos diferentes: um não cala o outro", async () => {
    expect(await claimAlert(db, IDS.collector, "attention", clock)).toBe(true);
    expect(await claimAlert(db, IDS.collector, "critical", clock)).toBe(true);
  });

  it("captadores diferentes avisam cada um por si", async () => {
    expect(await claimAlert(db, IDS.collector, "critical", clock)).toBe(true);
    expect(await claimAlert(db, IDS.otherCollector, "critical", clock)).toBe(true);
  });

  it("o nível voltando ao normal libera o próximo aviso na hora", async () => {
    await claimAlert(db, IDS.collector, "critical", clock);
    await clearAlerts(db, IDS.collector);
    clock += 60_000;
    // Alguém cumpriu a missão e o tubo encheu de novo: avisar outra vez é certo.
    expect(await claimAlert(db, IDS.collector, "critical", clock)).toBe(true);
  });
});

/*
 * O ELO QUE IMPORTA: o tubo enchendo chega a decidir um aviso.
 *
 * As peças acima podem estar todas certas e a telemetria nunca chamar nenhuma —
 * foi assim que a malha da válvula ficou pronta e inerte uma vez. Este teste
 * olha o caminho inteiro, do nível medido até a marca de aviso no banco.
 */
describe("o nível do tubo decide o aviso", () => {
  it("captador quase cheio marca o aviso; vazio não marca nada", async () => {
    const collectors = createCollectorService({ db, pepper: TEST_PEPPER, now: () => clock });
    await makeCollectorReal(db);
    const device = await collectors.authenticateDevice(`Bearer ${TEST_DEVICE_TOKEN}`, "VIRTUAL-001", "ECO-001");
    if (!device) throw new Error("dispositivo de teste não autenticou");

    const leitura = (litros: number, seq: number): TelemetryPayload => ({
      device_id: "VIRTUAL-001",
      collector_code: "ECO-001",
      seq,
      uptime_ms: seq * 1000,
      distance_mm: 700,
      volume_liters: litros,
      valve: "closed",
      status: "READY",
      fw_version: "esp32-0.5.0",
    });

    // Metade do tubo: nada a avisar.
    await collectors.ingestTelemetry(device, leitura(6, 1));
    expect((await db.query("select 1 from public.collector_alerts")).rows).toHaveLength(0);

    // Acima de 95% da capacidade (12 L): crítico.
    clock += 1000;
    await collectors.ingestTelemetry(device, leitura(11.6, 2));
    const { rows } = await db.query<{ kind: string }>("select kind from public.collector_alerts where collector_id = $1", [IDS.collector]);
    expect(rows[0]!.kind).toBe("critical");

    // Alguém cumpriu a missão: o tubo esvazia e a marca sai, liberando o próximo aviso.
    clock += 1000;
    await collectors.ingestTelemetry(device, leitura(5, 3));
    expect((await db.query("select 1 from public.collector_alerts")).rows).toHaveLength(0);
  });

  it("captador de SIMULAÇÃO não avisa ninguém", async () => {
    const collectors = createCollectorService({ db, pepper: TEST_PEPPER, now: () => clock });
    const device = await collectors.authenticateDevice(`Bearer ${TEST_DEVICE_TOKEN}`, "VIRTUAL-001", "ECO-001");
    if (!device) throw new Error("dispositivo de teste não autenticou");

    // O cenário padrão deixa o ECO-001 ligado ao dispositivo virtual.
    await collectors.ingestTelemetry(device, {
      device_id: "VIRTUAL-001",
      collector_code: "ECO-001",
      seq: 1,
      uptime_ms: 1000,
      distance_mm: 700,
      volume_liters: 11.8,
      valve: "closed",
      status: "READY",
      fw_version: "sim-1",
    });
    // Água simulada enchendo não tira ninguém da aula.
    expect((await db.query("select 1 from public.collector_alerts")).rows).toHaveLength(0);
  });
});

describe("o texto do aviso", () => {
  it("é curto e leva para as missões: ele é lido de relance, na tela de bloqueio", () => {
    const critico = alertMessage("critical", "ECO-001", 8.5);
    expect(critico.title.length).toBeLessThan(45);
    expect(critico.body).toContain("ECO-001");
    expect(critico.body).toContain("8,5 L");
    expect(critico.url).toBe("/missoes");
  });

  it("avisos do mesmo captador se substituem na bandeja, em vez de empilhar", () => {
    expect(alertMessage("attention", "ECO-001", 5).tag).toBe(alertMessage("critical", "ECO-001", 9).tag);
    expect(alertMessage("critical", "ECO-002", 9).tag).not.toBe(alertMessage("critical", "ECO-001", 9).tag);
  });

  it("o crítico fala em transbordar; o de atenção, em água esperando", () => {
    expect(alertMessage("critical", "ECO-001", 9).title).toMatch(/transbordar/i);
    expect(alertMessage("attention", "ECO-001", 5).title).toMatch(/esperando/i);
  });
});
