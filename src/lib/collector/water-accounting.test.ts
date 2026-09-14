import { describe, expect, it } from "vitest";
import { createAccountingState, getTotals, getTrend, ingestReading, registerReuse } from "./water-accounting";

const CAPACITY = 12;

/** Gera leituras a cada `stepMs` com a taxa informada (L/h). */
function feed(
  state = createAccountingState(),
  { from = 0, durationMs, stepMs = 1_000, startLiters, rateLph, dispensing = false }: {
    from?: number;
    durationMs: number;
    stepMs?: number;
    startLiters: number;
    rateLph: number;
    dispensing?: boolean;
  },
) {
  let volume = startLiters;
  for (let t = from; t <= from + durationMs; t += stepMs) {
    volume = Math.min(CAPACITY, startLiters + (rateLph * (t - from)) / 3_600_000);
    ingestReading(state, { uptimeMs: t, volumeLiters: volume, capacityLiters: CAPACITY, dispensing });
  }
  return { state, volume, end: from + durationMs };
}

describe("contabilidade hídrica", () => {
  it("identifica acúmulo e estável", () => {
    const rising = feed(undefined, { durationMs: 5 * 60_000, startLiters: 5, rateLph: 1.2 });
    const trend = getTrend(rising.state, false);
    expect(trend.trend).toBe("rising");
    expect(trend.netFlowLitersPerHour).toBeCloseTo(1.2, 1);

    const stable = feed(undefined, { durationMs: 5 * 60_000, startLiters: 5, rateLph: 0 });
    expect(getTrend(stable.state, false).trend).toBe("stable");
  });

  it("calcula o captado pelo balanço de massa", () => {
    const { state, volume } = feed(undefined, { durationMs: 60 * 60_000, stepMs: 5_000, startLiters: 4, rateLph: 2 });
    expect(getTotals(state, volume).capturedLiters).toBeCloseTo(2, 2);

    registerReuse(state, 1.5);
    const afterReuse = getTotals(state, volume - 1.5);
    expect(afterReuse.capturedLiters).toBeCloseTo(2, 2);
    expect(afterReuse.reusedLiters).toBe(1.5);
  });

  it("estima o descarte no dreno com a taxa aprendida antes do limite", () => {
    // 11,2 L → 11,6 L em 10 minutos (abaixo do limite de 99,5%).
    const filling = feed(undefined, { durationMs: 10 * 60_000, stepMs: 2_000, startLiters: 11.2, rateLph: 2.4 });
    expect(filling.state.overflowing).toBe(false);

    // 30 minutos no limite: o nível para de subir, mas a água continua chegando.
    const full = feed(filling.state, { from: filling.end + 2_000, durationMs: 30 * 60_000, stepMs: 2_000, startLiters: CAPACITY, rateLph: 0 });
    expect(full.state.overflowing).toBe(true);
    expect(getTotals(full.state, CAPACITY).discardedEstimatedLiters).toBeCloseTo(1.2, 1);
    expect(getTrend(full.state, false).trend).toBe("stable");
  });

  it("não estima descarte durante uma liberação", () => {
    const state = createAccountingState();
    state.learnedInflowLitersPerHour = 2;
    feed(state, { durationMs: 5 * 60_000, stepMs: 2_000, startLiters: CAPACITY, rateLph: 0, dispensing: true });
    expect(state.discardedEstimatedLiters).toBe(0);
  });

  it("trata queda sem comando como saída não registrada, sem reduzir o captado", () => {
    const { state, volume } = feed(undefined, { durationMs: 60 * 60_000, stepMs: 5_000, startLiters: 6, rateLph: 1 });
    const before = getTotals(state, volume).capturedLiters;
    ingestReading(state, { uptimeMs: 60 * 60_000 + 5_000, volumeLiters: 2, capacityLiters: CAPACITY, dispensing: false });
    expect(getTotals(state, 2).capturedLiters).toBeCloseTo(before, 2);
  });

  it("recomeça a tendência quando o dispositivo reinicia", () => {
    const { state } = feed(undefined, { durationMs: 5 * 60_000, startLiters: 5, rateLph: 1.2 });
    ingestReading(state, { uptimeMs: 500, volumeLiters: 5.1, capacityLiters: CAPACITY, dispensing: false });
    expect(state.samples).toHaveLength(1);
    expect(getTrend(state, false).trend).toBe("stable");
  });
});
