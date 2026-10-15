import { describe, expect, it } from "vitest";
import { describeSilence, ESTIMATE_HORIZON_MS, hotspotRescue, offlineEstimate, type OfflineInput } from "./offline-estimate";

const HORA = 3_600_000;
/*
 * Quarta-feira, 14h em Campo Grande — escola aberta.
 *
 * A hora importa desde que a estimativa passou a contar só as horas de aula: o
 * captador enche quando o ar-condicionado está ligado. Um cenário às 3h da
 * manhã estimaria zero, e com razão.
 */
const AGORA = 1_792_000_800_000;

const base: OfflineInput = {
  lastSeenAt: AGORA - 3 * HORA,
  lastVolumeLiters: 4,
  capacityLiters: 11.8,
  learnedInflowLitersPerHour: 1.2,
  nowMs: AGORA,
};

const estimar = (patch: Partial<OfflineInput> = {}) => offlineEstimate({ ...base, ...patch });

describe("captador falando", () => {
  it("não há nada a estimar quando a leitura é de agora", () => {
    expect(estimar({ lastSeenAt: AGORA - 5_000 })).toBeNull();
  });

  it("nem quando a placa nunca falou: não se estima sobre o nada", () => {
    expect(estimar({ lastSeenAt: null })).toBeNull();
  });
});

describe("captador calado", () => {
  it("diz desde quando, e estima pela média que ele mesmo aprendeu", () => {
    const silencio = estimar()!;
    expect(silencio.offlineFor).toBe("há 3 horas");
    // 4 L medidos + 3 h × 1,2 L/h
    expect(silencio.estimatedLiters).toBe(7.6);
    expect(silencio.confidence).toBe("estimativa");
  });

  /*
   * O erro que esta regra corrige: a placa cala na sexta e alguém olha no
   * domingo. Sem contar só as horas de aula, a tela "estimava" dois dias de
   * entrada num tubo onde não caiu uma gota — e mandava alguém à escola
   * fechada resgatar água que não existe.
   */
  it("não inventa água de fim de semana: o ar-condicionado estava desligado", () => {
    const sextaDezessete = new Date("2026-10-16T21:00:00Z").getTime(); // sexta, 17h locais
    const domingoDez = new Date("2026-10-18T14:00:00Z").getTime(); // domingo, 10h locais
    const silencio = estimar({ lastSeenAt: sextaDezessete, nowMs: domingoDez })!;

    // Pelo horário padrão (7h às 17h30), só meia hora de sexta conta:
    // 4 L + 0,5 h × 1,2 L/h.
    expect(silencio.estimatedLiters).toBeCloseTo(4.6, 1);
    expect(silencio.offlineFor).toMatch(/dia/);
  });

  it("a noite entre dois dias de aula também não conta", () => {
    const quartaDezessete = new Date("2026-10-14T21:00:00Z").getTime(); // quarta, 17h locais
    const quintaNove = new Date("2026-10-15T13:00:00Z").getTime(); // quinta, 9h locais

    // Dezesseis horas de silêncio, duas e meia de aparelho ligado: meia hora de
    // quarta (até 17h30) e duas de quinta (7h às 9h). 4 L + 2,5 h × 1,2 L/h.
    const silencio = estimar({ lastSeenAt: quartaDezessete, nowMs: quintaNove })!;
    expect(silencio.estimatedLiters).toBeCloseTo(7, 1);
  });

  it("silêncio longo demais continua sendo \"não sei\", por mais contas que caibam", () => {
    // Sexta 17h até segunda 10h: 65 horas caladas. Independentemente de quantas
    // delas tinham aula, três dias sem notícia é captador com problema — e a
    // resposta honesta é mandar alguém olhar, não exibir um número.
    const sexta = new Date("2026-10-16T21:00:00Z").getTime();
    const segunda = new Date("2026-10-19T14:00:00Z").getTime();
    const silencio = estimar({ lastSeenAt: sexta, nowMs: segunda })!;
    expect(silencio.estimatedLiters).toBeNull();
    expect(silencio.confidence).toBe("sem_estimativa");
    expect(silencio.callToAction).toBe(true);
  });

  it("mantém na tela o último número REAL, com o estimado ao lado", () => {
    const silencio = estimar()!;
    expect(silencio.lastMeasuredLiters).toBe(4);
    expect(silencio.estimatedLiters).not.toBe(silencio.lastMeasuredLiters);
  });

  it("o estimado nunca passa da capacidade do tubo", () => {
    const silencio = estimar({ lastSeenAt: AGORA - 40 * HORA })!;
    expect(silencio.estimatedLiters).toBe(11.8);
  });

  it("chama alguém quando a estimativa já aponta captador cheio", () => {
    expect(estimar()!.callToAction).toBe(false);
    const quase = estimar({ lastVolumeLiters: 11, learnedInflowLitersPerHour: 0.2 })!;
    expect(quase.callToAction).toBe(true);
    expect(quase.message).toMatch(/vale ir até lá/);
  });
});

describe("os limites da honestidade", () => {
  it("sem média aprendida, não inventa número — mostra o que foi medido", () => {
    const silencio = estimar({ learnedInflowLitersPerHour: 0 })!;
    expect(silencio.estimatedLiters).toBeNull();
    expect(silencio.confidence).toBe("sem_estimativa");
    expect(silencio.message).toContain("4.0 L");
  });

  it("depois de dois dias calado, prefere dizer que não sabe", () => {
    const silencio = estimar({ lastSeenAt: AGORA - (ESTIMATE_HORIZON_MS + HORA) })!;
    expect(silencio.estimatedLiters).toBeNull();
    expect(silencio.confidence).toBe("sem_estimativa");
    // Não saber é justamente motivo para alguém ir ver.
    expect(silencio.callToAction).toBe(true);
  });

  it("o rótulo ESTIMATIVA acompanha todo resultado, e nada disso conta como impacto", () => {
    for (const silencio of [estimar()!, estimar({ learnedInflowLitersPerHour: 0 })!]) {
      expect(silencio.label).toBe("ESTIMATIVA");
      expect(silencio.countsForImpact).toBe(false);
    }
  });
});

describe("tempo em palavras de gente", () => {
  it.each([
    [30_000, "há segundos"],
    [60_000, "há 1 minuto"],
    [40 * 60_000, "há 40 minutos"],
    [HORA, "há 1 hora"],
    [5 * HORA, "há 5 horas"],
    [26 * HORA, "há 1 dia"],
    [73 * HORA, "há 3 dias"],
  ])("%i ms → %s", (ms, esperado) => {
    expect(describeSilence(ms)).toBe(esperado);
  });
});

describe("resgate pelo celular", () => {
  it("entrega os passos com o nome e a senha que a placa já conhece", () => {
    const resgate = hotspotRescue({ ssid: "EcoHorta-7KQ3", password: "horta7kq3mpx" });
    expect(resgate.steps.join(" ")).toContain("EcoHorta-7KQ3");
    expect(resgate.steps.join(" ")).toContain("horta7kq3mpx");
    expect(resgate.steps).toHaveLength(4);
  });
});
