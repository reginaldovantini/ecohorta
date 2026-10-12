-- =====================================================================
-- EcoHorta Inteligente — 13: quem pode administrar, e onde
--
-- Até aqui, administrar era consequência de duas coisas frágeis: a função
-- declarada no primeiro acesso (qualquer pessoa marca "Professor(a)") e uma
-- coluna booleana no perfil, escrita por script. Com cadastro aberto pelo
-- Google, isso significa que a área administrativa aparecia para quem se
-- declarasse professor — e cadastrar captador é o ato que coloca um tubo na
-- rede de uma escola.
--
-- A autorização passa a ser explícita e por E-MAIL: o administrador da
-- plataforma registra o Gmail da pessoa e a escola que ela vai administrar.
-- Por e-mail, e não por perfil, para que a autorização exista ANTES de a
-- pessoa entrar pela primeira vez — ela já chega administradora, sem a dança
-- de "entre primeiro que depois eu te promovo".
--
-- E a autoridade é LIDA daqui a cada requisição, nunca copiada para o perfil.
-- Copiada, revogar exigiria desfazer em dois lugares e sobraria gente com
-- poder esquecido. Lida ao vivo, revogar vale no toque seguinte.
-- =====================================================================

create table public.admin_grants (
  /** Gmail da pessoa, normalizado. É a chave: a autorização precede o cadastro. */
  email text primary key check (email = lower(btrim(email)) and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  /** Escola que esta pessoa administra. Nulo apenas para a administração da plataforma. */
  school_id uuid references public.schools (id) on delete restrict,
  /** Administração da plataforma: cria escolas, autoriza e-mails, vê todas as escolas. */
  platform_admin boolean not null default false,
  granted_by uuid references public.profiles (id) on delete set null,
  granted_at timestamptz not null default now(),
  /** Revogação preserva a linha: o histórico de quem teve acesso não se apaga. */
  revoked_at timestamptz,
  note text check (note is null or char_length(note) <= 200),

  -- Administrar a plataforma é acima das escolas; administrar escola exige uma.
  constraint grant_scope check (
    (platform_admin and school_id is null) or (not platform_admin and school_id is not null)
  )
);

create index admin_grants_school_idx on public.admin_grants (school_id) where revoked_at is null;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
-- Ninguém lê esta tabela pelo cliente: ela decide poder, e quem a consulta é o
-- servidor, montando o ator de cada requisição. Expor a lista entregaria quem
-- administra cada escola a qualquer pessoa autenticada.

alter table public.admin_grants enable row level security;
revoke all on public.admin_grants from anon, authenticated;
