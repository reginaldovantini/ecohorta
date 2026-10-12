-- =====================================================================
-- EcoHorta Inteligente — 15: quem quer construir um captador
--
-- A plataforma só cresce se outra escola montar um tubo. Até aqui, entrar na
-- rede dependia de o administrador da plataforma conhecer a pessoa e digitar
-- o e-mail dela — o que funciona para a primeira escola e trava na terceira.
--
-- Esta tabela é a porta da frente: um professor preenche quem é, qual escola e
-- onde fica, e o pedido aparece na mesa de controle. Aprovar cria a escola e a
-- autorização de uma vez, porque separar as duas coisas só criaria a chance de
-- autorizar alguém para uma escola que ninguém cadastrou.
--
-- O pedido NÃO dá acesso a nada. Ele é um recado com formulário; quem abre a
-- porta continua sendo uma pessoa decidindo.
-- =====================================================================

create type public.partnership_status as enum ('pending', 'approved', 'declined');

create table public.partnership_requests (
  id uuid primary key default gen_random_uuid(),
  /** Nome de quem vai conduzir a construção na escola. */
  name text not null check (char_length(btrim(name)) between 2 and 80),
  /** E-mail Google: é por ele que a autorização é concedida depois. */
  email text not null check (email = lower(btrim(email)) and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  /** Função na escola, como a pessoa se descreve. */
  job_title text check (job_title is null or char_length(btrim(job_title)) <= 60),
  school_name text not null check (char_length(btrim(school_name)) between 3 and 120),
  city text not null check (char_length(btrim(city)) between 2 and 80),
  state char(2) not null check (state ~ '^[A-Z]{2}$'),
  message text check (message is null or char_length(message) <= 600),

  status public.partnership_status not null default 'pending',
  created_at timestamptz not null default now(),
  handled_by uuid references public.profiles (id) on delete set null,
  handled_at timestamptz,
  /** Escola criada ao aprovar: liga o pedido ao que ele virou. */
  school_id uuid references public.schools (id) on delete set null,

  constraint handled_has_date check (status = 'pending' or handled_at is not null)
);

-- Um pedido em aberto por e-mail: dois formulários da mesma pessoa só geram
-- dúvida sobre qual responder.
create unique index partnership_pending_email_idx on public.partnership_requests (email) where status = 'pending';
create index partnership_status_idx on public.partnership_requests (status, created_at desc);
create index partnership_handled_by_idx on public.partnership_requests (handled_by);
create index partnership_school_idx on public.partnership_requests (school_id);

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
-- Ninguém lê nem escreve pelo cliente. A inscrição chega por uma rota pública
-- do servidor, que valida antes de gravar; a leitura é da administração da
-- plataforma. Expor a tabela entregaria nome, e-mail e escola de cada pessoa
-- que se candidatou.

alter table public.partnership_requests enable row level security;
revoke all on public.partnership_requests from anon, authenticated;
