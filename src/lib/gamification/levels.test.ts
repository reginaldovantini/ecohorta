import { describe, expect, it } from "vitest";
import { getLevelProgress, LEVELS } from "./levels";

describe("getLevelProgress", () => {
  it("começa como Semente", () => {
    expect(getLevelProgress(0)).toMatchObject({ level: 1, title: "Semente", progress: 0, nextLevelXp: 100 });
  });

  it("calcula o progresso dentro do nível", () => {
    const progress = getLevelProgress(620);
    expect(progress.level).toBe(4);
    expect(progress.title).toBe("Guardião da Água");
    expect(progress.progress).toBeCloseTo(0.4);
  });

  it("sobe de nível exatamente no limite", () => {
    expect(getLevelProgress(99).level).toBe(1);
    expect(getLevelProgress(100).level).toBe(2);
  });

  it("trava no nível máximo", () => {
    const progress = getLevelProgress(99_999);
    expect(progress.level).toBe(LEVELS.length);
    expect(progress.nextLevelXp).toBeNull();
    expect(progress.progress).toBe(1);
  });

  it("ignora XP negativo", () => {
    expect(getLevelProgress(-50).xp).toBe(0);
  });
});
