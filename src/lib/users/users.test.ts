import { describe, expect, it } from "vitest";
import { ageBandOf, ageOn } from "./age";
import { describeIdentity } from "./display";
import { displayIdentitySchema, nicknameSchema, onboardingSchema, personRecordSchema, SELF_DECLARED_ROLES } from "./types";

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

  const student = { role: "student", nickname: "Jhow", avatarId: "broto", gradePhase: "ano_9" };

  it("exige ano/fase para estudante", () => {
    expect(displayIdentitySchema.safeParse(student).success).toBe(true);
    expect(displayIdentitySchema.safeParse({ role: "student", nickname: "Jhow", avatarId: "broto" }).success).toBe(false);
    expect(displayIdentitySchema.safeParse({ ...student, gradePhase: "ano_7" }).success).toBe(false);
    expect(displayIdentitySchema.safeParse({ ...student, avatarId: "foto" }).success).toBe(false);
  });

  it("funcionário não precisa mais de setor: o cadastro aberto pede só a função", () => {
    expect(displayIdentitySchema.safeParse({ role: "staff", nickname: "Rê", avatarId: "sensor", jobTitle: null, sector: null }).success).toBe(true);
  });

  it("descreve o perfil sem dados cadastrais", () => {
    expect(describeIdentity({ role: "student", nickname: "Jhow", avatarId: "broto", gradePhase: "ano_1" })).toBe("Estudante · 1º Ano");
    expect(describeIdentity({ role: "admin", nickname: "Direção", avatarId: "estrela", jobTitle: null })).toBe("Administrador(a)");
    expect(describeIdentity({ role: "teacher", nickname: "Rê", avatarId: "cientista", jobTitle: null })).toBe("Professor(a)");
    expect(describeIdentity({ role: "staff", nickname: "Lia", avatarId: "sensor", jobTitle: "Técnica", sector: "laboratorio" })).toBe("Laboratório");
  });
});

describe("primeiro acesso", () => {
  // O aceite dos termos entra na base: sem ele nenhum cadastro passa, e os
  // testes das outras regras ficariam todos falhando pelo mesmo motivo.
  const base = { name: "Jhow", sex: "masculino", birthDate: "2010-04-15", avatarId: "broto", acceptedTerms: true } as const;

  it("aceita o cadastro mínimo de estudante", () => {
    expect(onboardingSchema.safeParse({ ...base, role: "student", gradePhase: "ano_9" }).success).toBe(true);
  });

  it("exige o ano/fase de quem declara ser estudante", () => {
    const parsed = onboardingSchema.safeParse({ ...base, role: "student" });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toBe("Escolha o ano/fase.");
  });

  it("não pede ano/fase de professor nem de funcionário", () => {
    expect(onboardingSchema.safeParse({ ...base, role: "teacher" }).success).toBe(true);
    expect(onboardingSchema.safeParse({ ...base, role: "staff" }).success).toBe(true);
  });

  it("administração NÃO é autoatribuível no primeiro acesso", () => {
    expect(onboardingSchema.safeParse({ ...base, role: "admin" }).success).toBe(false);
    expect(SELF_DECLARED_ROLES).not.toContain("admin");
  });

  /*
   * O aceite é a condição de entrada, e a autorização de imagem não é.
   *
   * Juntar as duas faria o estudante cujo responsável não quer a foto no mural
   * ficar sem plataforma — por um motivo que não tem nada a ver com água.
   */
  it("sem aceitar os termos, o cadastro não passa", () => {
    expect(onboardingSchema.safeParse({ ...base, role: "teacher", acceptedTerms: false }).success).toBe(false);
    const semAceite = { ...base, acceptedTerms: undefined };
    expect(onboardingSchema.safeParse({ ...semAceite, role: "teacher" }).success).toBe(false);
  });

  it("a autorização de imagem é opcional, e o padrão é NÃO autorizar", () => {
    const parsed = onboardingSchema.safeParse({ ...base, role: "teacher" });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.imageConsent).toBe(false);
    expect(onboardingSchema.safeParse({ ...base, role: "teacher", imageConsent: true }).data?.imageConsent).toBe(true);
  });

  it("exige sexo e data de nascimento em formato ISO", () => {
    expect(onboardingSchema.safeParse({ ...base, role: "teacher", sex: undefined }).success).toBe(false);
    expect(onboardingSchema.safeParse({ ...base, role: "teacher", birthDate: "15/04/2010" }).success).toBe(false);
  });
});

describe("dados cadastrais", () => {
  it("guarda só primeiro nome, sexo e nascimento — sobrenome não é coletado", () => {
    expect(personRecordSchema.safeParse({ firstName: "João", sex: "masculino", birthDate: "2010-04-15" }).success).toBe(true);
    expect(personRecordSchema.safeParse({ firstName: null, sex: null, birthDate: null }).success).toBe(true);
    expect(personRecordSchema.safeParse({ firstName: "João", sex: "masculino", birthDate: "15/04/2010" }).success).toBe(false);
  });
});
