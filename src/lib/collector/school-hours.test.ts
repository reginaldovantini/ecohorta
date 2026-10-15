import { describe, expect, it } from "vitest";
import { DEFAULT_SCHOOL_SCHEDULE, describeSchedule, hhmm, schoolHoursBetween, withinSchoolHours } from "./school-hours";

/*
 * O captador enche quando o ar-condicionado está ligado, e ele só está ligado
 * quando há aula. Os testes aqui guardam essa frase: um erro de fuso faria a
 * plataforma avisar de madrugada e inventar água de fim de semana.
 *
 * As datas são escritas em UTC com o deslocamento explícito, porque o teste
 * roda num servidor que pode estar em qualquer fuso — inclusive o do CI.
 */

/** Campo Grande é UTC-4: 10h UTC = 6h locais. */
const emCampoGrande = (iso: string) => new Date(iso).getTime();

describe("a escola está aberta", () => {
  it("num dia útil, dentro do turno", () => {
    // Quarta-feira, 14h locais (18h UTC).
    expect(withinSchoolHours(emCampoGrande("2026-10-14T18:00:00Z"))).toBe(true);
    // Começo do primeiro turno: 7h locais.
    expect(withinSchoolHours(emCampoGrande("2026-10-14T11:00:00Z"))).toBe(true);
  });

  it("não antes de abrir nem depois de fechar", () => {
    // 6h locais — ainda fechada.
    expect(withinSchoolHours(emCampoGrande("2026-10-14T10:00:00Z"))).toBe(false);
    // 18h locais — já fechada.
    expect(withinSchoolHours(emCampoGrande("2026-10-14T22:00:00Z"))).toBe(false);
    // 2h da manhã.
    expect(withinSchoolHours(emCampoGrande("2026-10-14T06:00:00Z"))).toBe(false);
  });

  it("não no fim de semana, nem no horário de aula", () => {
    // Sábado, 10h locais.
    expect(withinSchoolHours(emCampoGrande("2026-10-17T14:00:00Z"))).toBe(false);
    // Domingo, 14h locais.
    expect(withinSchoolHours(emCampoGrande("2026-10-18T18:00:00Z"))).toBe(false);
  });

  it("o fuso é o da escola, não o do servidor", () => {
    // 23h de terça em Campo Grande são 3h de quarta em UTC: o dia muda, e a
    // escola continua fechada. Um cálculo em UTC diria "quarta, 3h" e erraria
    // o dia; este diz "terça, 23h" e acerta a resposta.
    expect(withinSchoolHours(emCampoGrande("2026-10-15T03:00:00Z"))).toBe(false);
  });
});

describe("quanto tempo de escola aberta há num intervalo", () => {
  it("um dia letivo inteiro vale as horas do turno", () => {
    const inicio = emCampoGrande("2026-10-14T00:00:00Z"); // quarta, 20h de terça local
    const fim = emCampoGrande("2026-10-15T00:00:00Z");
    // Padrão: das 7h às 17h30 locais de quarta.
    expect(schoolHoursBetween(inicio, fim) / 3_600_000).toBeCloseTo(10.5, 1);
  });

  it("um fim de semana inteiro não vale nada: o ar-condicionado está desligado", () => {
    // Sexta 18h locais até segunda 7h locais.
    const sextaNoite = emCampoGrande("2026-10-16T22:00:00Z");
    const segundaManha = emCampoGrande("2026-10-19T11:00:00Z");
    expect(schoolHoursBetween(sextaNoite, segundaManha)).toBe(0);
  });

  it("a placa que cala na sexta à tarde conta só o resto da sexta", () => {
    // Sexta, 16h locais, até domingo 10h locais: só 1h30 de expediente.
    const sextaTarde = emCampoGrande("2026-10-16T20:00:00Z");
    const domingo = emCampoGrande("2026-10-18T14:00:00Z");
    expect(schoolHoursBetween(sextaTarde, domingo) / 3_600_000).toBeCloseTo(1.5, 1);
  });

  it("intervalo invertido ou vazio é zero, não negativo", () => {
    const agora = emCampoGrande("2026-10-14T18:00:00Z");
    expect(schoolHoursBetween(agora, agora)).toBe(0);
    expect(schoolHoursBetween(agora, agora - 3_600_000)).toBe(0);
  });
});

/*
 * O horário é de cada ar-condicionado, não da plataforma.
 *
 * A Clarinda funciona das 7h10 às 16h30; a próxima escola da rede pode ter
 * turno noturno, meio período ou sábado letivo. E numa escola grande o bloco
 * das salas e o da administração não funcionam no mesmo horário — por isso a
 * pergunta é feita no cadastro do CAPTADOR, a quem está olhando o aparelho.
 */
describe("cada captador tem o horário do ar-condicionado dele", () => {
  const clarinda = { ...DEFAULT_SCHOOL_SCHEDULE, startMinutes: hhmm(7, 10), endMinutes: hhmm(16, 30) };

  it("os minutos contam: 7h05 ainda é cedo, 7h15 já vale", () => {
    expect(withinSchoolHours(emCampoGrande("2026-10-14T11:05:00Z"), clarinda)).toBe(false);
    expect(withinSchoolHours(emCampoGrande("2026-10-14T11:15:00Z"), clarinda)).toBe(true);
  });

  it("às 16h40 o ar-condicionado já desligou", () => {
    expect(withinSchoolHours(emCampoGrande("2026-10-14T20:25:00Z"), clarinda)).toBe(true);
    expect(withinSchoolHours(emCampoGrande("2026-10-14T20:40:00Z"), clarinda)).toBe(false);
  });

  it("outro bloco pode ter sábado letivo e turno noturno", () => {
    const comNoturno = { ...DEFAULT_SCHOOL_SCHEDULE, weekdays: [1, 2, 3, 4, 5, 6], endMinutes: hhmm(22) };
    expect(withinSchoolHours(emCampoGrande("2026-10-17T14:00:00Z"), comNoturno)).toBe(true);
    expect(withinSchoolHours(emCampoGrande("2026-10-15T00:00:00Z"), comNoturno)).toBe(true);
  });
});

describe("o horário escrito como se fala", () => {
  it("diz as horas e os dias", () => {
    expect(describeSchedule({ ...DEFAULT_SCHOOL_SCHEDULE, startMinutes: hhmm(7, 10), endMinutes: hhmm(16, 30) })).toBe(
      "7h10 às 16h30, de segunda a sexta",
    );
    expect(describeSchedule(DEFAULT_SCHOOL_SCHEDULE)).toBe("7h às 17h30, de segunda a sexta");
  });
});
