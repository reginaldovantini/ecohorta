import { describe, expect, it } from "vitest";
import { normalizeCollectorCode } from "./code";

describe("normalizeCollectorCode", () => {
  it.each([
    ["EC-001", "EC-001"],
    ["EC001", "EC-001"],
    ["ec001", "EC-001"],
    ["ec-1", "EC-001"],
    [" EC 012 ", "EC-012"],
    ["EC-1234", "EC-1234"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeCollectorCode(input)).toBe(expected);
  });

  it("recusa formatos desconhecidos", () => {
    expect(normalizeCollectorCode("")).toBeNull();
    expect(normalizeCollectorCode("001")).toBeNull();
    expect(normalizeCollectorCode("EC-")).toBeNull();
  });
});
