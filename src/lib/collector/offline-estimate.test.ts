import { describe, expect, it } from "vitest";
import { describeSilence, ESTIMATE_HORIZON_MS, hotspotRescue, offlineEstimate, type OfflineInput } from "./offline-estimate";

const HORA = 3_600_000;
const AGORA = 1_760_000_000_000;

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
