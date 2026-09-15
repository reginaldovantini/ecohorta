import { describe, expect, it } from "vitest";
import { accessCodePrefix, normalizeAccessCode, pinSchema, studentEmail } from "./access";

describe("acesso do estudante por código + PIN", () => {
  it.each([
    ["6C-K3QX", "6C-K3QX"],
    ["6c k3qx", "6C-K3QX"],
    ["6ck3qx", "6C-K3QX"],
    ["em2a-7h9p", "EM2A-7H9P"],
  ])("normaliza %s → %s", (input, expected) => {
    expect(normalizeAccessCode(input)).toBe(expected);
  });

  it("recusa códigos malformados", () => {
    expect(normalizeAccessCode("")).toBeNull();
    expect(normalizeAccessCode("K3QX")).toBeNull();
    expect(normalizeAccessCode("ABCDEFGHIJ")).toBeNull();
  });

  it("gera prefixo pela turma e e-mail sintético não roteável", () => {
    expect(accessCodePrefix(6, "C")).toBe("6C");
    expect(studentEmail("6C-K3QX", "alunos.ecohorta.invalid")).toBe("6c-k3qx@alunos.ecohorta.invalid");
  });

  it("aceita somente PIN de 6 dígitos", () => {
    expect(pinSchema.safeParse("123456").success).toBe(true);
    expect(pinSchema.safeParse("12345").success).toBe(false);
    expect(pinSchema.safeParse("12a456").success).toBe(false);
  });
});
