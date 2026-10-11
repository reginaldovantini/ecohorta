-- =====================================================================
-- EcoHorta Inteligente — 7: cadastro aberto, ano/fase e captadores com QR
--
-- MUDANÇA DE MODELO. Antes: contas criadas por script, estudante entrava por
-- código + PIN, e quem tinha role 'teacher' mandava na escola inteira.
-- Agora:
--   1. Qualquer pessoa entra (Google ou e-mail), declara a função e completa o
--      perfil. A função declarada é DADO DE EXIBIÇÃO: não concede poder nenhum.
--   2. O vínculo com a escola vem do CAPTADOR: a escola é definida no cadastro
--      do captador, e a pessoa entra na escola ao ler o QR do tubo. Cadastrar
--      captador é operação de ADMINISTRAÇÃO: não existe no app do usuário, e a
--      escrita em `collectors` continua negada a todo usuário autenticado — só
--      o servidor escreve, e só depois de conferir que quem pediu é admin.
--   3. Agir sobre um captador exige presença física:
--      - QR público, colado no tubo        → liberar missão naquele captador
--      - código de responsável, impresso
--        DENTRO da caixa eletrônica        → calibrar, bancada, ligações
--      Quem abre a caixa tem a chave. A autorização é física, não uma senha
--      distribuída nem uma fila de aprovação.
--   4. Turmas (A, B, C) deixam de existir. Fica só o ano/fase do estudante.
--
-- Por isso `is_school_educator()` muda de significado: deixa de perguntar
-- "declarou ser professor?" e passa a perguntar "é responsável por um captador
-- desta escola?". Todas as políticas que já a usavam seguem valendo, agora com
-- a semântica correta.
-- =====================================================================

create type public.grade_phase as enum ('ano_9', 'ano_1', 'ano_2', 'ano_3');
create type public.sex as enum ('masculino', 'feminino');

-- ---------------------------------------------------------------------
-- 1. Perfis: sem turma, sem código de acesso, escola vinda do captador
-- ---------------------------------------------------------------------

-- A view depende de class_id: recriada no fim com o ano/fase.
drop view if exists public.participant_age_bands;

alter table public.profiles
  drop constraint student_has_class,
  drop constraint student_has_access_code,
  -- O cadastro novo pede só função: setor e cargo viram complementos opcionais do perfil.
  drop constraint staff_has_sector,
  drop constraint onboarded_has_identity;

alter table public.profiles
  drop column class_id,
  drop column access_code,
  -- Sem escola até ler o QR de um captador. Até lá a pessoa não vê dado de escola nenhuma.
  alter column school_id drop not null,
  -- Função declarada no primeiro acesso. 'student' é o padrão seguro: é o papel
  -- sem privilégio, então um cadastro interrompido no meio nunca vira educador.
  alter column role set default 'student',
  add column grade_phase public.grade_phase,
  -- Administração da PLATAFORMA (dona do projeto), acima das escolas: cria escolas e
  -- cadastra captadores de qualquer escola. Nunca autoatribuível — só o script de
  -- administração marca esta coluna, que não é concedida a usuário autenticado nenhum.
  add column platform_admin boolean not null default false;

alter table public.profiles
  add constraint student_has_grade_phase check (role <> 'student' or onboarded_at is null or grade_phase is not null),
  add constraint grade_phase_only_for_students check (grade_phase is null or role = 'student'),
  add constraint onboarded_has_identity check (onboarded_at is null or (nickname is not null and avatar_id is not null));

drop table public.school_classes;
drop type public.education_level;

-- ---------------------------------------------------------------------
-- 2. Dados cadastrais: só o essencial
-- ---------------------------------------------------------------------
-- Primeiro nome OU apelido, sexo e data de nascimento. Sobrenome deixa de ser
-- coletado: menos dado pessoal de menor guardado, menos superfície sob a LGPD.

alter table public.person_records
  drop column last_name,
  alter column first_name drop not null,
  add column sex public.sex;

create or replace function public.validate_person_record() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.birth_date is not null and new.birth_date > current_date then
    raise exception 'Data de nascimento no futuro' using errcode = '23514';
  end if;
  -- Estudante precisa de data de nascimento (faixa etária) e sexo (indicadores).
  if exists (select 1 from public.profiles p where p.id = new.profile_id and p.role = 'student' and p.onboarded_at is not null) then
    if new.birth_date is null then
      raise exception 'Estudantes precisam de data de nascimento' using errcode = '23514';
    end if;
    if new.sex is null then
      raise exception 'Estudantes precisam de sexo informado' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 3. Captadores: cadastro individual, QR público e código de responsável
-- ---------------------------------------------------------------------

-- Escalar significa várias escolas, e duas escolas podem chamar o tubo delas de
-- EC-001. O código deixa de ser único no sistema e passa a ser único por escola;
-- quem identifica um captador sem ambiguidade é o id ou o token do QR.
alter table public.collectors drop constraint collectors_code_key;
alter table public.collectors add constraint collectors_code_unique_per_school unique (school_id, code);

-- O código NÃO é digitado: é sequencial dentro da escola (EC-001, EC-002, ...).
-- Guardar o número em vez de deduzi-lo do texto torna a sequência um fato do dado:
-- ela não se repete nem volta atrás, mesmo que um captador seja desativado.
alter table public.collectors
  add column seq integer not null default 1 check (seq between 1 and 999);
alter table public.collectors add constraint collectors_seq_unique_per_school unique (school_id, seq);

alter table public.collectors
  -- Token do QR colado no tubo. Aleatório, não o código EC-001 (que é adivinhável).
  -- gen_random_uuid() é nativo do PostgreSQL; gen_random_bytes() exigiria a extensão
  -- pgcrypto, que existe no Supabase mas não no PostgreSQL dos testes. O servidor
  -- gera o token de qualquer forma: este default é só a rede de segurança.
  add column qr_token text not null default replace(gen_random_uuid()::text, '-', '')
    check (qr_token ~ '^[0-9a-f]{32}$'),
  -- Hash do código impresso DENTRO da caixa eletrônica. O código em claro nunca
  -- é guardado, como já acontece com o token dos dispositivos.
  add column steward_code_hash text check (steward_code_hash is null or char_length(steward_code_hash) between 32 and 128),
  add column active boolean not null default true,
  add column created_by uuid references public.profiles (id) on delete set null;

create unique index collectors_qr_token_unique on public.collectors (qr_token);
-- collectors_school_idx já existe (migration de auditoria): este é o parcial, só dos ativos.
create index collectors_active_school_idx on public.collectors (school_id) where active;
create index collectors_created_by_idx on public.collectors (created_by);

-- Responsáveis por captador: quem digitou o código da caixa eletrônica.
-- É isto, e não a função declarada, que concede calibração, bancada e ligações.
create table public.collector_stewards (
  collector_id uuid not null references public.collectors (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  granted_at timestamptz not null default now(),
  primary key (collector_id, profile_id)
);
create index collector_stewards_profile_idx on public.collector_stewards (profile_id);

-- Prova de presença: cada leitura do QR do tubo fica registrada.
create table public.collector_scans (
  id uuid primary key default gen_random_uuid(),
  collector_id uuid not null references public.collectors (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  scanned_at timestamptz not null default now()
);
create index collector_scans_profile_idx on public.collector_scans (profile_id, scanned_at desc);
create index collector_scans_collector_idx on public.collector_scans (collector_id, scanned_at desc);

-- Toda missão nasce de uma leitura de QR: sem presença no tubo, sem água.
alter table public.device_commands
  add column scan_id uuid references public.collector_scans (id) on delete set null;
alter table public.mission_executions
  add column scan_id uuid references public.collector_scans (id) on delete set null;
-- Uma leitura autoriza UMA liberação. Sem isto, ler o QR uma vez abriria a válvula
-- quantas vezes a pessoa quisesse, de qualquer lugar — que é justamente o que o QR evita.
create unique index device_commands_scan_unique on public.device_commands (scan_id) where scan_id is not null;
create index mission_executions_scan_idx on public.mission_executions (scan_id);

-- ---------------------------------------------------------------------
-- 4. Poder de educador = ser responsável por um captador
-- ---------------------------------------------------------------------
-- A função declarada no cadastro não entra nesta conta. Só 'admin' (criado pelo
-- script de administração, nunca autoatribuível) e os responsáveis por captador.

/** Administração da plataforma: acima das escolas, marcada só pelo script de administração. */
create or replace function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and platform_admin and status = 'active'
  )
$$;

revoke execute on function public.is_platform_admin() from public, anon;
grant execute on function public.is_platform_admin() to authenticated;

create or replace function public.is_school_educator(target_school uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_platform_admin() or (target_school is not null and (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and school_id = target_school and role = 'admin' and status = 'active'
    )
    or exists (
      select 1
      from public.collector_stewards s
      join public.collectors c on c.id = s.collector_id
      join public.profiles p on p.id = s.profile_id
      where s.profile_id = auth.uid() and c.school_id = target_school and p.status = 'active'
    )
  ))
$$;

/** Responsável por um captador específico (calibração, bancada, ligações). */
create or replace function public.is_collector_steward(target_collector uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_platform_admin()
  or exists (
    select 1
    from public.collector_stewards s
    join public.profiles p on p.id = s.profile_id
    where s.collector_id = target_collector and s.profile_id = auth.uid() and p.status = 'active'
  )
  or exists (
    select 1
    from public.profiles p
    join public.collectors c on c.school_id = p.school_id
    where p.id = auth.uid() and c.id = target_collector and p.role = 'admin' and p.status = 'active'
  )
$$;

revoke execute on function public.is_collector_steward(uuid) from public, anon;
grant execute on function public.is_collector_steward(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 5. RLS das tabelas novas
-- ---------------------------------------------------------------------

alter table public.collector_stewards enable row level security;
alter table public.collector_scans enable row level security;

revoke all on public.collector_stewards, public.collector_scans from anon;
-- TRUNCATE ignora o RLS; TRIGGER e REFERENCES permitem contornar as regras de outro jeito.
-- Os privilégios padrão do Supabase concedem os três, então toda tabela nova precisa revogá-los.
revoke insert, update, delete, truncate, trigger, references on public.collector_stewards, public.collector_scans from authenticated;

create policy "responsáveis visíveis na escola" on public.collector_stewards
  for select to authenticated using (
    profile_id = (select auth.uid())
    or public.is_school_educator((select c.school_id from public.collectors c where c.id = collector_id))
  );

create policy "leituras visíveis ao autor e aos responsáveis" on public.collector_scans
  for select to authenticated using (
    profile_id = (select auth.uid())
    or public.is_collector_steward(collector_id)
  );

-- O QR e o código de responsável nunca chegam ao navegador: a leitura do QR e a
-- adesão por código passam pelo servidor, que valida e registra.
revoke all on public.collectors from authenticated;
grant select (id, school_id, code, name, location, capacity_liters, reserve_liters, valve_kind,
              nominal_diameter_mm, nominal_useful_height_mm, distance_sensor, hardware_revision,
              hardware_updated_at, active, created_at, updated_at)
  on public.collectors to authenticated;

-- ---------------------------------------------------------------------
-- 6. Perfis: colunas visíveis e indicadores por ano/fase
-- ---------------------------------------------------------------------

revoke all on public.profiles from authenticated;
grant select (id, school_id, role, nickname, avatar_id, grade_phase, job_title, staff_sector, status, onboarded_at, created_at, updated_at)
  on public.profiles to authenticated;
grant update (nickname, avatar_id) on public.profiles to authenticated;

create or replace view public.participant_age_bands
with (security_invoker = true) as
select
  p.school_id,
  p.role,
  p.grade_phase,
  r.sex,
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

revoke all on public.participant_age_bands from anon, authenticated;
grant select on public.participant_age_bands to authenticated;
