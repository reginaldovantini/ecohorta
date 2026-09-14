import { describe, expect, it } from "vitest";
import { formatDuration, formatLiters, formatPercent, formatRelativeTime } from "./format";

describe("format", () => {
  it("formata litros no padrão brasileiro", () => {
    expect(formatLiters(7.4213)).toBe("7,42 L");
    expect(formatLiters(3, 1)).toBe("3,0 L");
  });

  it("formata percentuais inteiros", () => {
    expect(formatPercent(0.614)).toBe("61%");
    expect(formatPercent(1)).toBe("100%");
  });

  it("formata tempo relativo", () => {
    expect(formatRelativeTime(10_000, 11_000)).toBe("agora");
    expect(formatRelativeTime(0, 8_000)).toBe("há 8 s");
    expect(formatRelativeTime(0, 180_000)).toBe("há 3 min");
    expect(formatRelativeTime(0, 7_200_000)).toBe("há 2 h");
  });

  it("formata duração", () => {
    expect(formatDuration(42_000)).toBe("42 s");
    expect(formatDuration(95_000)).toBe("1 min 35 s");
    expect(formatDuration(120_000)).toBe("2 min");
  });
});
