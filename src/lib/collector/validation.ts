import { volumeFromDistance, type VolumeModel } from "./volume-calibration";

/*
 * VALIDAÇÃO EXPERIMENTAL de uma calibração ativa: um volume físico conhecido
 * (medido com balança ou recipiente graduado) é comparado com o volume que o
 * sistema calcula a partir da distância estabilizada.
 *
 * É dado experimental: nunca altera a calibração e não tem "nota de aprovação".
 * Erro = calculado − conhecido (negativo: o sistema mostra menos água do que há).
 */

export const VALIDATION_METHODS = ["balanca", "recipiente_graduado", "outro"] as const;
export type ValidationMethod = (typeof VALIDATION_METHODS)[number];

export const VALIDATION_METHOD_LABEL: Record<ValidationMethod, string> = {
  balanca: "Balança (1 kg ≈ 1 L)",
  recipiente_graduado: "Recipiente graduado",
  outro: "Outro",
};

export interface ValidationResult {
  knownVolumeLiters: number;
  distanceMm: number;
  heightMm: number;
  /** O volume que o sistema exibe (limitado entre 0 e a capacidade). */
  calculatedVolumeLiters: number;
  rawVolumeLiters: number;
  belowZero: boolean;
  aboveMaximum: boolean;
  /** calculado − conhecido */
  errorLiters: number;
  /** |calculado − conhecido| */
  absoluteErrorLiters: number;
  /** (calculado − conhecido) ÷ conhecido × 100. `null` quando o volume conhecido é 0. */
  percentError: number | null;
  /** |(calculado − conhecido) ÷ conhecido| × 100 */
  absolutePercentError: number | null;
}

const round3 = (value: number) => Math.round(value * 1000) / 1000;

/** Erro de uma leitura contra o volume conhecido. `null` se a distância não produz volume. */
export function evaluateValidation(model: VolumeModel, distanceMm: number, knownVolumeLiters: number): ValidationResult | null {
  if (!Number.isFinite(knownVolumeLiters) || knownVolumeLiters < 0) return null;
  const reading = volumeFromDistance(model, distanceMm);
  if (!reading) return null;
  const calculated = round3(reading.volumeLiters);
  const known = round3(knownVolumeLiters);
  const error = round3(calculated - known);
  const percent = known > 0 ? round3(((calculated - known) / known) * 100) : null;
  return {
    knownVolumeLiters: known,
    distanceMm,
    heightMm: Math.round(reading.heightMm * 10) / 10,
    calculatedVolumeLiters: calculated,
    rawVolumeLiters: round3(reading.rawVolumeLiters),
    belowZero: reading.belowZero,
    aboveMaximum: reading.aboveMaximum,
    errorLiters: error,
    absoluteErrorLiters: Math.abs(error),
    percentError: percent,
    absolutePercentError: percent === null ? null : Math.abs(percent),
  };
}

export interface ValidationSummary {
  count: number;
  /** Média do erro com sinal: tendência sistemática (viés). */
  meanErrorLiters: number | null;
  meanAbsoluteErrorLiters: number | null;
  maxAbsoluteErrorLiters: number | null;
  /** Média do erro percentual absoluto (só registros com volume conhecido > 0). */
  meanAbsolutePercentError: number | null;
}

/** Estatística descritiva — sem limite de "bom" ou "ruim" definido a priori. */
export function summarizeValidations(
  records: readonly Pick<ValidationResult, "errorLiters" | "absoluteErrorLiters" | "absolutePercentError">[],
): ValidationSummary {
  if (records.length === 0) {
    return { count: 0, meanErrorLiters: null, meanAbsoluteErrorLiters: null, maxAbsoluteErrorLiters: null, meanAbsolutePercentError: null };
  }
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const percents = records.map((record) => record.absolutePercentError).filter((value): value is number => value !== null);
  return {
    count: records.length,
    meanErrorLiters: round3(mean(records.map((record) => record.errorLiters))),
    meanAbsoluteErrorLiters: round3(mean(records.map((record) => record.absoluteErrorLiters))),
    maxAbsoluteErrorLiters: round3(Math.max(...records.map((record) => record.absoluteErrorLiters))),
    meanAbsolutePercentError: percents.length > 0 ? round3(mean(percents)) : null,
  };
}
