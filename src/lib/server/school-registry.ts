import type { SchoolSchedule } from "@/lib/collector/school-hours";
import type { Queryable } from "./db/types";

/*
 * ESCOLAS — nascem junto do primeiro captador delas.
 *
 * Uma escola sem captador não tem o que fazer na plataforma: não há missão, não
 * há impacto, não há ranking. Por isso não existe "cadastrar escola" como tela
 * própria: a escola entra quando a administração cadastra o captador dela, e é
 * esse cadastro que carrega o município e o estado.
 *
 * Município e estado não são enfeite de formulário. São o que permite dizer
 * "27 captadores em 9 municípios" em vez de contar tubos, e é assim que uma
 * escola encontra a escola vizinha que já montou um.
 */

/** Siglas das 26 unidades federativas e do Distrito Federal. */
export const UF_LIST = [
  "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA", "PB", "PE",
  "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO",
] as const;
export type Uf = (typeof UF_LIST)[number];

export const isUf = (value: unknown): value is Uf => typeof value === "string" && (UF_LIST as readonly string[]).includes(value);

export interface SchoolInput {
  name: string;
  city: string;
  state: Uf;
  /**
   * Estudantes matriculados na unidade. Opcional: escola cadastrada antes desta
   * coluna continua válida, e a tela pede o número quando falta.
   */
  enrolledStudents?: number | null;
}

export interface School {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  enrolledStudents: number | null;
  /**
   * Horário de funcionamento da escola.
   *
   * Serve de PADRÃO para os captadores da escola: cada um herda este horário no
   * cadastro e pode ter o seu, porque a água vem de um ar-condicionado
   * específico — numa escola grande o bloco das salas e o da administração não
   * ligam no mesmo horário.
   *
   * Para que serve: estimar o nível enquanto o captador está sem internet. Sem
   * isso, a placa que cala na sexta às 17h voltaria no domingo "estimando" dois
   * dias de entrada num tubo onde não caiu uma gota.
   */
  schedule: SchoolSchedule;
}

/**
 * Quantos estudantes a escola tem.
 *
 * É o denominador do único indicador que uma secretaria de educação pergunta
 * primeiro: não "quantas missões aconteceram", mas "que parte da escola isso
 * alcançou". Sem ele, 280 missões podem ser a escola inteira ou uma turma.
 */
export function parseEnrolledStudents(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const numero = typeof value === "number" ? value : Number(String(value).replace(/\D/g, ""));
  if (!Number.isInteger(numero) || numero < 1 || numero > 200_000) {
    throw new Error("Informe quantos estudantes a escola tem matriculados.");
  }
  return numero;
}

interface SchoolRow {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  enrolled_students: number | null;
  time_zone: string;
  school_weekdays: number[];
  school_start_minutes: number;
  school_end_minutes: number;
}

/** Colunas do horário, iguais em toda consulta de escola. */
export const SCHOOL_HOURS_COLUMNS = "time_zone, school_weekdays, school_start_minutes, school_end_minutes";

export const toSchedule = (row: Pick<SchoolRow, "time_zone" | "school_weekdays" | "school_start_minutes" | "school_end_minutes">): SchoolSchedule => ({
  timeZone: row.time_zone,
  weekdays: row.school_weekdays.map(Number),
  startMinutes: Number(row.school_start_minutes),
  endMinutes: Number(row.school_end_minutes),
});

const toSchool = (row: SchoolRow): School => ({
  id: row.id,
  name: row.name,
  city: row.city,
  state: row.state,
  enrolledStudents: row.enrolled_students,
  schedule: toSchedule(row),
});

/**
 * Cadastra a escola, ou completa o que faltava nela.
 *
 * O nome é único no banco, então cadastrar a mesma escola duas vezes devolve a
 * mesma linha — e aproveita para preencher município e estado, que as escolas
 * cadastradas antes desta regra não têm.
 */
export async function registerSchool(tx: Queryable, input: SchoolInput): Promise<School> {
  const name = input.name.trim();
  const city = input.city.trim();
  if (name.length < 3) throw new Error("Informe o nome da escola.");
  if (city.length < 2) throw new Error("Informe o município da escola.");
  if (!isUf(input.state)) throw new Error("Informe o estado (sigla de duas letras).");

  const { rows } = await tx.query<SchoolRow>(
    `insert into public.schools (name, city, state, enrolled_students) values ($1, $2, $3, $4)
     on conflict (name) do update set city = coalesce(excluded.city, public.schools.city),
       state = coalesce(excluded.state, public.schools.state),
       enrolled_students = coalesce(excluded.enrolled_students, public.schools.enrolled_students)
     returning id, name, city, state, enrolled_students, time_zone, school_weekdays, school_start_minutes, school_end_minutes`,
    [name, city, input.state, input.enrolledStudents ?? null],
  );
  return toSchool(rows[0]!);
}

/**
 * Registra quantos estudantes a escola tem.
 *
 * Separado de `updateSchool` por causa de quem pode fazer cada coisa: município
 * e estado são da administração da plataforma, para o indicador não nascer com
 * três grafias da mesma cidade. O número de matriculados é o contrário — só a
 * própria escola sabe, muda todo ano, e pedir à plataforma seria garantir que
 * fique desatualizado.
 */
export async function setEnrolledStudents(tx: Queryable, schoolId: string, enrolledStudents: number): Promise<void> {
  if (!Number.isInteger(enrolledStudents) || enrolledStudents < 1 || enrolledStudents > 200_000) {
    throw new Error("Informe quantos estudantes a escola tem matriculados.");
  }
  await tx.query("update public.schools set enrolled_students = $2 where id = $1", [schoolId, enrolledStudents]);
}

/** Escolas da plataforma, com quantos captadores de cada uma já medem de verdade. */
export async function listSchools(tx: Queryable): Promise<(School & { activeCollectors: number; prototypes: number })[]> {
  const { rows } = await tx.query<SchoolRow & { active_collectors: number; prototypes: number }>(
    `select s.id, s.name, s.city, s.state, s.enrolled_students,
            s.time_zone, s.school_weekdays, s.school_start_minutes, s.school_end_minutes,
            count(c.id) filter (where c.activated_at is not null and c.prefix = 'ECO')::int as active_collectors,
            count(c.id) filter (where c.prefix = 'PROTO')::int as prototypes
     from public.schools s left join public.collectors c on c.school_id = s.id
     group by s.id, s.name, s.city, s.state, s.enrolled_students
     order by s.state nulls last, s.city nulls last, s.name`,
  );
  return rows.map(({ active_collectors, prototypes, ...school }) => ({
    ...toSchool(school),
    activeCollectors: active_collectors,
    prototypes,
  }));
}

/**
 * Corrige os dados de uma escola.
 *
 * Existe porque escola cadastrada antes desta tela — ou digitada com pressa —
 * fica sem município, e sem município o indicador de replicabilidade não fecha.
 * O nome também muda: escola trocar de nome é coisa que acontece, e forçar a
 * criação de uma segunda faria os captadores ficarem na antiga.
 */
export async function updateSchool(tx: Queryable, id: string, input: SchoolInput): Promise<School> {
  const name = input.name.trim();
  const city = input.city.trim();
  if (name.length < 3) throw new Error("Informe o nome da escola.");
  if (city.length < 2) throw new Error("Informe o município da escola.");
  if (!isUf(input.state)) throw new Error("Informe o estado (sigla de duas letras).");

  const { rows } = await tx.query<SchoolRow>(
    `update public.schools set name = $2, city = $3, state = $4,
       enrolled_students = coalesce($5, enrolled_students)
     where id = $1 returning id, name, city, state, enrolled_students, time_zone, school_weekdays, school_start_minutes, school_end_minutes`,
    [id, name, city, input.state, input.enrolledStudents ?? null],
  );
  const escola = rows[0];
  if (!escola) throw new Error("Escola não encontrada.");
  return toSchool(escola);
}
