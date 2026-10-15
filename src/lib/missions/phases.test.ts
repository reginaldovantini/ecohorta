import { describe, expect, it } from "vitest";
import type { MissionDefinition } from "./catalog";
import type { ExecutionRecord } from "./history";
import { currentPhase, phaseGate, PHASES } from "./phases";

/*
 * Uma fase abre quando a anterior foi cumprida. Os testes aqui guardam duas
 * coisas que, erradas, dariam na mesma tela confusa de antes: a primeira fase
 * sempre aberta (senão o estudante entra e não tem o que fazer) e o resgate
 * nunca trancado (senão o tubo transborda esperando progresso).
 */

const missao = (id: string, phase: number, category: MissionDefinition["category"] = "action"): MissionDefinition => ({
  id,
  phase,
  category,
  kind: "dispense",
  title: id,
  summary: "",
  steps: [],
  liters: 2,
  xp: 30,
  difficulty: "easy",
  durationMinutes: 5,
  location: "",
  art: "garden",
  impact: "",
});

const CATALOGO = [missao("a1", 1), missao("a2", 1), missao("b1", 2), missao("c1", 3), missao("resgate", 2, "rescue")];

const feita = (missionId: string, status: ExecutionRecord["status"] = "COMPLETED"): ExecutionRecord => ({
  executionId: `e-${missionId}`,
  missionId,
  commandId: `c-${missionId}`,
  collectorCode: "ECO-001",
  status,
  failure: null,
  targetLiters: 2,
  deliveredLiters: 2,
  xpAwarded: status === "COMPLETED" ? 30 : 0,
  startedAt: 0,
  finishedAt: 0,
  origin: "device",
});

describe("a primeira fase está sempre aberta", () => {
  it("quem acabou de entrar tem o que fazer", () => {
    expect(phaseGate(CATALOGO[0]!, [], CATALOGO)).toMatchObject({ unlocked: true, missing: 0 });
    expect(phaseGate(CATALOGO[1]!, [], CATALOGO)).toMatchObject({ unlocked: true });
  });
});

describe("a fase seguinte abre quando a anterior foi cumprida", () => {
  it("trancada enquanto falta missão, e diz quantas faltam", () => {
    expect(phaseGate(CATALOGO[2]!, [], CATALOGO)).toMatchObject({ unlocked: false, missing: 2, previousPhase: 1 });
    expect(phaseGate(CATALOGO[2]!, [feita("a1")], CATALOGO)).toMatchObject({ unlocked: false, missing: 1 });
  });

  it("cumpridas todas, abre", () => {
    const historia = [feita("a1"), feita("a2")];
    expect(phaseGate(CATALOGO[2]!, historia, CATALOGO)).toMatchObject({ unlocked: true, missing: 0 });
  });

  it("missão que falhou não abre fase: abre quem FEZ", () => {
    const historia = [feita("a1"), feita("a2", "FAILED")];
    expect(phaseGate(CATALOGO[2]!, historia, CATALOGO)).toMatchObject({ unlocked: false, missing: 1 });
  });

  it("repetir a mesma missão não abre a fase seguinte", () => {
    const historia = [feita("a1"), { ...feita("a1"), executionId: "outra" }];
    expect(phaseGate(CATALOGO[2]!, historia, CATALOGO)).toMatchObject({ unlocked: false, missing: 1 });
  });

  it("a terceira fase espera a segunda, não a primeira", () => {
    const historia = [feita("a1"), feita("a2")];
    expect(phaseGate(CATALOGO[3]!, historia, CATALOGO)).toMatchObject({ unlocked: false, missing: 1, previousPhase: 2 });
    expect(phaseGate(CATALOGO[3]!, [...historia, feita("b1")], CATALOGO)).toMatchObject({ unlocked: true });
  });
});

describe("o resgate nunca fica trancado", () => {
  it("tubo quase cheio não espera progresso", () => {
    expect(phaseGate(CATALOGO[4]!, [], CATALOGO)).toMatchObject({ unlocked: true, missing: 0 });
  });
});

describe("em que fase a pessoa está", () => {
  it("começa na primeira e avança conforme cumpre", () => {
    expect(currentPhase([], CATALOGO)).toBe(1);
    expect(currentPhase([feita("a1")], CATALOGO)).toBe(1);
    expect(currentPhase([feita("a1"), feita("a2")], CATALOGO)).toBe(2);
    expect(currentPhase([feita("a1"), feita("a2"), feita("b1")], CATALOGO)).toBe(3);
  });
});

describe("o catálogo de verdade", () => {
  it("tem fases em ordem, começando em 1", () => {
    expect(PHASES[0]).toBe(1);
    expect([...PHASES].sort((a, b) => a - b)).toEqual(PHASES);
  });
});
