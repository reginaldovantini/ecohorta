-- =====================================================================
-- EcoHorta Inteligente — 5: configuração de hardware do captador
-- (sensor de distância VL53L0X ou VL53L1X, escolhido na plataforma)
--
-- A plataforma é a fonte da configuração: o firmware recebe o modelo do
-- sensor na resposta de cada telemetria e usa o driver correspondente.
-- Cada troca gera uma nova REVISÃO, fica registrada com a confirmação de
-- quem trocou e invalida a calibração: nenhuma calibração feita com outro
-- sensor (ou outra revisão de hardware) converte leituras em volume.
-- =====================================================================

create type public.distance_sensor_model as enum ('VL53L0X', 'VL53L1X');

-- Captadores existentes ficam com o VL53L1X: até aqui o firmware só suportava
-- esse sensor e todas as calibrações registradas foram feitas com ele.
alter table public.collectors
  add column distance_sensor public.distance_sensor_model not null default 'VL53L1X',
  add column hardware_revision integer not null default 1 check (hardware_revision > 0),
  add column hardware_updated_at timestamptz,
  add column hardware_updated_by uuid references public.profiles (id) on delete set null;

-- A troca do sensor nunca é silenciosa: sempre gera a próxima revisão de hardware.
create or replace function public.guard_collector_hardware() returns trigger
language plpgsql as $$
begin
  if new.hardware_revision < old.hardware_revision then
    raise exception 'A revisão de hardware do captador nunca diminui' using errcode = '23514';
  end if;
  if new.distance_sensor is distinct from old.distance_sensor and new.hardware_revision <> old.hardware_revision + 1 then
    raise exception 'A troca do sensor exige uma nova revisão de hardware' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger collectors_guard_hardware
  before update on public.collectors
  for each row execute function public.guard_collector_hardware();

-- Revisão de hardware que o firmware informou estar usando (diagnóstico; nulo = não informada).
alter table public.collector_state
  add column reported_hardware_revision integer check (reported_hardware_revision is null or reported_hardware_revision > 0);

-- ---------------------------------------------------------------------
-- Calibração vinculada à configuração de hardware com que foi feita
-- ---------------------------------------------------------------------
-- collector_calibrations.sensor_model já guarda o modelo; a revisão identifica a
-- configuração exata. Calibrações existentes são da revisão 1 (VL53L1X).
alter table public.collector_calibrations
  add column hardware_revision integer not null default 1 check (hardware_revision > 0);

-- Mesmo histórico imutável, agora protegendo TODAS as colunas (inclusive as novas):
-- só mudam o status (ativa → substituída), o horário da substituição (uma vez) e
-- referências a dispositivo ou conta removidos (que viram nulas).
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

  if (to_jsonb(new) - 'status' - 'superseded_at' - 'device_id' - 'created_by')
       is distinct from (to_jsonb(old) - 'status' - 'superseded_at' - 'device_id' - 'created_by')
     or (new.superseded_at is distinct from old.superseded_at and old.superseded_at is not null)
     or (new.device_id is distinct from old.device_id and new.device_id is not null)
     or (new.created_by is distinct from old.created_by and new.created_by is not null)
  then
    raise exception 'Calibrações concluídas não podem ser alteradas' using errcode = '23514';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Histórico de alterações de hardware (imutável)
-- ---------------------------------------------------------------------
create table public.collector_hardware_changes (
  id uuid primary key default gen_random_uuid(),
  collector_id uuid not null references public.collectors (id) on delete restrict,
  -- Revisão criada por esta alteração (a revisão 1 é a configuração inicial do captador).
  revision integer not null check (revision > 1),
  previous_sensor public.distance_sensor_model not null,
  new_sensor public.distance_sensor_model not null,
  changed_by uuid references public.profiles (id) on delete set null,
  changed_at timestamptz not null default now(),
  -- A troca só é aceita com a confirmação explícita de que o sensor físico corresponde ao selecionado.
  physical_match_confirmed boolean not null check (physical_match_confirmed),
  note text check (note is null or char_length(note) <= 280),
  -- Calibração ativa que deixou de valer e procedimento em andamento cancelado por esta troca.
  superseded_calibration_id uuid references public.collector_calibrations (id) on delete restrict,
  cancelled_calibration_id uuid references public.collector_calibrations (id) on delete restrict,
  is_simulated boolean not null,
  constraint hardware_change_changes_sensor check (previous_sensor <> new_sensor)
);
create unique index collector_hardware_changes_revision_unique on public.collector_hardware_changes (collector_id, revision);
create index collector_hardware_changes_collector_idx on public.collector_hardware_changes (collector_id, changed_at desc);

create or replace function public.protect_hardware_change() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'O histórico de hardware nunca é apagado' using errcode = '42501';
  end if;
  -- Só a referência à conta removida pode virar nula.
  if (to_jsonb(new) - 'changed_by') is distinct from (to_jsonb(old) - 'changed_by')
     or (new.changed_by is distinct from old.changed_by and new.changed_by is not null)
  then
    raise exception 'O histórico de hardware não pode ser alterado' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger collector_hardware_changes_protect
  before update or delete on public.collector_hardware_changes
  for each row execute function public.protect_hardware_change();

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.collector_hardware_changes enable row level security;

revoke all on public.collector_hardware_changes from anon;
revoke insert, update, delete on public.collector_hardware_changes from authenticated;

create policy "membros veem o histórico de hardware da escola" on public.collector_hardware_changes
  for select to authenticated using (
    exists (select 1 from public.collectors c where c.id = collector_id and c.school_id = public.my_school_id())
  );
