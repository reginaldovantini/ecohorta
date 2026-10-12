-- =====================================================================
-- EcoHorta Inteligente — 11: o caminho de um captador novo
--
-- Replicar o projeto é construir mais captadores. Entre "quero montar um" e
-- "a escola tem mais um captador na rede" existem seis etapas, e quem as
-- percorre normalmente nunca programou. O modelo precisa saber em que etapa
-- cada captador está, para a plataforma conseguir guiar em vez de só listar.
--
--   1. cadastro      → escola, município, estado e onde o tubo vai ficar
--   2. montagem      → manual de construção do protótipo
--   3. personalização→ artes para colar no tubo
--   4. firmware      → código pronto para o ESP32 daquele captador
--   5. conexão       → o ESP32 fala com a plataforma
--   6. calibração    → volumes conhecidos, medidos pelo sensor
--
-- Só ao fim da calibração o captador ENTRA NA REDE: é aí que ele assume o
-- código sequencial ECO-nnn. Até lá carrega um código de protótipo, porque um
-- tubo que ainda não mede nada não é um captador da escola — é uma obra.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Escola com município e estado
-- ---------------------------------------------------------------------
-- Uma rede de escolas precisa saber ONDE cada uma fica: é o que permite dizer
-- "27 captadores em 9 municípios" em vez de só contar tubos.

alter table public.schools
  add column city text check (city is null or char_length(btrim(city)) between 2 and 80),
  add column state char(2) check (state is null or state ~ '^[A-Z]{2}$');

create index schools_place_idx on public.schools (state, city);

-- ---------------------------------------------------------------------
-- 2. Código: protótipo até calibrar, ECO-nnn depois
-- ---------------------------------------------------------------------

alter table public.collectors drop constraint collectors_prefix_check;
alter table public.collectors
  add constraint collectors_prefix_check check (prefix in ('ECO', 'PROTO', 'SIM'));

-- O captador físico passa a ser ECO; quem já existia era EC.
update public.collectors set prefix = 'ECO', code = 'ECO-' || substring(code from '\d+$') where prefix = 'EC';

alter table public.collectors
  /** Quando a calibração foi aceita e o captador entrou na rede da escola. */
  add column activated_at timestamptz,
  /**
   * Rede que o ESP32 cria para ser configurado, e o ponto de acesso que um
   * estudante liga no celular para atender o captador offline.
   *
   * A senha fica legível de propósito: ela é combinada entre o aparelho e quem
   * está na frente dele, e aparece no app para o estudante ligar o hotspot. Não
   * protege dado nenhum — a telemetria vai por HTTPS com o token do dispositivo,
   * que continua sendo guardado só como hash.
   */
  add column hotspot_ssid text check (hotspot_ssid is null or char_length(hotspot_ssid) between 4 and 32),
  add column hotspot_password text check (hotspot_password is null or char_length(hotspot_password) between 8 and 32),
  /** Como este captador se conecta: pela rede da escola, ou só por hotspot. */
  add column connectivity text not null default 'school_network'
    check (connectivity in ('school_network', 'hotspot_only'));

-- Protótipo tem código de protótipo; captador ativo tem ECO-nnn e data de ativação.
alter table public.collectors
  add constraint activated_is_eco check (
    (activated_at is null and prefix in ('PROTO', 'SIM'))
    or (activated_at is not null and prefix in ('ECO', 'SIM'))
  );

create index collectors_activation_idx on public.collectors (school_id, activated_at);

-- ---------------------------------------------------------------------
-- 3. Etapas marcadas à mão
-- ---------------------------------------------------------------------
-- A plataforma deduz sozinha o que consegue observar: se o ESP32 falou, a
-- conexão funciona; se há calibração aceita, o captador mede. Montagem física e
-- personalização ela não tem como ver — essas quem marca é quem montou.

create type public.setup_step as enum ('montagem', 'personalizacao', 'firmware');

create table public.collector_setup_marks (
  collector_id uuid not null references public.collectors (id) on delete cascade,
  step public.setup_step not null,
  marked_at timestamptz not null default now(),
  marked_by uuid references public.profiles (id) on delete set null,
  primary key (collector_id, step)
);
create index collector_setup_marks_by_idx on public.collector_setup_marks (marked_by);

-- ---------------------------------------------------------------------
-- 4. RLS
-- ---------------------------------------------------------------------

alter table public.collector_setup_marks enable row level security;
revoke all on public.collector_setup_marks from anon;
revoke insert, update, delete, truncate, trigger, references on public.collector_setup_marks from authenticated;

create policy "etapas visíveis a quem cuida do captador" on public.collector_setup_marks
  for select to authenticated using (public.is_collector_steward(collector_id));

-- As credenciais do hotspot e o estado de ativação saem junto do captador, mas
-- a coluna do hotspot só é concedida a quem está autenticado na escola: o RLS de
-- `collectors` já limita as linhas; aqui limitamos as colunas.
revoke all on public.collectors from authenticated;
grant select (id, school_id, prefix, seq, code, name, location, capacity_liters, reserve_liters, valve_kind,
              nominal_diameter_mm, nominal_useful_height_mm, distance_sensor, hardware_revision,
              hardware_updated_at, active, activated_at, connectivity, hotspot_ssid, hotspot_password,
              created_at, updated_at)
  on public.collectors to authenticated;
