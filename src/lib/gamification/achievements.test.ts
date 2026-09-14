import { describe, expect, it } from "vitest";
import type { ExecutionRecord } from "@/lib/student/demo-profile";
import { unlockedAchievements } from "./achievements";

let counter = 0;
function record(missionId: string, status: ExecutionRecord["status"] = "COMPLETED", deliveredLiters = 3): ExecutionRecord {
  counter++;
  return {
    executionId: `e${counter}`,
    missionId,
    commandId: `c${counter}`,
    collectorCode: "EC-001",
    status,
    targetLiters: 3,
    deliveredLiters,
    xpAwarded: status === "COMPLETED" ? 50 : 0,
    startedAt: 0,
    finishedAt: 1,
    origin: "simulation",
  };
}

describe("conquistas", () => {
  it("começa sem conquistas", () => {
    expect(unlockedAchievements([]).size).toBe(0);
  });

  it("não concede conquista por missão que falhou", () => {
    expect(unlockedAchievements([record("irrigar-horta", "FAILED", 0)]).size).toBe(0);
  });

  it("concede Primeira Gota e Primeiro Cultivo por ações reais", () => {
    expect([...unlockedAchievements([record("regar-jardim")])]).toEqual(["primeira-gota"]);
    expect(unlockedAchievements([record("irrigar-horta")]).has("primeiro-cultivo")).toBe(true);
  });

  it("concede Guardião do Dreno pela missão de resgate", () => {
    expect(unlockedAchievements([record("resgate")]).has("guardiao-do-dreno")).toBe(true);
  });

  it("soma litros medidos (inclusive cancelamentos) para Guardião da Água", () => {
    const history = [...Array.from({ length: 6 }, () => record("regar-jardim")), record("regar-jardim", "CANCELLED", 2.5)];
    const unlocked = unlockedAchievements(history);
    expect(unlocked.has("guardiao-da-agua")).toBe(true);
    expect(unlocked.has("constancia")).toBe(true);
  });
});
