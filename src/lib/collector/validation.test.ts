import { describe, expect, it } from "vitest";
import { evaluateValidation, summarizeValidations } from "./validation";
import { distanceFromVolume, modelFromGeometry } from "./volume-calibration";

// Tubo de referência: zero a 1.700 mm, máximo a 200 mm, 11,04 L.
const model = modelFromGeometry({ zeroDistanceMm: 1700, maximumDistanceMm: 200, capacityLiters: 11.04 });
const at = (liters: number) => distanceFromVolume(model, liters);

describe("validação experimental — erro", () => {
  it("calcula erro com sinal, erro absoluto e percentuais (exemplo 5,00 L → 4,92 L)", () => {
    const result = evaluateValidation(model, at(4.92), 5)!;
    expect(result.calculatedVolumeLiters).toBeCloseTo(4.92, 3);
    expect(result.errorLiters).toBeCloseTo(-0.08, 3);
    expect(result.absoluteErrorLiters).toBeCloseTo(0.08, 3);
    expect(result.percentError).toBeCloseTo(-1.6, 3);
    expect(result.absolutePercentError).toBeCloseTo(1.6, 3);
  });

  it("segue as fórmulas |Vc − Vr| e |(Vc − Vr) ÷ Vr| × 100", () => {
    const result = evaluateValidation(model, at(8.25), 8)!;
    const vc = result.calculatedVolumeLiters;
    expect(result.absoluteErrorLiters).toBeCloseTo(Math.abs(vc - 8), 3);
    expect(result.absolutePercentError).toBeCloseTo(Math.abs((vc - 8) / 8) * 100, 2);
    expect(result.errorLiters).toBeGreaterThan(0); // sistema mostra mais água do que há
  });

  it("não calcula percentual quando o volume conhecido é zero", () => {
    const result = evaluateValidation(model, at(0.03), 0)!;
    expect(result.absoluteErrorLiters).toBeCloseTo(0.03, 3);
    expect(result).toMatchObject({ percentError: null, absolutePercentError: null });
  });

  it("usa o volume exibido (limitado à capacidade) e sinaliza leitura acima do máximo", () => {
    const result = evaluateValidation(model, 150, 11.2)!;
    expect(result.calculatedVolumeLiters).toBeCloseTo(11.04, 3);
    expect(result.rawVolumeLiters).toBeGreaterThan(11.04);
    expect(result.aboveMaximum).toBe(true);
    expect(result.errorLiters).toBeCloseTo(-0.16, 3);
  });

  it("não produz validação com leitura impossível ou volume conhecido inválido", () => {
    expect(evaluateValidation(model, -3, 5)).toBeNull();
    expect(evaluateValidation(model, 9000, 5)).toBeNull();
    expect(evaluateValidation(model, 1200, -1)).toBeNull();
    expect(evaluateValidation(model, 1200, Number.NaN)).toBeNull();
  });
});

describe("validação experimental — estatística descritiva", () => {
  it("resume viés, erro absoluto médio, maior erro e erro percentual médio, sem limite de aprovação", () => {
    const records = [evaluateValidation(model, at(4.92), 5)!, evaluateValidation(model, at(8.1), 8)!, evaluateValidation(model, at(0.02), 0)!];
    const summary = summarizeValidations(records);
    expect(summary.count).toBe(3);
    expect(summary.meanErrorLiters).toBeCloseTo((-0.08 + 0.1 + 0.02) / 3, 3);
    expect(summary.meanAbsoluteErrorLiters).toBeCloseTo((0.08 + 0.1 + 0.02) / 3, 3);
    expect(summary.maxAbsoluteErrorLiters).toBeCloseTo(0.1, 3);
    expect(summary.meanAbsolutePercentError).toBeCloseTo((1.6 + 1.25) / 2, 2); // o registro de 0 L fica fora
    expect(Object.keys(summary)).not.toContain("approved");
  });

  it("retorna vazio sem registros", () => {
    expect(summarizeValidations([])).toEqual({
      count: 0,
      meanErrorLiters: null,
      meanAbsoluteErrorLiters: null,
      maxAbsoluteErrorLiters: null,
      meanAbsolutePercentError: null,
    });
  });
});
