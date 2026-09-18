-- =====================================================================
-- EcoHorta Inteligente — 3: calibração experimental de volume (VL53L1X)
--
-- A distância medida pelo sensor é o dado físico primário. O volume é
-- DERIVADO pela calibração ativa do captador (V = k × H, docs/CALIBRACAO.md).
-- Calibrações concluídas nunca são apagadas nem alteradas: cada nova
-- calibração concluída ganha uma nova versão.
-- =====================================================================

create type public.calibration_status as enum ('draft', 'active', 'superseded', 'rejected', 'cancelled');
create type public.calibration_quality as enum ('good', 'acceptable', 'inconsistent');
create type public.volume_source as enum ('calibration', 'device', 'none');

-- Dimensões de projeto do tubo, usadas só para avaliar a plausibilidade da calibração.
-- Nunca são substituídas pelo diâmetro efetivo calculado.
alter table public.collectors
  add column nominal_diameter_mm numeric(6, 1) check (nominal_diameter_mm is null or nominal_diameter_mm > 0),
  add column nominal_useful_height_mm numeric(7, 1) check (nominal_useful_height_mm is null or nominal_useful_height_mm > 0);

-- ---------------------------------------------------------------------
-- Calibrações (versionadas)
-- ---------------------------------------------------------------------

create table public.collector_calibrations (
  id uuid primary key default gen_random_uuid(),
  collector_id uuid not null references public.collectors (id) on delete restrict,
  device_id uuid references public.devices (id) on delete set null,
  sensor_model text not null default 'VL53L1X' check (char_length(btrim(sensor_model)) between 2 and 40),
  is_simulated boolean not null,
  status public.calibration_status not null default 'draft',
  -- Atribuída ao concluir (ativa ou recusada). Rascunhos e cancelamentos não têm versão.
  version integer check (version is null or version > 0),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  activated_at timestamptz,
  superseded_at timestamptz,

  -- Distâncias estabilizadas (mm) registradas em cada etapa
  zero_distance_mm numeric(7, 1) check (zero_distance_mm is null or zero_distance_mm between 0 and 10000),
  one_liter_distance_mm numeric(7, 1) check (one_liter_distance_mm is null or one_liter_distance_mm between 0 and 10000),
  two_liter_distance_mm numeric(7, 1) check (two_liter_distance_mm is null or two_liter_distance_mm between 0 and 10000),
  three_liter_distance_mm numeric(7, 1) check (three_liter_distance_mm is null or three_liter_distance_mm between 0 and 10000),
  maximum_distance_mm numeric(7, 1) check (maximum_distance_mm is null or maximum_distance_mm between 0 and 10000),
  -- Por etapa: variação, número de leituras e horário do registro
  point_details jsonb not null default '{}'::jsonb,

  -- Resultado do ajuste
  calibration_constant numeric(12, 8) check (calibration_constant is null or calibration_constant > 0), -- litros por mm
  effective_diameter_mm numeric(7, 2),
  effective_height_mm numeric(8, 1),
  effective_capacity_liters numeric(8, 3),
  r_squared numeric(9, 6),
  max_residual_liters numeric(8, 4),
  quality public.calibration_quality,
  quality_report jsonb,
  -- Dimensões nominais no momento da calibração (referência da plausibilidade)
  nominal_diameter_mm numeric(6, 1),
  nominal_useful_height_mm numeric(7, 1),
  algorithm text not null default 'linear-origin-v1' check (char_length(algorithm) between 3 and 40),

  constraint completed_calibration_is_complete check (
    status in ('draft', 'cancelled') or (
      version is not null and completed_at is not null and quality is not null and quality_report is not null
      and zero_distance_mm is not null and one_liter_distance_mm is not null and two_liter_distance_mm is not null
      and three_liter_distance_mm is not null and maximum_distance_mm is not null
    )
  ),
  constraint usable_calibration_has_model check (
    status not in ('active', 'superseded') or (
      quality in ('good', 'acceptable') and activated_at is not null and calibration_constant is not null
      and effective_capacity_liters is not null and effective_height_mm is not null and effective_diameter_mm is not null
    )
  ),
  constraint rejected_calibration_is_inconsistent check (status <> 'rejected' or quality = 'inconsistent'),
  constraint superseded_has_time check ((status = 'superseded') = (superseded_at is not null))
);

create unique index collector_calibrations_version_unique on public.collector_calibrations (collector_id, version) where version is not null;
-- No máximo uma calibração ativa e um procedimento em andamento por captador.
create unique index collector_calibrations_one_active on public.collector_calibrations (collector_id) where status = 'active';
create unique index collector_calibrations_one_draft on public.collector_calibrations (collector_id) where status = 'draft';
create index collector_calibrations_collector_created_idx on public.collector_calibrations (collector_id, created_at desc);

-- Histórico imutável: só rascunhos mudam; uma calibração ativa só pode ser substituída.
create or replace function public.protect_calibration_history() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Calibrações nunca são apagadas' using errcode = '42501';
  end if;

  if old.status = 'draft' then
    return new;
  end if;

  if new.status is distinct from old.status and not (old.status = 'active' and new.status = 'superseded') then
    raise exception 'Transição de calibração não permitida: % → %', old.status, new.status using errcode = '23514';
  end if;

  if (new.id, new.collector_id, new.sensor_model, new.is_simulated, new.version, new.created_at, new.completed_at,
      new.activated_at, new.zero_distance_mm, new.one_liter_distance_mm, new.two_liter_distance_mm,
      new.three_liter_distance_mm, new.maximum_distance_mm, new.point_details, new.calibration_constant,
      new.effective_diameter_mm, new.effective_height_mm, new.effective_capacity_liters, new.r_squared,
      new.max_residual_liters, new.quality, new.quality_report, new.nominal_diameter_mm,
      new.nominal_useful_height_mm, new.algorithm)
     is distinct from
     (old.id, old.collector_id, old.sensor_model, old.is_simulated, old.version, old.created_at, old.completed_at,
      old.activated_at, old.zero_distance_mm, old.one_liter_distance_mm, old.two_liter_distance_mm,
      old.three_liter_distance_mm, old.maximum_distance_mm, old.point_details, old.calibration_constant,
      old.effective_diameter_mm, old.effective_height_mm, old.effective_capacity_liters, old.r_squared,
      old.max_residual_liters, old.quality, old.quality_report, old.nominal_diameter_mm,
      old.nominal_useful_height_mm, old.algorithm)
     or (new.superseded_at is distinct from old.superseded_at and old.superseded_at is not null)
     -- Referências podem apenas virar nulas (dispositivo ou conta removidos).
     or (new.device_id is distinct from old.device_id and new.device_id is not null)
     or (new.created_by is distinct from old.created_by and new.created_by is not null)
  then
    raise exception 'Calibrações concluídas não podem ser alteradas' using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger collector_calibrations_protect
  before update or delete on public.collector_calibrations
  for each row execute function public.protect_calibration_history();

-- ---------------------------------------------------------------------
-- Volume derivado na telemetria e no estado do captador
-- ---------------------------------------------------------------------

-- Um dispositivo pode enviar só a distância: sem calibração, o volume fica desconhecido.
alter table public.telemetry
  alter column volume_liters drop not null,
  alter column fill_ratio drop not null,
  alter column level_state drop not null,
  add column height_mm numeric(8, 1),
  add column device_volume_liters numeric(8, 3) check (device_volume_liters is null or device_volume_liters >= 0),
  add column volume_source public.volume_source not null default 'device',
  add column calibration_id uuid references public.collector_calibrations (id) on delete restrict,
  add column sensor_model text check (sensor_model is null or char_length(sensor_model) between 2 and 40),
  add constraint telemetry_volume_matches_source check (
    (volume_source = 'none') = (volume_liters is null)
    and (volume_source = 'calibration') = (calibration_id is not null)
    and (volume_liters is null) = (fill_ratio is null)
    and (volume_liters is null) = (level_state is null)
  );
create index telemetry_calibration_idx on public.telemetry (calibration_id) where calibration_id is not null;

alter table public.collector_state
  add column height_mm numeric(8, 1),
  add column volume_source public.volume_source not null default 'none',
  add column calibration_id uuid references public.collector_calibrations (id) on delete restrict,
  add column sensor_model text check (sensor_model is null or char_length(sensor_model) between 2 and 40),
  -- Leituras recentes de distância para a estabilização (janela curta, ver distance-stability.ts)
  add column distance_samples jsonb not null default '[]'::jsonb,
  -- Enquanto a tela de calibração está aberta, o dispositivo envia leituras mais rápido.
  add column calibration_mode_until timestamptz;

update public.collector_state set volume_source = 'device' where volume_liters is not null;

alter table public.collector_state
  add constraint collector_state_volume_matches_source check (
    (volume_source = 'none') = (volume_liters is null)
    and (volume_source = 'calibration') = (calibration_id is not null)
  );

-- Preparação para missões: volume reutilizado derivado das distâncias antes e depois da liberação.
-- Ainda não decide conclusão nem XP (continuam pelo relatório medido do dispositivo).
alter table public.device_commands
  add column start_distance_mm numeric(7, 1) check (start_distance_mm is null or start_distance_mm between 0 and 10000),
  add column end_distance_mm numeric(7, 1) check (end_distance_mm is null or end_distance_mm between 0 and 10000),
  add column calibration_id uuid references public.collector_calibrations (id) on delete restrict,
  add column measured_reuse_liters numeric(6, 3) check (measured_reuse_liters is null or measured_reuse_liters >= 0);

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------

alter table public.collector_calibrations enable row level security;

revoke all on public.collector_calibrations from anon;
revoke insert, update, delete on public.collector_calibrations from authenticated;

create policy "membros veem as calibrações dos captadores da escola" on public.collector_calibrations
  for select to authenticated using (
    exists (select 1 from public.collectors c where c.id = collector_id and c.school_id = public.my_school_id())
  );
