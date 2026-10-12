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
}

export interface School {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
}

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

  const { rows } = await tx.query<School>(
    `insert into public.schools (name, city, state) values ($1, $2, $3)
     on conflict (name) do update set city = coalesce(excluded.city, public.schools.city),
       state = coalesce(excluded.state, public.schools.state)
     returning id, name, city, state`,
    [name, city, input.state],
  );
  return rows[0]!;
}

/** Escolas da plataforma, com quantos captadores de cada uma já medem de verdade. */
export async function listSchools(tx: Queryable): Promise<(School & { activeCollectors: number; prototypes: number })[]> {
  const { rows } = await tx.query<School & { active_collectors: number; prototypes: number }>(
    `select s.id, s.name, s.city, s.state,
            count(c.id) filter (where c.activated_at is not null and c.prefix = 'ECO')::int as active_collectors,
            count(c.id) filter (where c.prefix = 'PROTO')::int as prototypes
     from public.schools s left join public.collectors c on c.school_id = s.id
     group by s.id, s.name, s.city, s.state
     order by s.state nulls last, s.city nulls last, s.name`,
  );
  return rows.map(({ active_collectors, prototypes, ...school }) => ({
    ...school,
    activeCollectors: active_collectors,
    prototypes,
  }));
}
