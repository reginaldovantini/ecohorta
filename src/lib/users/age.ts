/*
 * Idade SEMPRE derivada da data de nascimento — nunca armazenada.
 * Usada apenas em indicadores autorizados (faixa etária), nunca exibida publicamente.
 */

export interface AgeBand {
  id: string;
  label: string;
  min: number;
  max: number;
}

export const AGE_BANDS: readonly AgeBand[] = [
  { id: "ate-9", label: "Até 9 anos", min: 0, max: 9 },
  { id: "10-12", label: "10–12 anos", min: 10, max: 12 },
  { id: "13-15", label: "13–15 anos", min: 13, max: 15 },
  { id: "16-18", label: "16–18 anos", min: 16, max: 18 },
  { id: "19+", label: "19 anos ou mais", min: 19, max: Number.POSITIVE_INFINITY },
];

/**
 * Idade em anos completos na data de referência (fuso local).
 * Nascidos em 29/02 fazem aniversário em 01/03 nos anos não bissextos.
 */
export function ageOn(birthDate: string, reference: Date = new Date()): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate);
  if (!match) throw new Error(`Data de nascimento inválida: ${birthDate}`);
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];

  const refYear = reference.getFullYear();
  const refMonth = reference.getMonth() + 1;
  const refDay = reference.getDate();

  let age = refYear - year;
  if (refMonth < month || (refMonth === month && refDay < day)) age--;
  if (age < 0) throw new Error("Data de nascimento no futuro.");
  return age;
}

export function ageBandOf(age: number): AgeBand {
  return AGE_BANDS.find((band) => age >= band.min && age <= band.max) ?? AGE_BANDS[AGE_BANDS.length - 1]!;
}
