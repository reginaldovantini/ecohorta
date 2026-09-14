import { z } from "zod";
import { AVATAR_IDS } from "./avatars";

/*
 * Modelo de usuários da EcoHorta.
 *
 * Separação obrigatória (LGPD — estudantes podem ser menores):
 *   DADOS DE EXIBIÇÃO  → apelido, avatar, perfil, turma/função.
 *                        Usados na experiência: saudação, timeline, ranking.
 *   DADOS CADASTRAIS   → nome, sobrenome, data de nascimento.
 *                        Protegidos; só na conta oficial (Supabase + RLS).
 *                        Nunca guardados no aparelho, nunca exibidos publicamente.
 */

export const USER_ROLES = ["student", "teacher", "staff", "admin"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const ROLE_LABEL: Record<UserRole, string> = {
  student: "Estudante",
  teacher: "Professor(a)",
  staff: "Funcionário(a)",
  admin: "Administrador(a)",
};

export const EDUCATION_LEVELS = ["early_childhood", "elementary", "high_school", "vocational", "other"] as const;
export type EducationLevel = (typeof EDUCATION_LEVELS)[number];

export const EDUCATION_LEVEL_LABEL: Record<EducationLevel, string> = {
  early_childhood: "Educação Infantil",
  elementary: "Ensino Fundamental",
  high_school: "Ensino Médio",
  vocational: "Educação Profissional/Técnica",
  other: "Outro",
};

export const STAFF_SECTORS = [
  "secretaria",
  "coordenacao",
  "direcao",
  "manutencao",
  "biblioteca",
  "laboratorio",
  "apoio",
  "outro",
] as const;
export type StaffSector = (typeof STAFF_SECTORS)[number];

export const STAFF_SECTOR_LABEL: Record<StaffSector, string> = {
  secretaria: "Secretaria",
  coordenacao: "Coordenação",
  direcao: "Direção",
  manutencao: "Manutenção",
  biblioteca: "Biblioteca",
  laboratorio: "Laboratório",
  apoio: "Apoio",
  outro: "Outro setor",
};

export interface School {
  id: string;
  name: string;
}

export interface SchoolClass {
  id: string;
  schoolId: string;
  /** Ex.: "6º Ano C" */
  name: string;
  educationLevel: EducationLevel;
  /** Ano/série dentro do nível. */
  grade: number;
  /** Identificação da turma (A, B, C…). */
  section: string;
}

// ---------- Dados de exibição ----------

export const nicknameSchema = z
  .string()
  .trim()
  .min(2, "Use pelo menos 2 caracteres.")
  .max(20, "Use até 20 caracteres.")
  .regex(/^[\p{L}\p{N} ._-]+$/u, "Use letras, números, espaço, ponto, hífen ou sublinhado.");

const jobTitleSchema = z.string().trim().min(2, "Informe a função.").max(40, "Use até 40 caracteres.");
const avatarIdSchema = z.enum(AVATAR_IDS);

/** Identidade de exibição. Administrador não entra pelo cadastro público. */
export const displayIdentitySchema = z.discriminatedUnion("role", [
  z.object({ role: z.literal("student"), nickname: nicknameSchema, avatarId: avatarIdSchema, classId: z.string().min(1) }),
  z.object({ role: z.literal("teacher"), nickname: nicknameSchema, avatarId: avatarIdSchema, jobTitle: jobTitleSchema }),
  z.object({
    role: z.literal("staff"),
    nickname: nicknameSchema,
    avatarId: avatarIdSchema,
    jobTitle: jobTitleSchema,
    sector: z.enum(STAFF_SECTORS),
  }),
]);

export type DisplayIdentity = z.infer<typeof displayIdentitySchema>;
export type ParticipantRole = DisplayIdentity["role"];

// ---------- Dados cadastrais (somente conta oficial) ----------

const nameSchema = z.string().trim().min(1).max(60);

export const studentRecordSchema = z.object({
  firstName: nameSchema,
  lastName: nameSchema,
  /** Armazenar a data, nunca a idade: a idade é sempre calculada. */
  birthDate: z.iso.date(),
  schoolId: z.string().min(1),
  classId: z.string().min(1),
});

export const teacherRecordSchema = z.object({
  firstName: nameSchema,
  lastName: nameSchema,
  schoolId: z.string().min(1),
  jobTitle: jobTitleSchema,
});

export const staffRecordSchema = teacherRecordSchema.extend({ sector: z.enum(STAFF_SECTORS) });

export type StudentRecord = z.infer<typeof studentRecordSchema>;
export type TeacherRecord = z.infer<typeof teacherRecordSchema>;
export type StaffRecord = z.infer<typeof staffRecordSchema>;
