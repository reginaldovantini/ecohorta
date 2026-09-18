import { describe, expect, it } from "vitest";
import { fillRatio } from "./level-state";
import {
  distanceFromVolume,
  fitVolumeCalibration,
  measuredReuse,
  modelFromFit,
  modelFromGeometry,
  volumeFromDistance,
  type CalibrationDistances,
} from "./volume-calibration";

// Tubo DN100 com diâmetro interno de 96,8 mm: cada litro ocupa ~135,9 mm de coluna.
const INNER_DIAMETER_MM = 96.8;
const MM_PER_LITER = 1_000_000 / ((Math.PI / 4) * INNER_DIAMETER_MM ** 2);
const ZERO_MM = 1700;
const MAX_MM = 200;
const DN100 = { diameterMm: 100, usefulHeightMm: 1500 };

const at = (liters: number) => ZERO_MM - liters * MM_PER_LITER;
const ideal: CalibrationDistances = { zeroMm: ZERO_MM, oneLiterMm: at(1), twoLitersMm: at(2), threeLitersMm: at(3), maximumMm: MAX_MM };
const failed = (fit: ReturnType<typeof fitVolumeCalibration>) => fit.checks.filter((check) => !check.ok).map((check) => check.id);

describe("calibração experimental — ajuste V = k × H", () => {
  it("calcula a constante, o diâmetro efetivo e a capacidade a partir dos cinco pontos", () => {
    const fit = fitVolumeCalibration(ideal, DN100);
    expect(fit.accepted).toBe(true);
    expect(fit.quality).toBe("good");
    expect(fit.constantLitersPerMm).toBeCloseTo(1 / MM_PER_LITER, 10);
    expect(fit.effectiveDiameterMm).toBeCloseTo(INNER_DIAMETER_MM, 6);
    expect(fit.effectiveHeightMm).toBe(1500);
    expect(fit.effectiveCapacityLiters).toBeCloseTo(1500 / MM_PER_LITER, 6);
    expect(fit.maxResidualLiters).toBeCloseTo(0, 10);
    expect(fit.rSquared).toBeCloseTo(1, 10);
    expect(fit.extrapolationFactor).toBeCloseTo(1500 / (3 * MM_PER_LITER), 6);
  });

  it("usa mínimos quadrados pela origem, idêntico ao cálculo manual", () => {
    const measured: CalibrationDistances = { zeroMm: 1700, oneLiterMm: 1566, twoLitersMm: 1428, threeLitersMm: 1291, maximumMm: 200 };
    const [h1, h2, h3] = [134, 272, 409];
    const k = (h1 * 1 + h2 * 2 + h3 * 3) / (h1 ** 2 + h2 ** 2 + h3 ** 2);
    const residuals = [k * h1 - 1, k * h2 - 2, k * h3 - 3];

    const fit = fitVolumeCalibration(measured, DN100);
    expect(fit.constantLitersPerMm).toBeCloseTo(k, 12);
    expect(fit.residualsLiters![0]).toBeCloseTo(residuals[0]!, 12);
    expect(fit.residualsLiters![2]).toBeCloseTo(residuals[2]!, 12);
    expect(fit.rSquared).toBeCloseTo(1 - residuals.reduce((sum, r) => sum + r * r, 0) / 5, 12);
    expect(fit.effectiveCapacityLiters).toBeCloseTo(k * 1500, 10);
    expect(fit.stepHeightsMm).toEqual([134, 138, 137]);
    expect(fit.accepted).toBe(true);
  });

  it("aceita com qualidade 'aceitável' quando o erro fica entre os limites", () => {
    // 2º litro 7% mais alto: ainda plausível, mas não "boa".
    const fit = fitVolumeCalibration({ ...ideal, twoLitersMm: at(2) - 9, threeLitersMm: at(3) - 9 }, DN100);
    expect(fit.accepted).toBe(true);
    expect(fit.quality).toBe("acceptable");
  });

  it("sem dimensões nominais, usa limites genéricos de plausibilidade", () => {
    expect(fitVolumeCalibration(ideal).accepted).toBe(true);
  });
});

describe("calibração experimental — conversão distância → volume", () => {
  const fit = fitVolumeCalibration(ideal, DN100);
  const model = modelFromFit(ideal, fit)!;

  it.each([
    ["zero", ZERO_MM, 0],
    ["1 L", at(1), 1],
    ["2 L", at(2), 2],
    ["3 L", at(3), 3],
  ])("converte o ponto de %s no volume conhecido", (_label, distance, liters) => {
    expect(volumeFromDistance(model, distance)!.volumeLiters).toBeCloseTo(liters, 9);
  });

  it("converte o nível máximo na capacidade efetiva (100%)", () => {
    const reading = volumeFromDistance(model, MAX_MM)!;
    expect(reading.volumeLiters).toBeCloseTo(fit.effectiveCapacityLiters!, 9);
    expect(reading.fillRatio).toBeCloseTo(1, 9);
  });

  it("calcula altura, litros e percentual para uma distância qualquer", () => {
    const reading = volumeFromDistance(model, 1236)!;
    expect(reading.heightMm).toBe(464);
    expect(reading.volumeLiters).toBeCloseTo(464 / MM_PER_LITER, 9);
    expect(reading.fillRatio).toBeCloseTo(464 / 1500, 9);
    expect(reading).toMatchObject({ belowZero: false, aboveMaximum: false });
  });

  it("converte volume em percentual da capacidade efetiva", () => {
    const half = model.capacityLiters / 2;
    expect(volumeFromDistance(model, distanceFromVolume(model, half))!.fillRatio).toBeCloseTo(0.5, 9);
    expect(fillRatio(half, model.capacityLiters)).toBeCloseTo(0.5, 9);
  });

  it("sinaliza água na zona de decantação e acima do dreno, limitando o volume útil", () => {
    expect(volumeFromDistance(model, ZERO_MM + 50)).toMatchObject({ heightMm: -50, volumeLiters: 0, belowZero: true, fillRatio: 0 });
    const above = volumeFromDistance(model, MAX_MM - 20)!;
    expect(above).toMatchObject({ aboveMaximum: true, fillRatio: 1 });
    expect(above.volumeLiters).toBeCloseTo(model.capacityLiters, 9);
  });

  it("não produz volume a partir de leituras negativas, impossíveis ou ausentes", () => {
    for (const distance of [-5, 0, 10, 39, 4001, 9000, Number.NaN, Number.POSITIVE_INFINITY, null, undefined]) {
      expect(volumeFromDistance(model, distance)).toBeNull();
    }
  });

  it("usa a mesma conversão para a geometria do dispositivo virtual", () => {
    const virtual = modelFromGeometry({ zeroDistanceMm: 1589, maximumDistanceMm: 60, capacityLiters: 12 });
    expect(virtual.constantLitersPerMm).toBeCloseTo(12 / 1529, 12);
    expect(distanceFromVolume(virtual, 6)).toBeCloseTo(1589 - 764.5, 9);
    expect(volumeFromDistance(virtual, distanceFromVolume(virtual, 7.42))!.volumeLiters).toBeCloseTo(7.42, 9);
  });

  it("deriva o volume reutilizado das distâncias antes e depois da liberação", () => {
    const reuse = measuredReuse(model, distanceFromVolume(model, 8.02), distanceFromVolume(model, 5.01))!;
    expect(reuse.startLiters).toBeCloseTo(8.02, 9);
    expect(reuse.endLiters).toBeCloseTo(5.01, 9);
    expect(reuse.reusedLiters).toBeCloseTo(3.01, 9);
    expect(measuredReuse(model, 1236, null)).toBeNull();
  });

  it("não cria modelo a partir de uma calibração recusada", () => {
    const bad = { ...ideal, twoLitersMm: ideal.oneLiterMm + 5 };
    expect(modelFromFit(bad, fitVolumeCalibration(bad, DN100))).toBeNull();
  });
});

describe("calibração experimental — qualidade", () => {
  it("recusa pontos fora de ordem", () => {
    const fit = fitVolumeCalibration({ ...ideal, twoLitersMm: ideal.threeLitersMm, threeLitersMm: ideal.twoLitersMm }, DN100);
    expect(fit.accepted).toBe(false);
    expect(fit.quality).toBe("inconsistent");
    expect(failed(fit)).toContain("order");
  });

  it("recusa pontos repetidos ou muito próximos", () => {
    const fit = fitVolumeCalibration({ ...ideal, oneLiterMm: ZERO_MM - 12 }, DN100);
    expect(fit.accepted).toBe(false);
    expect(failed(fit)).toEqual(expect.arrayContaining(["spacing", "consistency"]));
  });

  it("recusa desníveis inconsistentes entre 1, 2 e 3 L", () => {
    // O 2º litro "subiu" 40 mm a mais: água medida errado em uma etapa.
    const fit = fitVolumeCalibration({ ...ideal, twoLitersMm: at(2) - 40, threeLitersMm: at(3) - 40 }, DN100);
    expect(fit.accepted).toBe(false);
    expect(failed(fit)).toContain("consistency");
  });

  it("recusa diâmetro efetivo implausível para o tubo nominal", () => {
    const wide = 60; // 60 mm por litro ≈ tubo de 146 mm
    const fit = fitVolumeCalibration(
      { zeroMm: 1700, oneLiterMm: 1700 - wide, twoLitersMm: 1700 - 2 * wide, threeLitersMm: 1700 - 3 * wide, maximumMm: 200 },
      DN100,
    );
    expect(fit.accepted).toBe(false);
    expect(failed(fit)).toEqual(expect.arrayContaining(["diameter", "capacity"]));
  });

  it("recusa nível máximo registrado cedo demais (altura e capacidade implausíveis)", () => {
    const fit = fitVolumeCalibration({ ...ideal, maximumMm: ZERO_MM - 600 }, DN100);
    expect(fit.accepted).toBe(false);
    expect(failed(fit)).toEqual(expect.arrayContaining(["height", "capacity"]));
  });

  it("recusa leituras ausentes, negativas ou fora da faixa do sensor", () => {
    expect(failed(fitVolumeCalibration({ ...ideal, zeroMm: Number.NaN }, DN100))).toContain("readings");
    expect(failed(fitVolumeCalibration({ ...ideal, maximumMm: -10 }, DN100))).toContain("readings");
    expect(failed(fitVolumeCalibration({ ...ideal, zeroMm: 5000 }, DN100))).toContain("readings");
  });

  it("não mascara dados ruins: mostra os resíduos reais e mantém a recusa", () => {
    const fit = fitVolumeCalibration({ ...ideal, threeLitersMm: at(3) - 30 }, DN100);
    expect(fit.accepted).toBe(false);
    expect(fit.constantLitersPerMm).not.toBeNull();
    expect(fit.maxResidualLiters!).toBeGreaterThan(0.08);
    expect(fit.checks.find((check) => check.id === "linearity")?.ok).toBe(false);
  });
});
