import { formatDecimal } from "@/lib/utils/format";
import { fillRatio } from "./level-state";

/*
 * CALIBRAÇÃO EXPERIMENTAL DE VOLUME — sensor de distância (VL53L0X ou VL53L1X) no topo de um tubo de seção constante.
 *
 * O sensor mede a distância D até a superfície da água (dado físico primário).
 *   H = D0 − D     altura da coluna acima do nível ZERO (centro da saída da válvula)
 *   V = k × H      k em litros por mm, determinado pelos volumes conhecidos de 1, 2 e 3 L
 *
 * k vem de mínimos quadrados com a reta passando pela origem (o nível ZERO é 0,00 L):
 *   k = Σ(Hᵢ·Vᵢ) / Σ(Hᵢ²)
 * A capacidade efetiva vai até o nível máximo (saída do dreno): C = k × (D0 − Dmax).
 *
 * Nada aqui "conserta" pontos ruins: a qualidade é avaliada e, se inconsistente,
 * a calibração não é ativada. Procedimento e limites: docs/CALIBRACAO.md.
 */

export const CALIBRATION_ALGORITHM = "linear-origin-v1";
export const DEFAULT_SENSOR_MODEL = "VL53L1X";

/**
 * Faixa aceita pela plataforma (a do VL53L1X no modo longo, o maior alcance entre os sensores suportados).
 * Fora dela a leitura é inválida. O firmware ainda limita cada leitura ao alcance documentado do sensor em uso.
 */
export const VL53L1X_RANGE_MM = { min: 40, max: 4000 } as const;

export type CalibrationStepId = "zero" | "one" | "two" | "three" | "max";

export interface CalibrationStepDefinition {
  id: CalibrationStepId;
  /** Volume conhecido do ponto; `null` no nível máximo (a capacidade é calculada, nunca digitada). */
  liters: number | null;
  label: string;
  instruction: string;
  action: string;
}

export const CALIBRATION_STEPS: readonly CalibrationStepDefinition[] = [
  {
    id: "zero",
    liters: 0,
    label: "0,00 L",
    instruction: "Coloque o captador em 0,00 L e aguarde a estabilização.",
    action: "Registrar zero",
  },
  {
    id: "one",
    liters: 1,
    label: "1,00 L",
    instruction: "Adicione exatamente 1,00 L e aguarde a estabilização.",
    action: "Registrar 1 L",
  },
  {
    id: "two",
    liters: 2,
    label: "2,00 L",
    instruction: "Adicione água até atingir exatamente 2,00 L no total e aguarde a estabilização.",
    action: "Registrar 2 L",
  },
  {
    id: "three",
    liters: 3,
    label: "3,00 L",
    instruction: "Adicione água até atingir exatamente 3,00 L no total e aguarde a estabilização.",
    action: "Registrar 3 L",
  },
  {
    id: "max",
    liters: null,
    label: "Nível máximo",
    instruction: "Encha o captador até a saída do dreno de segurança e aguarde a estabilização.",
    action: "Registrar nível máximo",
  },
];

export const CALIBRATION_STEP_IDS = CALIBRATION_STEPS.map((step) => step.id);

export interface CalibrationDistances {
  zeroMm: number;
  oneLiterMm: number;
  twoLitersMm: number;
  threeLitersMm: number;
  maximumMm: number;
}

export const DISTANCE_FIELD: Record<CalibrationStepId, keyof CalibrationDistances> = {
  zero: "zeroMm",
  one: "oneLiterMm",
  two: "twoLitersMm",
  three: "threeLitersMm",
  max: "maximumMm",
};

export interface NominalGeometry {
  diameterMm: number | null;
  usefulHeightMm: number | null;
}

interface Range {
  min: number;
  max: number;
}

/**
 * Limites de aceitação da calibração. Valores escolhidos para o DN100 do EC-001:
 * ~127 mm de coluna por litro, resolução prática do sensor de ±2 mm e erro de
 * uma proveta de ±10–20 mL. Documentados em docs/CALIBRACAO.md.
 */
export interface CalibrationQualityConfig {
  /** Separação mínima entre pontos consecutivos (e entre 3 L e o máximo). */
  minStepMm: number;
  /** Maior |k·H − V| aceito nos pontos de 1, 2 e 3 L. */
  maxResidualLiters: number;
  goodMaxResidualLiters: number;
  /** Maior diferença relativa entre as alturas de cada litro (1º, 2º e 3º). */
  maxStepDeviation: number;
  goodStepDeviation: number;
  /** Diâmetro efetivo em relação ao nominal (o interno real é ligeiramente menor). */
  diameterRatio: Range;
  fallbackDiameterMm: Range;
  /** Altura útil (zero → máximo) em relação à altura nominal. */
  heightRatio: Range;
  fallbackMaxHeightMm: number;
  /** Capacidade em relação à do tubo nominal (π/4 · D² · H). */
  capacityRatio: Range;
}

export const CALIBRATION_QUALITY: CalibrationQualityConfig = {
  minStepMm: 30,
  maxResidualLiters: 0.08,
  goodMaxResidualLiters: 0.03,
  maxStepDeviation: 0.1,
  goodStepDeviation: 0.04,
  diameterRatio: { min: 0.8, max: 1.05 },
  fallbackDiameterMm: { min: 20, max: 400 },
  heightRatio: { min: 0.6, max: 1.3 },
  fallbackMaxHeightMm: 3000,
  capacityRatio: { min: 0.55, max: 1.25 },
};

export type CalibrationQuality = "good" | "acceptable" | "inconsistent";

export const CALIBRATION_QUALITY_LABEL: Record<CalibrationQuality, string> = {
  good: "Boa",
  acceptable: "Aceitável",
  inconsistent: "Inconsistente",
};

export type CalibrationCheckId = "readings" | "order" | "spacing" | "linearity" | "consistency" | "diameter" | "height" | "capacity";

export interface CalibrationCheck {
  id: CalibrationCheckId;
  ok: boolean;
  label: string;
  detail: string;
}

export interface CalibrationFit {
  algorithm: string;
  accepted: boolean;
  quality: CalibrationQuality;
  checks: CalibrationCheck[];
  /** Alturas H = D0 − D de cada ponto (mm). */
  heightsMm: { one: number; two: number; three: number; max: number };
  /** Desnível de cada litro: 0→1, 1→2 e 2→3 L (mm). */
  stepHeightsMm: [number, number, number];
  constantLitersPerMm: number | null;
  effectiveAreaMm2: number | null;
  effectiveDiameterMm: number | null;
  effectiveHeightMm: number;
  effectiveCapacityLiters: number | null;
  /** k·H − V nos pontos de 1, 2 e 3 L (litros). */
  residualsLiters: [number, number, number] | null;
  maxResidualLiters: number | null;
  /** Coeficiente de determinação com os 4 pontos (0, 1, 2 e 3 L). */
  rSquared: number | null;
  /** Maior desvio relativo entre as alturas de cada litro. */
  stepDeviation: number | null;
  /** Quantas vezes a altura útil excede a altura do ponto de 3 L (a capacidade é extrapolada). */
  extrapolationFactor: number | null;
  nominalCapacityLiters: number | null;
}

const MM3_PER_LITER = 1_000_000;
const KNOWN_VOLUMES = [1, 2, 3] as const;
/** Σ(Vᵢ − média)² para 0, 1, 2 e 3 L (média 1,5 L). */
const TOTAL_SUM_OF_SQUARES = 5;

const mm = (value: number) => `${formatDecimal(value, 0)} mm`;
const liters = (value: number, digits = 2) => `${formatDecimal(value, digits)} L`;
const percent = (ratio: number) => `${formatDecimal(ratio * 100, 1)}%`;

export function nominalCapacityLiters(nominal: NominalGeometry) {
  if (!nominal.diameterMm || !nominal.usefulHeightMm) return null;
  return (Math.PI / 4) * nominal.diameterMm ** 2 * nominal.usefulHeightMm / MM3_PER_LITER;
}

export function isValidDistance(distanceMm: number | null | undefined): distanceMm is number {
  return (
    typeof distanceMm === "number" &&
    Number.isFinite(distanceMm) &&
    distanceMm >= VL53L1X_RANGE_MM.min &&
    distanceMm <= VL53L1X_RANGE_MM.max
  );
}

/** Ajusta V = k × H aos cinco pontos medidos e avalia a qualidade. Nunca descarta nem corrige pontos. */
export function fitVolumeCalibration(
  distances: CalibrationDistances,
  nominal: NominalGeometry = { diameterMm: null, usefulHeightMm: null },
  config: CalibrationQualityConfig = CALIBRATION_QUALITY,
): CalibrationFit {
  const { zeroMm, oneLiterMm, twoLitersMm, threeLitersMm, maximumMm } = distances;
  const all = [zeroMm, oneLiterMm, twoLitersMm, threeLitersMm, maximumMm];
  const readingsOk = all.every(isValidDistance);

  const h1 = zeroMm - oneLiterMm;
  const h2 = zeroMm - twoLitersMm;
  const h3 = zeroMm - threeLitersMm;
  const hMax = zeroMm - maximumMm;
  const heights = [h1, h2, h3] as const;
  const stepHeightsMm: [number, number, number] = [h1, h2 - h1, h3 - h2];

  const orderOk = readingsOk && zeroMm > oneLiterMm && oneLiterMm > twoLitersMm && twoLitersMm > threeLitersMm && threeLitersMm > maximumMm;
  const smallestGap = Math.min(...stepHeightsMm, hMax - h3);
  const spacingOk = orderOk && smallestGap >= config.minStepMm;

  // Mínimos quadrados pela origem.
  const sumHV = heights.reduce((sum, h, i) => sum + h * KNOWN_VOLUMES[i]!, 0);
  const sumHH = heights.reduce((sum, h) => sum + h * h, 0);
  const k = readingsOk && sumHH > 0 && sumHV > 0 ? sumHV / sumHH : null;

  const residualsLiters = k === null ? null : (heights.map((h, i) => k * h - KNOWN_VOLUMES[i]!) as [number, number, number]);
  const maxResidualLiters = residualsLiters === null ? null : Math.max(...residualsLiters.map(Math.abs));
  const rSquared = residualsLiters === null ? null : 1 - residualsLiters.reduce((sum, r) => sum + r * r, 0) / TOTAL_SUM_OF_SQUARES;

  const meanStep = (stepHeightsMm[0] + stepHeightsMm[1] + stepHeightsMm[2]) / 3;
  const stepDeviation = orderOk && meanStep > 0 ? Math.max(...stepHeightsMm.map((step) => Math.abs(step - meanStep))) / meanStep : null;

  const effectiveAreaMm2 = k === null ? null : k * MM3_PER_LITER;
  const effectiveDiameterMm = effectiveAreaMm2 === null ? null : 2 * Math.sqrt(effectiveAreaMm2 / Math.PI);
  const effectiveCapacityLiters = k === null ? null : k * hMax;
  const extrapolationFactor = orderOk && h3 > 0 ? hMax / h3 : null;
  const nominalCapacity = nominalCapacityLiters(nominal);

  const notComputed = "Não calculado: revise as leituras.";
  const checks: CalibrationCheck[] = [
    {
      id: "readings",
      ok: readingsOk,
      label: "Leituras válidas do sensor",
      detail: readingsOk
        ? `Todas entre ${mm(VL53L1X_RANGE_MM.min)} e ${mm(VL53L1X_RANGE_MM.max)}.`
        : `Há leituras ausentes ou fora da faixa aceita (${mm(VL53L1X_RANGE_MM.min)} a ${mm(VL53L1X_RANGE_MM.max)}).`,
    },
    {
      id: "order",
      ok: orderOk,
      label: "Distância diminui a cada etapa",
      detail: orderOk
        ? "0 L > 1 L > 2 L > 3 L > nível máximo."
        : "Pontos fora de ordem: a distância precisa diminuir do zero até o nível máximo.",
    },
    {
      id: "spacing",
      ok: spacingOk,
      label: "Pontos suficientemente separados",
      detail: orderOk
        ? `Menor separação: ${mm(smallestGap)} (mínimo ${mm(config.minStepMm)}).`
        : notComputed,
    },
    {
      id: "linearity",
      ok: maxResidualLiters !== null && orderOk && maxResidualLiters <= config.maxResidualLiters,
      label: "Pontos alinhados com a reta V = k × H",
      detail:
        maxResidualLiters === null
          ? notComputed
          : `Maior resíduo: ±${liters(maxResidualLiters, 3)} (limite ${liters(config.maxResidualLiters, 2)}).`,
    },
    {
      id: "consistency",
      ok: stepDeviation !== null && stepDeviation <= config.maxStepDeviation,
      label: "Mesmo desnível a cada litro",
      detail:
        stepDeviation === null
          ? notComputed
          : `Cada litro: ${stepHeightsMm.map((step) => formatDecimal(step, 0)).join(", ")} mm (desvio ${percent(stepDeviation)}; limite ${percent(config.maxStepDeviation)}).`,
    },
    diameterCheck(effectiveDiameterMm, orderOk, nominal, config),
    heightCheck(hMax, orderOk, nominal, config),
    capacityCheck(effectiveCapacityLiters, orderOk, nominalCapacity, config),
  ];

  const accepted = checks.every((check) => check.ok);
  const good =
    accepted &&
    maxResidualLiters !== null &&
    maxResidualLiters <= config.goodMaxResidualLiters &&
    stepDeviation !== null &&
    stepDeviation <= config.goodStepDeviation;

  return {
    algorithm: CALIBRATION_ALGORITHM,
    accepted,
    quality: !accepted ? "inconsistent" : good ? "good" : "acceptable",
    checks,
    heightsMm: { one: h1, two: h2, three: h3, max: hMax },
    stepHeightsMm,
    constantLitersPerMm: k,
    effectiveAreaMm2,
    effectiveDiameterMm,
    effectiveHeightMm: hMax,
    effectiveCapacityLiters,
    residualsLiters,
    maxResidualLiters,
    rSquared,
    stepDeviation,
    extrapolationFactor,
    nominalCapacityLiters: nominalCapacity,
  };
}

function diameterCheck(diameter: number | null, orderOk: boolean, nominal: NominalGeometry, config: CalibrationQualityConfig): CalibrationCheck {
  const range = nominal.diameterMm
    ? { min: nominal.diameterMm * config.diameterRatio.min, max: nominal.diameterMm * config.diameterRatio.max }
    : config.fallbackDiameterMm;
  const label = "Diâmetro efetivo plausível";
  if (diameter === null || !orderOk) return { id: "diameter", ok: false, label, detail: "Não calculado: revise as leituras." };
  return {
    id: "diameter",
    ok: diameter >= range.min && diameter <= range.max,
    label,
    detail: `${formatDecimal(diameter, 1)} mm (esperado entre ${mm(range.min)} e ${mm(range.max)}${nominal.diameterMm ? ` para DN${formatDecimal(nominal.diameterMm, 0)}` : ""}).`,
  };
}

function heightCheck(height: number, orderOk: boolean, nominal: NominalGeometry, config: CalibrationQualityConfig): CalibrationCheck {
  const range = nominal.usefulHeightMm
    ? { min: nominal.usefulHeightMm * config.heightRatio.min, max: nominal.usefulHeightMm * config.heightRatio.max }
    : { min: 0, max: config.fallbackMaxHeightMm };
  const label = "Altura útil plausível";
  if (!orderOk) return { id: "height", ok: false, label, detail: "Não calculado: revise as leituras." };
  return {
    id: "height",
    ok: height >= range.min && height <= range.max,
    label,
    detail: `${mm(height)} do zero ao nível máximo (esperado entre ${mm(range.min)} e ${mm(range.max)}).`,
  };
}

function capacityCheck(capacity: number | null, orderOk: boolean, nominalCapacity: number | null, config: CalibrationQualityConfig): CalibrationCheck {
  const label = "Capacidade máxima plausível";
  if (capacity === null || !orderOk) return { id: "capacity", ok: false, label, detail: "Não calculado: revise as leituras." };
  if (nominalCapacity === null) {
    return { id: "capacity", ok: capacity > 3, label, detail: `${liters(capacity)} (acima dos 3 L medidos).` };
  }
  const min = nominalCapacity * config.capacityRatio.min;
  const max = nominalCapacity * config.capacityRatio.max;
  return {
    id: "capacity",
    ok: capacity > 3 && capacity >= min && capacity <= max,
    label,
    detail: `${liters(capacity)} (tubo nominal: ${liters(nominalCapacity)}; aceito entre ${liters(min)} e ${liters(max)}).`,
  };
}

// ---------------------------------------------------------------------
// Conversão distância → volume (servidor e dispositivo virtual usam a mesma função)
// ---------------------------------------------------------------------

export interface VolumeModel {
  zeroDistanceMm: number;
  maximumDistanceMm: number;
  constantLitersPerMm: number;
  capacityLiters: number;
}

export interface VolumeReading {
  /** Altura da coluna acima do nível ZERO. Negativa na zona de decantação. */
  heightMm: number;
  /** Volume útil, limitado entre 0 e a capacidade. */
  volumeLiters: number;
  /** k × H sem limites — mostra quanto a leitura passou do zero ou do máximo. */
  rawVolumeLiters: number;
  fillRatio: number;
  /** Água abaixo do nível ZERO (zona de decantação, fora do volume útil). */
  belowZero: boolean;
  /** Superfície acima do nível máximo (dreno de segurança). */
  aboveMaximum: boolean;
}

/** Modelo a partir de uma calibração aceita. */
export function modelFromFit(distances: CalibrationDistances, fit: CalibrationFit): VolumeModel | null {
  if (!fit.accepted || fit.constantLitersPerMm === null || fit.effectiveCapacityLiters === null) return null;
  return {
    zeroDistanceMm: distances.zeroMm,
    maximumDistanceMm: distances.maximumMm,
    constantLitersPerMm: fit.constantLitersPerMm,
    capacityLiters: fit.effectiveCapacityLiters,
  };
}

/** Modelo a partir de uma geometria conhecida (dispositivo virtual). */
export function modelFromGeometry(geometry: { zeroDistanceMm: number; maximumDistanceMm: number; capacityLiters: number }): VolumeModel {
  return {
    ...geometry,
    constantLitersPerMm: geometry.capacityLiters / (geometry.zeroDistanceMm - geometry.maximumDistanceMm),
  };
}

/** Distância medida → altura, volume e percentual. `null` para leitura inválida ou modelo impossível. */
export function volumeFromDistance(model: VolumeModel, distanceMm: number | null | undefined): VolumeReading | null {
  if (!isValidDistance(distanceMm) || !(model.constantLitersPerMm > 0) || !(model.capacityLiters > 0)) return null;
  const heightMm = model.zeroDistanceMm - distanceMm;
  const rawVolumeLiters = model.constantLitersPerMm * heightMm;
  const volumeLiters = Math.min(model.capacityLiters, Math.max(0, rawVolumeLiters));
  return {
    heightMm,
    volumeLiters,
    rawVolumeLiters,
    fillRatio: fillRatio(volumeLiters, model.capacityLiters),
    belowZero: rawVolumeLiters < 0,
    aboveMaximum: rawVolumeLiters > model.capacityLiters,
  };
}

/** Inversa (para a simulação): volume útil → distância esperada do sensor. */
export function distanceFromVolume(model: VolumeModel, liters: number) {
  const bounded = Math.min(model.capacityLiters, Math.max(0, liters));
  return model.zeroDistanceMm - bounded / model.constantLitersPerMm;
}

/**
 * Volume efetivamente liberado a partir das distâncias antes e depois da liberação.
 * Preparação para missões: a água reutilizada vem das medições, nunca do valor pedido.
 */
export function measuredReuse(model: VolumeModel, startDistanceMm: number | null | undefined, endDistanceMm: number | null | undefined) {
  const start = volumeFromDistance(model, startDistanceMm);
  const end = volumeFromDistance(model, endDistanceMm);
  if (!start || !end) return null;
  return {
    startLiters: start.volumeLiters,
    endLiters: end.volumeLiters,
    reusedLiters: Math.max(0, start.volumeLiters - end.volumeLiters),
  };
}
