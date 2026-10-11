-- =====================================================================
-- EcoHorta Inteligente — 10: pertencer a várias escolas
--
-- O modelo tinha uma inconsistência que só aparece ao escalar: a autoridade
-- (`collector_stewards`) já atravessa escolas — alguém pode ser responsável por
-- captadores de duas —, mas `profiles.school_id` guardava UMA escola. Resultado:
-- a pessoa podia ter `is_school_educator(B)` verdadeiro e ainda assim não
-- enxergar os captadores de B, porque `my_school_id()` devolvia A.
--
-- Duas coisas diferentes passam a ter nomes diferentes:
--
--   school_members      → A QUE ESCOLAS a pessoa pertence (plural, autoridade de acesso)
--   profiles.school_id  → QUAL escola ela está vendo agora (uma, preferência de tela)
--
-- Quem decide o que a pessoa pode ver é a primeira; a segunda só escolhe o que
-- aparece por padrão. Entrar numa escola continua sendo físico: ler o QR de um
-- captador de lá.
-- =====================================================================

create table public.school_members (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  school_id uuid not null references public.schools (id) on delete cascade,
  joined_at timestamptz not null default now(),
  /** Captador cuja leitura trouxe a pessoa para esta escola. Fica como prova de como ela entrou. */
  joined_via_collector uuid references public.collectors (id) on delete set null,
  primary key (profile_id, school_id)
);
create index school_members_school_idx on public.school_members (school_id);
create index school_members_collector_idx on public.school_members (joined_via_collector);

-- Quem já tem escola no perfil passa a ser membro dela.
insert into public.school_members (profile_id, school_id)
select id, school_id from public.profiles where school_id is not null
on conflict do nothing;

comment on column public.profiles.school_id is
  'Escola que a pessoa está vendo agora. O que ela PODE ver vem de school_members.';

-- ---------------------------------------------------------------------
-- Acesso: pertencer, e não "ser da escola"
-- ---------------------------------------------------------------------

/** A pessoa pertence a esta escola? Administração da plataforma pertence a todas. */
create or replace function public.belongs_to_school(target_school uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select target_school is not null and (
    public.is_platform_admin()
    or exists (
      select 1
      from public.school_members m
      join public.profiles p on p.id = m.profile_id
      where m.profile_id = auth.uid() and m.school_id = target_school and p.status = 'active'
    )
  )
$$;

revoke execute on function public.belongs_to_school(uuid) from public, anon;
grant execute on function public.belongs_to_school(uuid) to authenticated;

-- Ser responsável por um captador passa a implicar pertencer àquela escola:
-- autoridade sem visibilidade era justamente o defeito.
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

-- ---------------------------------------------------------------------
-- As nove políticas que decidiam por escola única
-- ---------------------------------------------------------------------

alter policy "membros veem a própria escola" on public.schools
  using (public.belongs_to_school(id));

alter policy "comunidade vê perfis de exibição" on public.profiles
  using (public.belongs_to_school(school_id));

alter policy "membros veem captadores da escola" on public.collectors
  using (public.belongs_to_school(school_id));

alter policy "membros veem o estado dos captadores da escola" on public.collector_state
  using (public.belongs_to_school((select c.school_id from public.collectors c where c.id = collector_id)));

alter policy "membros veem a telemetria da escola" on public.telemetry
  using (public.belongs_to_school((select c.school_id from public.collectors c where c.id = collector_id)));

alter policy "membros veem as calibrações dos captadores da escola" on public.collector_calibrations
  using (public.belongs_to_school((select c.school_id from public.collectors c where c.id = collector_id)));

alter policy "membros veem as validações da escola" on public.calibration_validations
  using (public.belongs_to_school((select c.school_id from public.collectors c where c.id = collector_id)));

alter policy "membros veem as observações de bancada da escola" on public.sensor_observations
  using (public.belongs_to_school((select c.school_id from public.collectors c where c.id = collector_id)));

alter policy "membros veem o histórico de hardware da escola" on public.collector_hardware_changes
  using (public.belongs_to_school((select c.school_id from public.collectors c where c.id = collector_id)));

-- ---------------------------------------------------------------------
-- RLS da tabela nova
-- ---------------------------------------------------------------------

alter table public.school_members enable row level security;
revoke all on public.school_members from anon;
revoke insert, update, delete, truncate, trigger, references on public.school_members from authenticated;

create policy "pessoa vê os próprios vínculos e os da escola" on public.school_members
  for select to authenticated using (
    profile_id = (select auth.uid()) or public.belongs_to_school(school_id)
  );
