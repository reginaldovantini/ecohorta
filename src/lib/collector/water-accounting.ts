import type { WaterTotals, WaterTrend } from "@/lib/iot/types";

/*
 * Contabilidade hídrica do captador — calculada no SERVIDOR a partir da telemetria.
 * O dispositivo só mede e atua; tendência, transbordamento e balanço ficam aqui.
 *
 * O relógio usado é o `uptime_ms` do próprio dispositivo (monotônico),
 * então as taxas continuam corretas mesmo com atraso de rede ou simulação acelerada.
 *
 * Balanço:  captado = armazenado − base + reutilizado + descartado(estimado)
 *           A base começa em 0: a água já presente no início da medição conta como
 *           captada, então o aproveitamento (reutilizado ÷ captado) nunca passa de 100%.
 * Descarte: o sensor não vê o dreno. Estimamos com a taxa de acúmulo aprendida
 *           ANTES do limite × tempo no limite. Sempre exibido como estimativa.
 */

export interface AccountingState {
  /** Ajustada para baixo quando há saída não registrada (esvaziamento manual, vazamento). */
  baselineLiters: number;
  reusedLiters: number;
  discardedEstimatedLiters: number;
  learnedInflowLitersPerHour: number;
  overflowing: boolean;
  samples: { t: number; v: number }[];
  lastUptimeMs: number | null;
  lastVolumeLiters: number | null;
}

export interface Reading {
  uptimeMs: number;
  volumeLiters: number;
  capacityLiters: number;
  /** Válvula aberta ou liberação em andamento: quedas de nível são reúso, não perdas. */
  dispensing: boolean;
}

const SAMPLE_SPACING_MS = 2_000;
const WINDOW_MS = 10 * 60_000;
const MIN_SPAN_MS = 60_000;
const SHORT_WINDOW_MS = 30_000;
const SHORT_MIN_SPAN_MS = 4_000;
const TREND_THRESHOLD_LPH = 0.15;
const OVERFLOW_ENTER_RATIO = 0.995;
const OVERFLOW_EXIT_RATIO = 0.985;
/** Queda sem comando acima disso é tratada como saída não registrada (esvaziamento manual, vazamento). */
const UNTRACKED_DROP_LITERS = 0.3;
/** Lacunas longas sem telemetria não geram estimativa de descarte além deste limite. */
const MAX_ESTIMATE_GAP_MS = 10 * 60_000;
const MS_PER_HOUR = 3_600_000;

export function createAccountingState(): AccountingState {
  return {
    baselineLiters: 0,
    reusedLiters: 0,
    discardedEstimatedLiters: 0,
    learnedInflowLitersPerHour: 0,
    overflowing: false,
    samples: [],
    lastUptimeMs: null,
    lastVolumeLiters: null,
  };
}

function slope(samples: readonly { t: number; v: number }[], minSpanMs: number) {
  if (samples.length < 2) return 0;
  const span = samples[samples.length - 1]!.t - samples[0]!.t;
  if (span < minSpanMs) return 0;
  let sumT = 0;
  let sumV = 0;
  for (const sample of samples) {
    sumT += sample.t;
    sumV += sample.v;
  }
  const meanT = sumT / samples.length;
  const meanV = sumV / samples.length;
  let numerator = 0;
  let denominator = 0;
  for (const sample of samples) {
    numerator += (sample.t - meanT) * (sample.v - meanV);
    denominator += (sample.t - meanT) ** 2;
  }
  return denominator === 0 ? 0 : (numerator / denominator) * MS_PER_HOUR;
}

/** Incorpora uma leitura. Muta e retorna o estado (uma instância por captador). */
export function ingestReading(state: AccountingState, reading: Reading): AccountingState {
  const { uptimeMs, volumeLiters, capacityLiters, dispensing } = reading;

  // Reinício do dispositivo: o relógio voltou; recomeça a janela de tendência.
  if (state.lastUptimeMs !== null && uptimeMs < state.lastUptimeMs) {
    state.samples = [];
    state.lastUptimeMs = null;
  }

  const gapMs = state.lastUptimeMs === null ? 0 : Math.min(uptimeMs - state.lastUptimeMs, MAX_ESTIMATE_GAP_MS);

  if (
    !dispensing &&
    state.lastVolumeLiters !== null &&
    state.lastVolumeLiters - volumeLiters > UNTRACKED_DROP_LITERS
  ) {
    state.baselineLiters -= state.lastVolumeLiters - volumeLiters;
    state.samples = [];
  }

  const ratio = capacityLiters > 0 ? volumeLiters / capacityLiters : 0;
  if (!state.overflowing && ratio >= OVERFLOW_ENTER_RATIO) state.overflowing = true;
  else if (state.overflowing && ratio < OVERFLOW_EXIT_RATIO) state.overflowing = false;

  if (state.overflowing && !dispensing && gapMs > 0) {
    state.discardedEstimatedLiters += state.learnedInflowLitersPerHour * (gapMs / MS_PER_HOUR);
  }

  const last = state.samples[state.samples.length - 1];
  if (!last || uptimeMs - last.t >= SAMPLE_SPACING_MS || dispensing) {
    state.samples.push({ t: uptimeMs, v: volumeLiters });
    while (state.samples.length > 0 && uptimeMs - state.samples[0]!.t > WINDOW_MS) state.samples.shift();
  }

  if (!dispensing && !state.overflowing) {
    const rate = slope(state.samples, MIN_SPAN_MS);
    if (rate > TREND_THRESHOLD_LPH) state.learnedInflowLitersPerHour = rate;
  }

  state.lastUptimeMs = uptimeMs;
  state.lastVolumeLiters = volumeLiters;
  return state;
}

/** Restaura o estado salvo no banco (JSON); estado novo se ausente ou inválido. */
export function accountingFromJson(value: unknown): AccountingState {
  const parsed = (typeof value === "string" ? JSON.parse(value) : value) as Partial<AccountingState> | null | undefined;
  return parsed && typeof parsed.reusedLiters === "number" ? (parsed as AccountingState) : createAccountingState();
}

/**
 * Troca de calibração: o mesmo nível físico passa a valer outro volume.
 * A base acompanha a diferença para que a mudança de conversão não crie nem
 * apague água captada; a tendência recomeça.
 */
export function rebaseVolume(state: AccountingState, previousVolumeLiters: number, newVolumeLiters: number) {
  state.baselineLiters += newVolumeLiters - previousVolumeLiters;
  state.samples = [];
  state.lastVolumeLiters = newVolumeLiters;
  return state;
}

/** Registra reúso medido e confirmado de uma liberação. */
export function registerReuse(state: AccountingState, liters: number) {
  state.reusedLiters += Math.max(0, liters);
  // A queda da liberação não deve contaminar a tendência de acúmulo.
  state.samples = [];
}

export function getTrend(state: AccountingState, dispensing: boolean): { trend: WaterTrend; netFlowLitersPerHour: number } {
  const last = state.samples[state.samples.length - 1];
  if (dispensing && last) {
    const recent = state.samples.filter((sample) => last.t - sample.t <= SHORT_WINDOW_MS);
    const rate = slope(recent, SHORT_MIN_SPAN_MS);
    return { trend: "falling", netFlowLitersPerHour: Math.min(0, rate) };
  }
  const rate = slope(state.samples, MIN_SPAN_MS);
  if (rate > TREND_THRESHOLD_LPH) return { trend: "rising", netFlowLitersPerHour: rate };
  if (rate < -TREND_THRESHOLD_LPH) return { trend: "falling", netFlowLitersPerHour: rate };
  return { trend: "stable", netFlowLitersPerHour: rate };
}

export function getTotals(state: AccountingState, currentVolumeLiters: number): WaterTotals {
  const stored = currentVolumeLiters - state.baselineLiters;
  return {
    capturedLiters: Math.max(0, stored + state.reusedLiters + state.discardedEstimatedLiters),
    reusedLiters: state.reusedLiters,
    discardedEstimatedLiters: state.discardedEstimatedLiters,
  };
}
