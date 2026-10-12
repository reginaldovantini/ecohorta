import { describe, expect, it } from "vitest";
import { normalizeCollectorCode } from "./code";

describe("normalizeCollectorCode", () => {
  it.each([
    ["ECO-001", "ECO-001"],
    ["ECO001", "ECO-001"],
    ["eco001", "ECO-001"],
    ["eco-1", "ECO-001"],
    [" ECO 012 ", "ECO-012"],
    ["ECO-1234", "ECO-1234"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeCollectorCode(input)).toBe(expected);
  });

  it("recusa formatos desconhecidos", () => {
    expect(normalizeCollectorCode("")).toBeNull();
    expect(normalizeCollectorCode("001")).toBeNull();
    expect(normalizeCollectorCode("EC-")).toBeNull();
  });
});
