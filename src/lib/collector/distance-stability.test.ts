import { describe, expect, it } from "vitest";
import {
  appendDistanceSample,
  assessDistanceStability,
  DISTANCE_STABILITY,
  parseDistanceSamples,
  type DistanceSample,
} from "./distance-stability";

const NOW = 1_000_000;
const NOISE = [0, 1, -1, 2, -2, 1, 0, -1, 1, 0]; // ±2 mm, como o VL53L1X após a mediana

/** Uma leitura por segundo terminando em NOW. */
function series(values: readonly (number | null)[]): DistanceSample[] {
  return values.map((mm, index) => ({ at: NOW - (values.length - 1 - index) * 1000, mm }));
}

const steady = (distance: number, count = 20) => series(Array.from({ length: count }, (_, i) => distance + NOISE[i % NOISE.length]!));

describe("estabilização da leitura do VL53L1X", () => {
  it("declara estável com leituras suficientes e pouca variação", () => {
    const result = assessDistanceStability(steady(1236), NOW);
    expect(result.state).toBe("stable");
    expect(result.readings).toBe(20);
    expect(result.distanceMm).toBeCloseTo(1236, 0);
    expect(result.stdMm!).toBeLessThanOrEqual(DISTANCE_STABILITY.stableStdMm);
  });

  it("aguarda enquanto há poucas leituras", () => {
    const result = assessDistanceStability(steady(1236, 5), NOW);
    expect(result).toMatchObject({ state: "stabilizing", readings: 5 });
    expect(result.message).toMatch(/Aguardando leituras/);
  });

  it("não aceita nível em movimento (deriva)", () => {
    const rising = series(Array.from({ length: 20 }, (_, i) => 1300 - i * 0.6)); // água entrando
    const result = assessDistanceStability(rising, NOW);
    expect(result.state).toBe("stabilizing");
    expect(result.driftMm!).toBeLessThan(-DISTANCE_STABILITY.maxDriftMm);
  });

  it("rejeita reflexos espúrios sem perder a estabilidade", () => {
    const values: (number | null)[] = steady(1236).map((sample) => sample.mm);
    values[4] = 1790;
    values[13] = 1655;
    const result = assessDistanceStability(series(values), NOW);
    expect(result).toMatchObject({ state: "stable", outliers: 2, readings: 18 });
    expect(result.distanceMm).toBeCloseTo(1236, 0);
  });

  it("continua estabilizando logo após uma mudança de nível", () => {
    const values = [...steady(1500, 10), ...steady(1364, 10)].map((sample) => sample.mm);
    expect(assessDistanceStability(series(values), NOW).state).toBe("stabilizing");
  });

  it("marca leitura inválida sem leituras, com leituras antigas ou fora da faixa", () => {
    expect(assessDistanceStability([], NOW)).toMatchObject({ state: "invalid", total: 0 });
    const old = steady(1236).map((sample) => ({ ...sample, at: sample.at - DISTANCE_STABILITY.maxAgeMs - 1000 }));
    expect(assessDistanceStability(old, NOW).state).toBe("invalid");
    expect(assessDistanceStability(series(Array(15).fill(null)), NOW)).toMatchObject({ state: "invalid", invalid: 15 });
    expect(assessDistanceStability(series([-3, 0, 12, 5000, 9999]), NOW).state).toBe("invalid");
  });

  it("marca inválida quando muitas leituras falham (sensor sem leitura)", () => {
    const values: (number | null)[] = steady(1236).map((sample) => sample.mm);
    for (const index of [1, 3, 5, 7, 9, 11, 13]) values[index] = null; // 35% sem leitura
    expect(assessDistanceStability(series(values), NOW)).toMatchObject({ state: "invalid", invalid: 7 });
  });

  it("mede o tempo médio entre leituras recebidas", () => {
    expect(assessDistanceStability(steady(1236), NOW).averageIntervalMs).toBe(1000);
    const slow = series(Array.from({ length: 12 }, () => 1236)).map((sample, index) => ({ ...sample, at: NOW - (11 - index) * 2500 }));
    expect(assessDistanceStability(slow, NOW).averageIntervalMs).toBe(2500);
    expect(assessDistanceStability(series([1236]), NOW).averageIntervalMs).toBeNull();
  });

  it("mantém só a janela recente ao acrescentar leituras", () => {
    let samples: DistanceSample[] = [];
    for (let i = 0; i < 40; i++) samples = appendDistanceSample(samples, { at: NOW + i * 1000, mm: 1236 });
    expect(samples).toHaveLength(DISTANCE_STABILITY.windowSize);
    expect(samples.at(-1)!.at).toBe(NOW + 39_000);

    const afterPause = appendDistanceSample(samples, { at: NOW + 200_000, mm: 1236 });
    expect(afterPause).toEqual([{ at: NOW + 200_000, mm: 1236 }]);
  });

  it("lê o JSON do banco ignorando valores malformados", () => {
    expect(parseDistanceSamples('[{"at":1,"mm":1236},{"at":2,"mm":null},{"at":"x"},null,3]')).toEqual([
      { at: 1, mm: 1236 },
      { at: 2, mm: null },
    ]);
    expect(parseDistanceSamples(null)).toEqual([]);
  });
});
