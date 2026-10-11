import { z } from "zod";
import { AVATAR_IDS } from "./avatars";

/*
 * Modelo de usuários da EcoHorta.
 *
 * O cadastro é ABERTO: a pessoa entra pelo Google (ou e-mail), declara a função
 * e completa o perfil. A função declarada é DADO DE EXIBIÇÃO — não concede poder
 * nenhum. Quem pode calibrar e configurar um captador é o RESPONSÁVEL por ele,
 * e isso se ganha digitando o código impresso dentro da caixa eletrônica
 * (supabase/migrations/20261010120000_open_signup_and_collector_qr.sql).
 *
 * Separação obrigatória (LGPD — estudantes são menores):
 *   DADOS DE EXIBIÇÃO  → apelido, avatar, função, ano/fase.
 *                        Usados na saudação, na timeline e no ranking.
 *   DADOS CADASTRAIS   → nome, sexo, data de nascimento.
 *                        Protegidos no banco (RLS); nunca exibidos a outra pessoa.
 * A idade nunca é armazenada: é sempre calculada a partir de birth_date.
 */

export const USER_ROLES = ["student", "teacher", "staff", "admin"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const ROLE_LABEL: Record<UserRole, string> = {
  student: "Estudante",
  teacher: "Professor(a)",
  staff: "Funcionário(a)",
  admin: "Administrador(a)",
};

/**
 * Funções que a própria pessoa escolhe no primeiro acesso.
 * `admin` fica de fora de propósito: administração nunca é autoatribuível.
 */
export const SELF_DECLARED_ROLES = ["student", "teacher", "staff"] as const;
export type SelfDeclaredRole = (typeof SELF_DECLARED_ROLES)[number];

/** Ano/fase do estudante. Substitui as turmas (6º Ano C): não há mais seção A/B/C. */
export const GRADE_PHASES = ["ano_9", "ano_1", "ano_2", "ano_3"] as const;
export type GradePhase = (typeof GRADE_PHASES)[number];

export const GRADE_PHASE_LABEL: Record<GradePhase, string> = {
  ano_9: "9º Ano",
  ano_1: "1º Ano",
  ano_2: "2º Ano",
  ano_3: "3º Ano",
};

export const SEXES = ["masculino", "feminino"] as const;
export type Sex = (typeof SEXES)[number];

export const SEX_LABEL: Record<Sex, string> = {
  masculino: "Masculino",
  feminino: "Feminino",
};

/** Complemento opcional do perfil de funcionário. Não é pedido no primeiro acesso. */
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

// ---------- Dados de exibição ----------

export const nicknameSchema = z
  .string()
  .trim()
  .min(2, "Use pelo menos 2 caracteres.")
  .max(20, "Use até 20 caracteres.")
  .regex(/^[\p{L}\p{N} ._-]+$/u, "Use letras, números, espaço, ponto, hífen ou sublinhado.");

const jobTitleSchema = z.string().trim().min(2, "Informe a função.").max(40, "Use até 40 caracteres.");
export const avatarIdSchema = z.enum(AVATAR_IDS);

/** Identidade de exibição completa, montada pelo servidor a partir do banco. */
export const displayIdentitySchema = z.discriminatedUnion("role", [
  z.object({
    role: z.literal("student"),
    nickname: nicknameSchema,
    avatarId: avatarIdSchema,
    gradePhase: z.enum(GRADE_PHASES),
  }),
  z.object({ role: z.literal("teacher"), nickname: nicknameSchema, avatarId: avatarIdSchema, jobTitle: jobTitleSchema.nullable() }),
  z.object({
    role: z.literal("staff"),
    nickname: nicknameSchema,
    avatarId: avatarIdSchema,
    jobTitle: jobTitleSchema.nullable(),
    sector: z.enum(STAFF_SECTORS).nullable(),
  }),
  z.object({ role: z.literal("admin"), nickname: nicknameSchema, avatarId: avatarIdSchema, jobTitle: jobTitleSchema.nullable() }),
]);

export type DisplayIdentity = z.infer<typeof displayIdentitySchema>;
export type ParticipantRole = DisplayIdentity["role"];

/** O que o próprio usuário pode alterar depois: apelido e avatar. */
export const identityUpdateSchema = z.object({ nickname: nicknameSchema, avatarId: avatarIdSchema });

// ---------- Primeiro acesso ----------

/**
 * Tudo o que o app pede no primeiro acesso, depois do login.
 * Ninguém digita e-mail: ele vem do provedor. Ninguém escolhe escola:
 * ela vem do captador, na primeira leitura de QR.
 */
export const onboardingSchema = z
  .object({
    /** Primeiro nome OU apelido — é o mesmo campo, e vira o nome de exibição. */
    name: nicknameSchema,
    sex: z.enum(SEXES),
    /** Guardar a data, nunca a idade: a idade é sempre calculada. */
    birthDate: z.iso.date(),
    role: z.enum(SELF_DECLARED_ROLES),
    /** Só para estudante; ignorado nas demais funções. */
    gradePhase: z.enum(GRADE_PHASES).nullable().optional(),
    avatarId: avatarIdSchema,
  })
  .refine((value) => value.role !== "student" || value.gradePhase != null, {
    message: "Escolha o ano/fase.",
    path: ["gradePhase"],
  });

export type OnboardingInput = z.infer<typeof onboardingSchema>;

// ---------- Dados cadastrais (somente no banco, protegidos) ----------

export const personRecordSchema = z.object({
  /** Primeiro nome, quando informado. Sobrenome não é coletado. */
  firstName: z.string().trim().min(1).max(60).nullable(),
  sex: z.enum(SEXES).nullable(),
  birthDate: z.iso.date().nullable(),
});

export type PersonRecord = z.infer<typeof personRecordSchema>;
