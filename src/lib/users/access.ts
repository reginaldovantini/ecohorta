import { z } from "zod";

/*
 * Acesso do estudante sem e-mail pessoal: código da turma + PIN de 6 dígitos.
 * No Supabase Auth, o código vira um identificador sintético não roteável.
 */

export const ACCESS_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sem 0/O e 1/I
const ACCESS_CODE_PATTERN = /^[A-Z0-9]{2,4}-[A-Z0-9]{4}$/;

export const pinSchema = z.string().regex(/^\d{6}$/, "O PIN tem 6 dígitos.");

/** "6c k3qx", "6C-K3QX", "6ck3qx" → "6C-K3QX". Retorna null se não reconhecer. */
export function normalizeAccessCode(input: string): string | null {
  const compact = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (compact.length < 6 || compact.length > 8) return null;
  const code = `${compact.slice(0, -4)}-${compact.slice(-4)}`;
  return ACCESS_CODE_PATTERN.test(code) ? code : null;
}

/** Prefixo do código a partir da turma: 6º Ano C → "6C". */
export function accessCodePrefix(grade: number, section: string) {
  return `${grade}${section}`.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
}

export function studentEmail(accessCode: string, domain = process.env.STUDENT_EMAIL_DOMAIN || "alunos.ecohorta.invalid") {
  return `${accessCode.toLowerCase()}@${domain}`;
}
