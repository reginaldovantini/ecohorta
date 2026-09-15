import { describe, expect, it } from "vitest";
import { ageBandOf, ageOn } from "./age";
import { describeIdentity } from "./display";
import { displayIdentitySchema, nicknameSchema, studentRecordSchema } from "./types";

describe("idade derivada da data de nascimento", () => {
  const on = (iso: string) => {
    const [year, month, day] = iso.split("-").map(Number);
    return new Date(year!, month! - 1, day!);
  };

  it("conta anos completos considerando o aniversário", () => {
    expect(ageOn("2012-04-15", on("2026-04-14"))).toBe(13);
    expect(ageOn("2012-04-15", on("2026-04-15"))).toBe(14);
    expect(ageOn("2012-04-15", on("2026-12-31"))).toBe(14);
  });

  it("trata nascidos em 29 de fevereiro", () => {
    expect(ageOn("2012-02-29", on("2026-02-28"))).toBe(13);
    expect(ageOn("2012-02-29", on("2026-03-01"))).toBe(14);
  });

  it("recusa datas inválidas ou futuras", () => {
    expect(() => ageOn("15/04/2012")).toThrow();
    expect(() => ageOn("2030-01-01", on("2026-01-01"))).toThrow();
  });

  it("classifica faixas etárias", () => {
    expect(ageBandOf(9).id).toBe("ate-9");
    expect(ageBandOf(12).id).toBe("10-12");
    expect(ageBandOf(13).id).toBe("13-15");
    expect(ageBandOf(18).id).toBe("16-18");
    expect(ageBandOf(40).id).toBe("19+");
  });
});

describe("identidade de exibição", () => {
  it("valida apelidos", () => {
    expect(nicknameSchema.safeParse("Jhow").success).toBe(true);
    expect(nicknameSchema.safeParse("  Ana C.  ").data).toBe("Ana C.");
    expect(nicknameSchema.safeParse("J").success).toBe(false);
    expect(nicknameSchema.safeParse("<script>").success).toBe(false);
    expect(nicknameSchema.safeParse("x".repeat(21)).success).toBe(false);
  });

  const student = { role: "student", nickname: "Jhow", avatarId: "broto", classId: "ef-6c", className: "6º Ano C", educationLevel: "elementary" };

  it("exige turma para estudante e setor para funcionário", () => {
    expect(displayIdentitySchema.safeParse(student).success).toBe(true);
    expect(displayIdentitySchema.safeParse({ role: "student", nickname: "Jhow", avatarId: "broto" }).success).toBe(false);
    expect(
      displayIdentitySchema.safeParse({ role: "staff", nickname: "Rê", avatarId: "sensor", jobTitle: "Bibliotecária" }).success,
    ).toBe(false);
    expect(displayIdentitySchema.safeParse({ ...student, avatarId: "foto" }).success).toBe(false);
  });

  it("descreve o perfil sem dados cadastrais", () => {
    expect(describeIdentity({ role: "student", nickname: "Jhow", avatarId: "broto", classId: "ef-6c", className: "6º Ano C", educationLevel: "elementary" })).toBe(
      "Estudante · 6º Ano C — Ensino Fundamental",
    );
    expect(describeIdentity({ role: "admin", nickname: "Direção", avatarId: "estrela", jobTitle: null })).toBe("Administrador(a)");
    expect(describeIdentity({ role: "staff", nickname: "Rê", avatarId: "sensor", jobTitle: "Técnica", sector: "laboratorio" })).toBe(
      "Laboratório · Técnica",
    );
  });

  it("valida o registro cadastral do estudante com data ISO", () => {
    const record = { firstName: "João", lastName: "Silva", birthDate: "2012-04-15", schoolId: "s", classId: "c" };
    expect(studentRecordSchema.safeParse(record).success).toBe(true);
    expect(studentRecordSchema.safeParse({ ...record, birthDate: "15/04/2012" }).success).toBe(false);
  });
});
