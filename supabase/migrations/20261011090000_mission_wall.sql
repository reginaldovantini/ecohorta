-- =====================================================================
-- EcoHorta Inteligente — 8: mural das missões (evidência da ação)
--
-- O sistema já prova QUANTA água foi reutilizada. O mural prova O QUE foi feito
-- com ela: terminada a liberação, a pessoa registra a missão com uma foto, e ela
-- entra num mural que todas as escolas da plataforma enxergam.
--
-- Regras que o modelo carrega:
--   1. UMA foto por missão executada. O post não existe solto: ele é evidência de
--      uma liberação que o sensor mediu (mission_executions).
--   2. CURTIDA NÃO DÁ PONTO. XP continua saindo só de missão concluída, pelo volume
--      medido. Se curtida valesse XP, dois estudantes curtindo um ao outro subiriam
--      no ranking sem economizar uma gota — e o ranking deixaria de medir água.
--   3. Uma curtida por pessoa por post (a chave primária garante).
--   4. Denúncia tira do mural na hora e devolve a decisão a um responsável.
--   5. Postar exige CONSENTIMENTO DE USO DE IMAGEM registrado. Sem ele, a pessoa
--      usa o app e faz missão normalmente — só não aparece no mural. São fotos de
--      menores, vistas por outras escolas: este é o limite que torna o mural defensável.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Consentimento por finalidade
-- ---------------------------------------------------------------------
-- Participar do projeto e ter a imagem publicada são autorizações diferentes, e
-- a segunda pode ser retirada sem a primeira. Por isso deixam de ser uma linha só.

create type public.consent_purpose as enum ('participacao', 'uso_de_imagem');

alter table public.guardian_consents
  add column purpose public.consent_purpose not null default 'participacao',
  add column revoked_at timestamptz;

alter table public.guardian_consents drop constraint guardian_consents_pkey;
alter table public.guardian_consents add primary key (profile_id, purpose);

/** Consentimento de imagem vigente: concedido e não retirado. */
create or replace function public.has_image_consent(target_profile uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.guardian_consents
    where profile_id = target_profile and purpose = 'uso_de_imagem' and revoked_at is null
  )
$$;

revoke execute on function public.has_image_consent(uuid) from public, anon;
grant execute on function public.has_image_consent(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 2. Posts
-- ---------------------------------------------------------------------

create table public.mission_posts (
  id uuid primary key default gen_random_uuid(),
  -- Uma missão medida, uma evidência. Sem execução não há post.
  execution_id uuid not null unique references public.mission_executions (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  collector_id uuid not null references public.collectors (id) on delete restrict,
  -- Guardada aqui para o mural e para o RLS não percorrerem a cadeia a cada linha.
  school_id uuid not null references public.schools (id) on delete restrict,
  -- Caminho no bucket privado. A imagem chega por URL assinada, nunca pública.
  image_path text not null check (char_length(image_path) between 8 and 300),
  -- Legenda curta: o mural é de fotos, não de texto.
  caption text check (caption is null or char_length(btrim(caption)) between 1 and 140),
  created_at timestamptz not null default now(),
  -- Fora do mural por denúncia, até um responsável decidir.
  hidden_at timestamptz,
  hidden_reason text check (hidden_reason is null or char_length(btrim(hidden_reason)) between 2 and 200),
  constraint hidden_has_reason check ((hidden_at is null) = (hidden_reason is null))
);
create index mission_posts_wall_idx on public.mission_posts (created_at desc) where hidden_at is null;
create index mission_posts_profile_idx on public.mission_posts (profile_id, created_at desc);
create index mission_posts_school_idx on public.mission_posts (school_id, created_at desc);
create index mission_posts_collector_idx on public.mission_posts (collector_id);

-- ---------------------------------------------------------------------
-- 3. Curtidas — reconhecimento, não moeda
-- ---------------------------------------------------------------------

create table public.mission_post_likes (
  post_id uuid not null references public.mission_posts (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  -- Uma curtida por pessoa por post: a chave primária é a regra.
  primary key (post_id, profile_id)
);
create index mission_post_likes_profile_idx on public.mission_post_likes (profile_id);

-- ---------------------------------------------------------------------
-- 4. Denúncias
-- ---------------------------------------------------------------------

create table public.mission_post_reports (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.mission_posts (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  reason text not null check (char_length(btrim(reason)) between 2 and 200),
  created_at timestamptz not null default now(),
  -- Decisão do responsável: manter no mural ou deixar fora.
  resolved_at timestamptz,
  resolved_by uuid references public.profiles (id) on delete set null,
  kept boolean,
  constraint resolution_is_complete check ((resolved_at is null) = (kept is null)),
  -- Uma denúncia por pessoa por post.
  unique (post_id, profile_id)
);
create index mission_post_reports_post_idx on public.mission_post_reports (post_id);
create index mission_post_reports_open_idx on public.mission_post_reports (created_at desc) where resolved_at is null;
create index mission_post_reports_profile_idx on public.mission_post_reports (profile_id);
create index mission_post_reports_resolved_by_idx on public.mission_post_reports (resolved_by);

-- ---------------------------------------------------------------------
-- 5. RLS
-- ---------------------------------------------------------------------
-- Escrita sempre pelo servidor, como no resto do projeto: ele é quem confere
-- consentimento, autoria da missão e unicidade antes de gravar.

alter table public.mission_posts enable row level security;
alter table public.mission_post_likes enable row level security;
alter table public.mission_post_reports enable row level security;

revoke all on public.mission_posts, public.mission_post_likes, public.mission_post_reports from anon;
-- Como nas demais tabelas: TRUNCATE, TRIGGER e REFERENCES também saem (padrões do Supabase).
revoke insert, update, delete, truncate, trigger, references
  on public.mission_posts, public.mission_post_likes, public.mission_post_reports from authenticated;

-- O mural atravessa escolas de propósito: uma escola vê o que a outra fez.
-- Mas só para quem está autenticado — nunca aberto na internet.
create policy "mural visível a quem está autenticado" on public.mission_posts
  for select to authenticated using (
    hidden_at is null
    or profile_id = (select auth.uid())
    or public.is_collector_steward(collector_id)
  );

create policy "curtidas visíveis com o post" on public.mission_post_likes
  for select to authenticated using (
    exists (select 1 from public.mission_posts p where p.id = post_id and (p.hidden_at is null or p.profile_id = (select auth.uid())))
  );

-- Denúncia é assunto de quem denunciou e de quem decide.
create policy "denúncias visíveis a quem denunciou e aos responsáveis" on public.mission_post_reports
  for select to authenticated using (
    profile_id = (select auth.uid())
    or public.is_collector_steward((select p.collector_id from public.mission_posts p where p.id = post_id))
  );

-- ---------------------------------------------------------------------
-- 6. Mural pronto para a tela
-- ---------------------------------------------------------------------
-- Só dado de EXIBIÇÃO: apelido, avatar e escola. Nome, sexo e data de nascimento
-- de quem postou nunca saem daqui — são de outra escola, e são de menores.

create or replace view public.mission_wall
with (security_invoker = true) as
select
  p.id,
  p.created_at,
  p.image_path,
  p.caption,
  p.school_id,
  s.name as school_name,
  c.location as collector_location,
  author.nickname,
  author.avatar_id,
  author.grade_phase,
  e.mission_id,
  e.delivered_liters,
  (select count(*) from public.mission_post_likes l where l.post_id = p.id) as likes
from public.mission_posts p
join public.profiles author on author.id = p.profile_id
join public.schools s on s.id = p.school_id
join public.collectors c on c.id = p.collector_id
join public.mission_executions e on e.id = p.execution_id
where p.hidden_at is null;

revoke all on public.mission_wall from anon, authenticated;
grant select on public.mission_wall to authenticated;
