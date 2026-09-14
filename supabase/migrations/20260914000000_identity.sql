-- =====================================================================
-- EcoHorta Inteligente — identidade, escola e turmas
-- RASCUNHO: ainda NÃO aplicado. Será revisado e aplicado nos Dias 6–7.
--
-- Princípio (LGPD — estudantes podem ser menores):
--   profiles        → DADOS DE EXIBIÇÃO (apelido, avatar, perfil, turma/função)
--   person_records  → DADOS CADASTRAIS (nome, sobrenome, data de nascimento)
--                     visíveis só ao próprio usuário e a professores/admin da escola
-- A idade nunca é armazenada: é calculada a partir de birth_date.
-- =====================================================================

create extension if not exists pgcrypto;

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
  name text not null check (char_length(name) between 3 and 160),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.school_classes (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  name text not null,                              -- ex.: "6º Ano C"
  education_level public.education_level not null,
  grade smallint not null check (grade between 1 and 12),
  section text not null check (char_length(section) between 1 and 8),
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
  school_id uuid not null references public.schools (id),
  role public.user_role not null,
  nickname text not null check (char_length(btrim(nickname)) between 2 and 20),
  avatar_id text not null,
  class_id uuid references public.school_classes (id),
  job_title text check (job_title is null or char_length(job_title) between 2 and 40),
  staff_sector public.staff_sector,
  status public.account_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint student_has_class check (role <> 'student' or class_id is not null),
  constraint staff_has_sector check (role <> 'staff' or staff_sector is not null)
);
create index profiles_school_idx on public.profiles (school_id);
create index profiles_class_idx on public.profiles (class_id);
create index profiles_role_idx on public.profiles (school_id, role);

-- ---------------------------------------------------------------------
-- DADOS CADASTRAIS (protegidos)
-- ---------------------------------------------------------------------

create table public.person_records (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  first_name text not null check (char_length(first_name) between 1 and 60),
  last_name text not null check (char_length(last_name) between 1 and 60),
  birth_date date check (birth_date is null or birth_date between date '1900-01-01' and current_date),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Registro do consentimento do responsável (LGPD art. 14) — sem dados do responsável.
create table public.guardian_consents (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  recorded_by uuid not null references public.profiles (id),
  consented_at timestamptz not null,
  method text not null check (method in ('termo_impresso', 'termo_digital', 'outro')),
  created_at timestamptz not null default now()
);

create trigger schools_touch before update on public.schools for each row execute function public.touch_updated_at();
create trigger school_classes_touch before update on public.school_classes for each row execute function public.touch_updated_at();
create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();
create trigger person_records_touch before update on public.person_records for each row execute function public.touch_updated_at();

-- Estudante precisa de data de nascimento (validação entre tabelas).
create or replace function public.require_student_birth_date() returns trigger
language plpgsql as $$
begin
  if new.birth_date is null and exists (
    select 1 from public.profiles p where p.id = new.profile_id and p.role = 'student'
  ) then
    raise exception 'Estudantes precisam de data de nascimento';
  end if;
  return new;
end;
$$;
create trigger person_records_student_birth_date
  before insert or update on public.person_records
  for each row execute function public.require_student_birth_date();

-- ---------------------------------------------------------------------
-- Funções auxiliares de acesso
-- ---------------------------------------------------------------------

create or replace function public.my_school_id() returns uuid
language sql stable security definer set search_path = public as $$
  select school_id from public.profiles where id = auth.uid()
$$;

create or replace function public.is_school_educator(target_school uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and school_id = target_school and role in ('teacher', 'admin') and status = 'active'
  )
$$;

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------

alter table public.schools enable row level security;
alter table public.school_classes enable row level security;
alter table public.profiles enable row level security;
alter table public.person_records enable row level security;
alter table public.guardian_consents enable row level security;

create policy "membros veem a própria escola" on public.schools
  for select to authenticated using (id = public.my_school_id());

create policy "membros veem as turmas da escola" on public.school_classes
  for select to authenticated using (school_id = public.my_school_id());

-- Dados de exibição: visíveis à comunidade da escola.
create policy "comunidade vê perfis de exibição" on public.profiles
  for select to authenticated using (school_id = public.my_school_id());

-- Cada um altera só apelido e avatar do próprio perfil (demais colunas via servidor).
create policy "usuário edita o próprio perfil" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
revoke update on public.profiles from authenticated;
grant update (nickname, avatar_id) on public.profiles to authenticated;

-- Dados cadastrais: somente o próprio usuário e educadores/admin da escola.
create policy "cadastro visível ao próprio usuário e educadores" on public.person_records
  for select to authenticated using (
    profile_id = auth.uid()
    or public.is_school_educator((select school_id from public.profiles where id = profile_id))
  );

create policy "consentimento visível a educadores" on public.guardian_consents
  for select to authenticated using (
    public.is_school_educator((select school_id from public.profiles where id = profile_id))
  );

-- Inserções de perfis e cadastros acontecem pelo servidor (chave secret), após validação.

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
left join public.person_records r on r.profile_id = p.id;
