-- =====================================================================
-- EcoHorta Inteligente — 2/2: captadores, dispositivos, telemetria,
-- comandos, execuções de missão e XP
--
-- O servidor (conexão Postgres direta) é a fonte oficial e o único que escreve.
-- Usuários autenticados podem apenas LER o que o RLS permite.
-- =====================================================================

create type public.device_status as enum ('OFFLINE', 'ONLINE', 'READY', 'DISPENSING', 'CALIBRATING', 'ERROR', 'MAINTENANCE');
create type public.command_status as enum ('QUEUED', 'EXECUTING', 'MEASURING', 'COMPLETED', 'FAILED', 'CANCELLED');
create type public.valve_state as enum ('open', 'closed', 'unknown');
create type public.valve_kind as enum ('undefined', 'solenoid_direct_acting', 'motorized_ball', 'pump');

-- ---------------------------------------------------------------------
-- Captadores e dispositivos
-- ---------------------------------------------------------------------

create table public.collectors (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete restrict,
  code text not null unique check (code ~ '^[A-Z]{1,6}-[0-9]{3,6}$'), -- ex.: EC-001 (QR Code)
  name text not null check (char_length(btrim(name)) between 2 and 60),
  location text not null check (char_length(btrim(location)) between 2 and 80),
  capacity_liters numeric(8, 3) not null check (capacity_liters > 0),
  reserve_liters numeric(8, 3) not null default 0 check (reserve_liters >= 0),
  valve_kind public.valve_kind not null default 'undefined',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reserve_below_capacity check (reserve_liters < capacity_liters)
);
create index collectors_school_idx on public.collectors (school_id);

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  collector_id uuid not null references public.collectors (id) on delete cascade,
  device_key text not null unique check (device_key ~ '^[A-Z0-9][A-Z0-9-]{2,63}$'), -- ex.: VIRTUAL-001, ESP32-001
  is_simulated boolean not null default false,
  -- sha256(pepper:token) em hexadecimal. O token em si nunca é armazenado.
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  firmware_version text check (firmware_version is null or char_length(firmware_version) <= 32),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index devices_one_active_per_collector on public.devices (collector_id) where active;

-- Estado atual do captador (uma linha por captador): última leitura e contabilidade hídrica.
create table public.collector_state (
  collector_id uuid primary key references public.collectors (id) on delete cascade,
  device_id uuid references public.devices (id) on delete set null,
  last_seen_at timestamptz,
  uptime_ms bigint check (uptime_ms is null or uptime_ms >= 0),
  seq bigint,
  distance_mm numeric(8, 1),
  volume_liters numeric(8, 3) check (volume_liters is null or volume_liters >= 0),
  valve public.valve_state not null default 'unknown',
  status public.device_status not null default 'OFFLINE',
  -- Estado da contabilidade (tendência, transbordamento, balanço) — ver src/lib/collector/water-accounting.ts
  accounting jsonb not null default '{}'::jsonb,
  -- Parâmetros e ação pendente do dispositivo virtual. Nulo para captadores reais.
  simulation jsonb,
  last_telemetry_at timestamptz,
  last_telemetry_volume numeric(8, 3),
  updated_at timestamptz not null default now()
);

-- Histórico de telemetria (amostrado: ver regras em collector-service.ts).
create table public.telemetry (
  id bigint generated always as identity primary key,
  collector_id uuid not null references public.collectors (id) on delete cascade,
  device_id uuid not null references public.devices (id) on delete cascade,
  recorded_at timestamptz not null,
  uptime_ms bigint not null check (uptime_ms >= 0),
  seq bigint not null check (seq >= 0),
  distance_mm numeric(8, 1),
  volume_liters numeric(8, 3) not null check (volume_liters >= 0),
  fill_ratio numeric(5, 4) not null check (fill_ratio between 0 and 1),
  level_state text not null check (level_state in ('low', 'available', 'good', 'attention', 'critical')),
  valve public.valve_state not null,
  status public.device_status not null,
  overflowing boolean not null,
  is_simulated boolean not null
);
create index telemetry_collector_recorded_idx on public.telemetry (collector_id, recorded_at desc);

-- ---------------------------------------------------------------------
-- Comandos, execuções de missão e XP
-- ---------------------------------------------------------------------

create table public.device_commands (
  id uuid primary key, -- command_id gerado pelo app: garante idempotência
  collector_id uuid not null references public.collectors (id) on delete cascade,
  device_id uuid references public.devices (id) on delete set null,
  requested_by uuid references public.profiles (id) on delete set null,
  action text not null default 'dispense' check (action = 'dispense'),
  target_liters numeric(6, 3) not null check (target_liters > 0 and target_liters <= 50),
  status public.command_status not null default 'QUEUED',
  failure text check (
    failure is null
    or failure in ('NO_FLOW', 'TIMEOUT', 'INSUFFICIENT_WATER', 'SENSOR_ERROR', 'DEVICE_BUSY', 'DEVICE_OFFLINE', 'CONNECTION_ERROR')
  ),
  cancel_requested boolean not null default false,
  delivered_liters numeric(6, 3) not null default 0 check (delivered_liters >= 0),
  start_volume_liters numeric(8, 3),
  end_volume_liters numeric(8, 3),
  started_uptime_ms bigint,
  finished_uptime_ms bigint,
  is_simulated boolean not null,
  queued_at timestamptz not null,
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint failure_only_when_failed check ((status = 'FAILED') = (failure is not null)),
  constraint terminal_has_finish check (status in ('QUEUED', 'EXECUTING', 'MEASURING') or finished_at is not null)
);
-- Uma única liberação ativa por captador, garantida pelo banco.
create unique index device_commands_one_active_per_collector
  on public.device_commands (collector_id) where status in ('QUEUED', 'EXECUTING', 'MEASURING');
create index device_commands_collector_queued_idx on public.device_commands (collector_id, queued_at desc);
create index device_commands_requested_by_idx on public.device_commands (requested_by);

create table public.mission_executions (
  id uuid primary key, -- execution_id gerado pelo app
  profile_id uuid not null references public.profiles (id) on delete cascade,
  collector_id uuid not null references public.collectors (id) on delete cascade,
  command_id uuid not null unique references public.device_commands (id) on delete cascade,
  mission_id text not null check (mission_id ~ '^[a-z0-9-]{2,64}$'),
  mission_category text not null check (
    mission_category in ('action', 'investigation', 'math', 'science', 'engineering', 'collaborative', 'rescue')
  ),
  target_liters numeric(6, 3) not null check (target_liters > 0),
  status public.command_status not null,
  delivered_liters numeric(6, 3) not null default 0 check (delivered_liters >= 0),
  xp_awarded integer not null default 0 check (xp_awarded >= 0),
  created_at timestamptz not null,
  finished_at timestamptz,
  updated_at timestamptz not null default now()
);
create index mission_executions_profile_idx on public.mission_executions (profile_id, created_at desc);
create index mission_executions_collector_idx on public.mission_executions (collector_id, created_at desc);

-- Livro-razão de XP: toda pontuação tem origem. Nunca atualizado; só inserido.
create table public.xp_transactions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  amount integer not null check (amount <> 0),
  source_type text not null check (source_type in ('mission_execution', 'adjustment')),
  source_id uuid not null,
  reason text not null check (char_length(reason) between 2 and 120),
  created_at timestamptz not null default now(),
  constraint xp_once_per_source unique (profile_id, source_type, source_id)
);
create index xp_transactions_profile_idx on public.xp_transactions (profile_id, created_at desc);

create trigger collectors_touch before update on public.collectors for each row execute function public.touch_updated_at();
create trigger devices_touch before update on public.devices for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- Row Level Security e privilégios
-- ---------------------------------------------------------------------

alter table public.collectors enable row level security;
alter table public.devices enable row level security;
alter table public.collector_state enable row level security;
alter table public.telemetry enable row level security;
alter table public.device_commands enable row level security;
alter table public.mission_executions enable row level security;
alter table public.xp_transactions enable row level security;

revoke all on public.collectors, public.devices, public.collector_state, public.telemetry,
  public.device_commands, public.mission_executions, public.xp_transactions from anon;
revoke insert, update, delete on public.collectors, public.collector_state, public.telemetry,
  public.device_commands, public.mission_executions, public.xp_transactions from authenticated;
-- Dispositivos (hash do token) nunca são legíveis por usuários.
revoke all on public.devices from authenticated;

create policy "membros veem captadores da escola" on public.collectors
  for select to authenticated using (school_id = public.my_school_id());

create policy "membros veem o estado dos captadores da escola" on public.collector_state
  for select to authenticated using (
    exists (select 1 from public.collectors c where c.id = collector_id and c.school_id = public.my_school_id())
  );

create policy "membros veem a telemetria da escola" on public.telemetry
  for select to authenticated using (
    exists (select 1 from public.collectors c where c.id = collector_id and c.school_id = public.my_school_id())
  );

create policy "comandos visíveis a quem pediu e a educadores" on public.device_commands
  for select to authenticated using (
    requested_by = auth.uid()
    or public.is_school_educator((select c.school_id from public.collectors c where c.id = collector_id))
  );

create policy "execuções visíveis ao participante e a educadores" on public.mission_executions
  for select to authenticated using (
    profile_id = auth.uid()
    or public.is_school_educator((select c.school_id from public.collectors c where c.id = collector_id))
  );

create policy "xp visível ao participante e a educadores" on public.xp_transactions
  for select to authenticated using (
    profile_id = auth.uid()
    or public.is_school_educator((select p.school_id from public.profiles p where p.id = profile_id))
  );

create or replace view public.profile_xp
with (security_invoker = true) as
select profile_id, sum(amount)::integer as xp
from public.xp_transactions
group by profile_id;

revoke all on public.profile_xp from anon;
grant select on public.profile_xp to authenticated;
