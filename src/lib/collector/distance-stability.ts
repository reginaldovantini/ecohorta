import { isValidDistance } from "./volume-calibration";

/*
 * ESTABILIZAÇÃO DA LEITURA DO SENSOR DE DISTÂNCIA (VL53L0X ou VL53L1X)
 *
 * Cada telemetria traz uma distância (o firmware já aplica mediana de 9 amostras).
 * O servidor guarda as leituras recentes do captador e decide se a superfície está
 * parada o suficiente para virar ponto de calibração:
 *
 *   1. janela: últimas `windowSize` leituras com no máximo `maxAgeMs`;
 *   2. inválidas: ausentes ou fora da faixa do sensor;
 *   3. mediana das válidas;
 *   4. outliers: leituras a mais de `outlierMm` da mediana são descartadas;
 *   5. variação: desvio-padrão das leituras aceitas;
 *   6. deriva: média da 2ª metade − média da 1ª metade (nível subindo ou descendo);
 *   7. estável = leituras suficientes, poucos outliers, variação e deriva pequenas.
 *
 * Distância estabilizada = média das leituras aceitas. Parâmetros em docs/CALIBRACAO.md.
 */

export interface DistanceSample {
  /** Horário do servidor (epoch ms). */
  at: number;
  mm: number | null;
}

export interface DistanceStabilityConfig {
  windowSize: number;
  maxAgeMs: number;
  minReadings: number;
  outlierMm: number;
  maxOutlierRatio: number;
  maxInvalidRatio: number;
  stableStdMm: number;
  maxDriftMm: number;
}

export const DISTANCE_STABILITY: DistanceStabilityConfig = {
  windowSize: 20,
  // 60 s: o ESP32 real leva ~1–3 s por leitura (mediana de 9 amostras + HTTPS).
  maxAgeMs: 60_000,
  minReadings: 12,
  outlierMm: 10,
  maxOutlierRatio: 0.2,
  maxInvalidRatio: 0.3,
  stableStdMm: 2,
  maxDriftMm: 2,
};

export type DistanceStabilityState = "stabilizing" | "stable" | "invalid";

export const STABILITY_LABEL: Record<DistanceStabilityState, string> = {
  stabilizing: "Estabilizando",
  stable: "Estável",
  invalid: "Inválida",
};

export interface DistanceStability {
  state: DistanceStabilityState;
  /** Média das leituras aceitas (mm). `null` sem leituras válidas. */
  distanceMm: number | null;
  medianMm: number | null;
  /** Desvio-padrão das leituras aceitas (mm). */
  stdMm: number | null;
  driftMm: number | null;
  /** Leituras aceitas (válidas e sem outliers). */
  readings: number;
  outliers: number;
  invalid: number;
  total: number;
  /** Tempo médio entre leituras recebidas na janela (ms). */
  averageIntervalMs: number | null;
  message: string;
}

const round1 = (value: number) => Math.round(value * 10) / 10;

function median(values: readonly number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

const mean = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

/** Acrescenta uma leitura e mantém só a janela útil (ordem cronológica). */
export function appendDistanceSample(
  samples: readonly DistanceSample[],
  sample: DistanceSample,
  config: DistanceStabilityConfig = DISTANCE_STABILITY,
): DistanceSample[] {
  return [...samples, sample].filter((item) => sample.at - item.at <= config.maxAgeMs).slice(-config.windowSize);
}

/** Lê com segurança o JSON guardado no banco. */
export function parseDistanceSamples(value: unknown): DistanceSample[] {
  const raw = typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (item): item is DistanceSample =>
      typeof item === "object" && item !== null && typeof (item as DistanceSample).at === "number" && ((item as DistanceSample).mm === null || typeof (item as DistanceSample).mm === "number"),
  );
}

export function assessDistanceStability(
  samples: readonly DistanceSample[],
  nowMs: number,
  config: DistanceStabilityConfig = DISTANCE_STABILITY,
): DistanceStability {
  const recent = samples.filter((sample) => nowMs - sample.at <= config.maxAgeMs && sample.at <= nowMs).slice(-config.windowSize);
  const valid = recent.map((sample) => sample.mm).filter(isValidDistance);
  const invalid = recent.length - valid.length;
  const averageIntervalMs =
    recent.length >= 2 ? Math.round((recent[recent.length - 1]!.at - recent[0]!.at) / (recent.length - 1)) : null;
  const base = {
    total: recent.length,
    invalid,
    outliers: 0,
    readings: 0,
    distanceMm: null,
    medianMm: null,
    stdMm: null,
    driftMm: null,
    averageIntervalMs,
  };

  if (recent.length === 0) {
    return { ...base, state: "invalid", message: "Sem leituras recentes do sensor." };
  }
  if (valid.length === 0 || (recent.length >= config.minReadings && invalid / recent.length > config.maxInvalidRatio)) {
    return { ...base, state: "invalid", message: "Leituras ausentes ou fora da faixa do sensor." };
  }

  const medianMm = median(valid);
  const accepted = valid.filter((value) => Math.abs(value - medianMm) <= config.outlierMm);
  const outliers = valid.length - accepted.length;
  const average = mean(accepted);
  const stdMm = Math.sqrt(mean(accepted.map((value) => (value - average) ** 2)));
  const half = Math.floor(accepted.length / 2);
  const driftMm = half > 0 ? mean(accepted.slice(accepted.length - half)) - mean(accepted.slice(0, half)) : 0;

  const measured = {
    ...base,
    outliers,
    readings: accepted.length,
    distanceMm: round1(average),
    medianMm: round1(medianMm),
    stdMm: round1(stdMm),
    driftMm: round1(driftMm),
  };

  if (accepted.length < config.minReadings) {
    return { ...measured, state: "stabilizing", message: `Aguardando leituras (${accepted.length} de ${config.minReadings}).` };
  }
  if (outliers / valid.length > config.maxOutlierRatio || stdMm > config.stableStdMm || Math.abs(driftMm) > config.maxDriftMm) {
    return { ...measured, state: "stabilizing", message: "Nível variando: aguarde a água assentar." };
  }
  return { ...measured, state: "stable", message: "Leitura estável." };
}
