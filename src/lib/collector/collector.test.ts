import { describe, expect, it } from "vitest";
import { getCollectorAlert } from "./alerts";
import { fillRatio, getLevelState } from "./level-state";
import { availableLiters, reuseRate } from "./water";

describe("getLevelState", () => {
  it.each([
    [0, "low"],
    [0.3, "low"],
    [0.304, "low"],
    [0.306, "available"],
    [0.7, "available"],
    [0.71, "good"],
    [0.85, "good"],
    [0.86, "attention"],
    [0.95, "attention"],
    [0.96, "critical"],
    [1, "critical"],
    [1.2, "critical"],
  ])("ratio %d → %s", (ratio, expected) => {
    expect(getLevelState(ratio).id).toBe(expected);
  });

  it("marca urgência apenas em atenção e crítico", () => {
    expect(getLevelState(0.8).urgency).toBe("normal");
    expect(getLevelState(0.9).urgency).toBe("attention");
    expect(getLevelState(0.99).urgency).toBe("critical");
  });
});

describe("fillRatio", () => {
  it("limita entre 0 e 1 e protege capacidade inválida", () => {
    expect(fillRatio(6, 12)).toBe(0.5);
    expect(fillRatio(-1, 12)).toBe(0);
    expect(fillRatio(20, 12)).toBe(1);
    expect(fillRatio(5, 0)).toBe(0);
  });
});

describe("getCollectorAlert", () => {
  const base = { collectorCode: "EC-001", trend: "stable" as const, overflowing: false };

  it("prioriza transbordamento sobre qualquer outro estado", () => {
    expect(getCollectorAlert({ ...base, ratio: 1, overflowing: true })?.kind).toBe("overflow");
  });

  it("gera alerta crítico com o percentual", () => {
    const alert = getCollectorAlert({ ...base, ratio: 0.96 });
    expect(alert?.kind).toBe("critical");
    expect(alert?.message).toContain("96%");
  });

  it("gera atenção entre 86% e 95%", () => {
    expect(getCollectorAlert({ ...base, ratio: 0.9 })?.kind).toBe("attention");
  });

  it("informa acúmulo apenas quando o nível está subindo", () => {
    expect(getCollectorAlert({ ...base, ratio: 0.5, trend: "rising" })?.kind).toBe("filling");
    expect(getCollectorAlert({ ...base, ratio: 0.5 })).toBeNull();
  });
});

describe("regras de água", () => {
  it("desconta reserva e volume reservado, sem ficar negativo", () => {
    expect(availableLiters(7.5, 0.5)).toBe(7);
    expect(availableLiters(7.5, 0.5, 3)).toBe(4);
    expect(availableLiters(0.3, 0.5)).toBe(0);
  });

  it("calcula a taxa de aproveitamento", () => {
    expect(reuseRate({ capturedLiters: 0, reusedLiters: 0, discardedEstimatedLiters: 0 })).toBeNull();
    expect(reuseRate({ capturedLiters: 128.4, reusedLiters: 116.8, discardedEstimatedLiters: 11.6 })).toBeCloseTo(0.9097, 3);
  });
});
