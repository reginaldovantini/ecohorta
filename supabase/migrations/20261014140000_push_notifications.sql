-- =====================================================================
-- EcoHorta Inteligente — 16: o aviso que chega sem o app aberto
--
-- O tubo enche sozinho, de madrugada, no fim de semana. Quando passa de 95% a
-- água começa a escorrer pelo dreno — e até agora só descobria isso quem
-- abrisse o aplicativo por acaso. A missão de resgate existia e ninguém era
-- chamado para ela.
--
-- Duas tabelas, e as duas existem por uma razão de contenção:
--
--   1. ONDE AVISAR. Uma pessoa tem vários aparelhos, e cada aparelho tem um
--      endereço próprio. O endereço é a chave: o mesmo celular reinstalando o
--      app gera outro, e o antigo simplesmente para de responder.
--
--   2. QUANDO JÁ SE AVISOU. Sem isto, telemetria a cada três segundos viraria
--      um aviso a cada três segundos. O registro de envio é o que transforma
--      "o tubo está cheio" em UM aviso, e não em perseguição.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Aparelhos inscritos
-- ---------------------------------------------------------------------

create table public.push_subscriptions (
  -- O endereço do serviço de push é único por aparelho e é ele que identifica.
  endpoint text primary key check (char_length(endpoint) between 20 and 1000),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  -- Chaves da criptografia ponta a ponta do Web Push. Sem elas o navegador
  -- recusa a mensagem: nem o serviço de push lê o conteúdo.
  p256dh text not null check (char_length(p256dh) between 10 and 200),
  auth text not null check (char_length(auth) between 10 and 100),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index push_subscriptions_profile_idx on public.push_subscriptions (profile_id);

-- ---------------------------------------------------------------------
-- 2. Avisos já enviados por captador
-- ---------------------------------------------------------------------
-- Uma linha por captador e tipo de aviso. O envio seguinte do mesmo tipo só
-- acontece depois do intervalo de silêncio, decidido na aplicação.

create table public.collector_alerts (
  collector_id uuid not null references public.collectors (id) on delete cascade,
  kind text not null check (kind in ('attention', 'critical')),
  sent_at timestamptz not null default now(),
  primary key (collector_id, kind)
);

-- ---------------------------------------------------------------------
-- 3. RLS
-- ---------------------------------------------------------------------
-- Nenhuma das duas é lida pelo navegador: a inscrição entra por rota autenticada
-- e o envio acontece no servidor. Fechadas para `authenticated` e `anon`.

alter table public.push_subscriptions enable row level security;
alter table public.collector_alerts enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;
revoke all on public.collector_alerts from anon, authenticated;
