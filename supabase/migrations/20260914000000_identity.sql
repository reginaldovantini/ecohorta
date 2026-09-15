-- =====================================================================
-- EcoHorta Inteligente — 1/2: escolas, turmas e usuários
--
-- Validada em PostgreSQL real (PGlite, nos testes automatizados) e aplicada
-- no Supabase com `npm run db:migrate`.
--
-- Princípio (LGPD — estudantes podem ser menores):
--   profiles        → DADOS DE EXIBIÇÃO (apelido, avatar, perfil, turma/função)
--   person_records  → DADOS CADASTRAIS (nome, sobrenome, data de nascimento)
--                     visíveis só ao próprio usuário e a professores/admin da escola
-- A idade nunca é armazenada: é calculada a partir de birth_date.
-- Escritas acontecem pelo servidor; usuários autenticados só leem (e editam apelido/avatar).
-- =====================================================================

create type public.user_role as enum ('student', 'teacher', 'staff', 'admin');
create type public.education_level as enum ('early_childhood', 'elementary', 'high_school', 'vocational', 'other');
create type public.staff_sector as enum (
  'secretaria', 'coordenacao', 'direcao', 'manutencao', 'biblioteca', 'laboratorio', 'apoio', 'outro'
);
create type public.account_status as enum ('pending', 'active', 'inactive');

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Escolas e turmas
-- ---------------------------------------------------------------------

create table public.schools (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(btrim(name)) between 3 and 160),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.school_classes (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 40), -- ex.: "6º Ano C"
  education_level public.education_level not null,
  grade smallint not null check (grade between 1 and 12),
  section text not null check (section ~ '^[A-Z0-9]{1,4}$'),
  school_year smallint not null check (school_year between 2020 and 2100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, school_year, education_level, grade, section)
);
create index school_classes_school_idx on public.school_classes (school_id);

-- ---------------------------------------------------------------------
-- DADOS DE EXIBIÇÃO
-- ---------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  school_id uuid not null references public.schools (id) on delete restrict,
  role public.user_role not null,
  -- Apelido e avatar são escolhidos no primeiro acesso.
  nickname text check (nickname is null or char_length(btrim(nickname)) between 2 and 20),
  avatar_id text check (avatar_id is null or avatar_id ~ '^[a-z]{2,20}$'),
  class_id uuid references public.school_classes (id) on delete restrict,
  job_title text check (job_title is null or char_length(btrim(job_title)) between 2 and 40),
  staff_sector public.staff_sector,
  -- Código de acesso do estudante (login por código + PIN). Não é exposto a usuários autenticados.
  access_code text unique check (access_code is null or access_code ~ '^[A-Z0-9]{2,4}-[A-Z0-9]{4}$'),
  status public.account_status not null default 'active',
  onboarded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint student_has_class check (role <> 'student' or class_id is not null),
  constraint student_has_access_code check (role <> 'student' or access_code is not null),
  constraint staff_has_sector check (role <> 'staff' or staff_sector is not null),
  constraint onboarded_has_identity check (onboarded_at is null or (nickname is not null and avatar_id is not null))
);
create index profiles_school_role_idx on public.profiles (school_id, role);
create index profiles_class_idx on public.profiles (class_id);

-- ---------------------------------------------------------------------
-- DADOS CADASTRAIS (protegidos)
-- ---------------------------------------------------------------------

create table public.person_records (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  first_name text not null check (char_length(btrim(first_name)) between 1 and 60),
  last_name text not null check (char_length(btrim(last_name)) between 1 and 60),
  -- Sem current_date no CHECK (não seria reavaliado): a data futura é recusada pela trigger abaixo.
  birth_date date check (birth_date is null or birth_date >= date '1900-01-01'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Consentimento do responsável (LGPD art. 14) — sem dados do responsável.
-- Se a conta de quem registrou for removida, o consentimento permanece (recorded_by vira nulo).
create table public.guardian_consents (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  recorded_by uuid references public.profiles (id) on delete set null,
  consented_at timestamptz not null,
  method text not null check (method in ('termo_impresso', 'termo_digital', 'outro')),
  created_at timestamptz not null default now()
);

create trigger schools_touch before update on public.schools for each row execute function public.touch_updated_at();
create trigger school_classes_touch before update on public.school_classes for each row execute function public.touch_updated_at();
create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();
create trigger person_records_touch before update on public.person_records for each row execute function public.touch_updated_at();

-- Validações que dependem da data atual ou de outra tabela: avaliadas no momento da escrita.
create or replace function public.validate_person_record() returns trigger
language plpgsql as $$
begin
  if new.birth_date is not null and new.birth_date > current_date then
    raise exception 'Data de nascimento no futuro' using errcode = '23514';
  end if;
  if new.birth_date is null and exists (
    select 1 from public.profiles p where p.id = new.profile_id and p.role = 'student'
  ) then
    raise exception 'Estudantes precisam de data de nascimento' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger person_records_validate
  before insert or update on public.person_records
  for each row execute function public.validate_person_record();

-- ---------------------------------------------------------------------
-- Funções auxiliares de acesso (security definer: evitam recursão no RLS)
-- ---------------------------------------------------------------------

create or replace function public.my_school_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select school_id from public.profiles where id = auth.uid() and status = 'active'
$$;

create or replace function public.is_school_educator(target_school uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and school_id = target_school and role in ('teacher', 'admin') and status = 'active'
  )
$$;

revoke execute on function public.my_school_id() from public, anon;
revoke execute on function public.is_school_educator(uuid) from public, anon;
grant execute on function public.my_school_id() to authenticated;
grant execute on function public.is_school_educator(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Row Level Security e privilégios
-- ---------------------------------------------------------------------

alter table public.schools enable row level security;
alter table public.school_classes enable row level security;
alter table public.profiles enable row level security;
alter table public.person_records enable row level security;
alter table public.guardian_consents enable row level security;

revoke all on public.schools, public.school_classes, public.profiles, public.person_records, public.guardian_consents from anon;
revoke insert, update, delete on public.schools, public.school_classes, public.person_records, public.guardian_consents from authenticated;

-- Perfis: leitura sem o código de acesso; escrita só de apelido e avatar.
revoke all on public.profiles from authenticated;
grant select (id, school_id, role, nickname, avatar_id, class_id, job_title, staff_sector, status, onboarded_at, created_at, updated_at)
  on public.profiles to authenticated;
grant update (nickname, avatar_id) on public.profiles to authenticated;

create policy "membros veem a própria escola" on public.schools
  for select to authenticated using (id = public.my_school_id());

create policy "membros veem as turmas da escola" on public.school_classes
  for select to authenticated using (school_id = public.my_school_id());

create policy "comunidade vê perfis de exibição" on public.profiles
  for select to authenticated using (school_id = public.my_school_id());

create policy "usuário edita o próprio apelido e avatar" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "cadastro visível ao próprio usuário e educadores" on public.person_records
  for select to authenticated using (
    profile_id = auth.uid()
    or public.is_school_educator((select p.school_id from public.profiles p where p.id = profile_id))
  );

create policy "consentimento visível a educadores" on public.guardian_consents
  for select to authenticated using (
    public.is_school_educator((select p.school_id from public.profiles p where p.id = profile_id))
  );

-- ---------------------------------------------------------------------
-- Indicadores autorizados por faixa etária (sem expor datas)
-- ---------------------------------------------------------------------

create or replace view public.participant_age_bands
with (security_invoker = true) as
select
  p.school_id,
  p.role,
  p.class_id,
  case
    when r.birth_date is null then 'nao_informado'
    when extract(year from age(current_date, r.birth_date)) <= 9 then 'ate-9'
    when extract(year from age(current_date, r.birth_date)) <= 12 then '10-12'
    when extract(year from age(current_date, r.birth_date)) <= 15 then '13-15'
    when extract(year from age(current_date, r.birth_date)) <= 18 then '16-18'
    else '19+'
  end as age_band,
  p.id as profile_id
from public.profiles p
join public.person_records r on r.profile_id = p.id;

revoke all on public.participant_age_bands from anon;
grant select on public.participant_age_bands to authenticated;
