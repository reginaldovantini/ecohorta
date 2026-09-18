-- =====================================================================
-- EcoHorta Inteligente — 4: validação física (bancada, diagnóstico do
-- VL53L1X, observações e validação experimental da calibração)
--
-- Tudo aqui é DADO EXPERIMENTAL: nunca altera a calibração, nunca é
-- apagado e nunca é "corrigido" depois de registrado.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Modo de bancada (ensaio físico)
-- ---------------------------------------------------------------------
-- Enquanto ativo: leituras a cada 1 s gravadas uma a uma, balanço hídrico
-- pausado (água colocada à mão não é condensado) e missões bloqueadas.
-- Expira sozinho alguns minutos depois que a tela de ensaio é fechada.
alter table public.collector_state
  add column bench_mode_until timestamptz,
  add column bench_started_at timestamptz,
  add column bench_started_by uuid references public.profiles (id) on delete set null,
  -- Último diagnóstico enviado pelo firmware (amostras válidas, dispersão, sinal, status do VL53L1X)
  add column sensor_diagnostics jsonb;

alter table public.telemetry
  add column sensor_diagnostics jsonb,
  -- Leitura gravada integralmente durante um ensaio de bancada (não amostrada)
  add column bench_mode boolean not null default false;

create index telemetry_collector_bench_idx on public.telemetry (collector_id, recorded_at desc) where bench_mode;

-- ---------------------------------------------------------------------
-- Observações de bancada: comportamento do sensor dentro do tubo
-- (cone de visão, reflexões, superfície, leituras inválidas, níveis)
-- ---------------------------------------------------------------------
create table public.sensor_observations (
  id uuid primary key default gen_random_uuid(),
  collector_id uuid not null references public.collectors (id) on delete restrict,
  device_id uuid references public.devices (id) on delete set null,
  sensor_model text not null check (char_length(btrim(sensor_model)) between 2 and 40),
  is_simulated boolean not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),

  condition text not null check (condition in ('sem_agua', 'com_agua', 'alvo_flutuante', 'outro')),
  note text check (note is null or char_length(note) <= 280),
  -- Altura da água lida na mangueira transparente, a partir da marca do ZERO (referência independente do sensor)
  reference_height_mm numeric(7, 1) check (reference_height_mm is null or reference_height_mm between -1000 and 5000),

  -- Leitura no momento do registro — inclusive instável ou inválida (é isso que se quer observar)
  stability_state text not null check (stability_state in ('stable', 'stabilizing', 'invalid')),
  distance_mm numeric(7, 1),
  median_mm numeric(7, 1),
  std_mm numeric(7, 1),
  drift_mm numeric(7, 1),
  readings integer not null check (readings >= 0),
  outliers integer not null check (outliers >= 0),
  invalid integer not null check (invalid >= 0),
  total integer not null check (total >= 0),
  average_interval_ms integer check (average_interval_ms is null or average_interval_ms >= 0),
  last_distance_mm numeric(8, 1),
  -- Janela bruta de leituras e diagnóstico do firmware, para análise posterior
  samples jsonb not null default '[]'::jsonb,
  sensor_diagnostics jsonb,

  -- Derivados pela calibração aplicável no momento (se houver)
  calibration_id uuid references public.collector_calibrations (id) on delete restrict,
  height_mm numeric(8, 1),
  volume_liters numeric(8, 3),
  constraint observation_derived_needs_calibration check (calibration_id is not null or (height_mm is null and volume_liters is null))
);
create index sensor_observations_collector_idx on public.sensor_observations (collector_id, created_at desc);

-- ---------------------------------------------------------------------
-- Validação experimental independente de uma calibração ativa
-- ---------------------------------------------------------------------
create table public.calibration_validations (
  id uuid primary key default gen_random_uuid(),
  collector_id uuid not null references public.collectors (id) on delete restrict,
  calibration_id uuid not null references public.collector_calibrations (id) on delete restrict,
  device_id uuid references public.devices (id) on delete set null,
  sensor_model text not null check (char_length(btrim(sensor_model)) between 2 and 40),
  is_simulated boolean not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),

  -- Referência física (informada pelo operador): volume colocado no captador
  known_volume_liters numeric(8, 3) not null check (known_volume_liters between 0 and 1000),
  measurement_method text not null check (measurement_method in ('balanca', 'recipiente_graduado', 'outro')),
  known_mass_kg numeric(8, 3) check (known_mass_kg is null or known_mass_kg > 0),
  note text check (note is null or char_length(note) <= 280),

  -- Medição (servidor): leitura estabilizada
  distance_mm numeric(7, 1) not null,
  distance_std_mm numeric(7, 1),
  readings integer not null check (readings > 0),
  height_mm numeric(8, 1) not null,
  calculated_volume_liters numeric(8, 3) not null,
  raw_volume_liters numeric(9, 3) not null,
  below_zero boolean not null,
  above_maximum boolean not null,

  -- Erro: calculado − conhecido
  error_liters numeric(9, 3) not null,
  absolute_error_liters numeric(9, 3) not null check (absolute_error_liters >= 0),
  percent_error numeric(9, 3),
  absolute_percent_error numeric(9, 3) check (absolute_percent_error is null or absolute_percent_error >= 0),
  constraint validation_absolute_error check (absolute_error_liters = abs(error_liters)),
  constraint validation_percent_needs_volume check ((known_volume_liters > 0) = (percent_error is not null)),
  constraint validation_percent_pair check ((percent_error is null) = (absolute_percent_error is null))
);
create index calibration_validations_collector_idx on public.calibration_validations (collector_id, created_at desc);
create index calibration_validations_calibration_idx on public.calibration_validations (calibration_id, created_at desc);

-- ---------------------------------------------------------------------
-- Registros experimentais são imutáveis
-- ---------------------------------------------------------------------
create or replace function public.protect_experimental_record() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Registros experimentais nunca são apagados' using errcode = '42501';
  end if;
  -- Só referências a dispositivo ou conta removidos podem virar nulas.
  if (to_jsonb(new) - 'device_id' - 'created_by') is distinct from (to_jsonb(old) - 'device_id' - 'created_by')
     or (new.device_id is distinct from old.device_id and new.device_id is not null)
     or (new.created_by is distinct from old.created_by and new.created_by is not null)
  then
    raise exception 'Registros experimentais não podem ser alterados' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger sensor_observations_protect
  before update or delete on public.sensor_observations
  for each row execute function public.protect_experimental_record();

create trigger calibration_validations_protect
  before update or delete on public.calibration_validations
  for each row execute function public.protect_experimental_record();

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.sensor_observations enable row level security;
alter table public.calibration_validations enable row level security;

revoke all on public.sensor_observations, public.calibration_validations from anon;
revoke insert, update, delete on public.sensor_observations, public.calibration_validations from authenticated;

create policy "membros veem as observações de bancada da escola" on public.sensor_observations
  for select to authenticated using (
    exists (select 1 from public.collectors c where c.id = collector_id and c.school_id = public.my_school_id())
  );

create policy "membros veem as validações da escola" on public.calibration_validations
  for select to authenticated using (
    exists (select 1 from public.collectors c where c.id = collector_id and c.school_id = public.my_school_id())
  );
