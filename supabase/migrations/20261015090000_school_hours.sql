-- =====================================================================
-- EcoHorta Inteligente — 17: quando o ar-condicionado está ligado
--
-- O captador não enche sozinho: ele enche quando o ar-condicionado daquele
-- bloco está ligado, e ele só está ligado quando há aula ali. Fora disso a
-- escola está fechada, o aparelho desligado, e dentro do tubo não entra uma
-- gota.
--
-- Sem isto a plataforma errava duas coisas, as duas em silêncio:
--
--   1. AVISO. O tubo que ficou quase cheio na sexta continua quase cheio no
--      domingo. O celular de um estudante tocaria de seis em seis horas, o fim
--      de semana inteiro, sobre algo que ele não tem como resolver — e ele
--      desligaria o canal, perdendo também o aviso de segunda-feira.
--
--   2. ESTIMATIVA OFFLINE. A placa que cala na sexta às 17h voltaria no domingo
--      "estimando" 48 horas de entrada num tubo onde não caiu uma gota.
--
-- O horário fica em DOIS lugares, e isso é de propósito:
--
--   * na ESCOLA, como padrão — ela informa uma vez e os captadores herdam;
--   * no CAPTADOR, como verdade — porque a água vem de UM ar-condicionado, e
--     numa escola grande o bloco das salas e o bloco da administração não
--     funcionam no mesmo horário. Perguntar no cadastro do captador é
--     perguntar a quem está olhando para o aparelho.
--
-- Sábado letivo — quatro ou cinco por ano na Clarinda — NÃO vira calendário de
-- exceções: lista de exceção é lista que alguém esquece de atualizar. Nesses
-- dias quem diz que a escola está aberta é a própria água subindo no tubo.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. O padrão da escola
-- ---------------------------------------------------------------------

alter table public.schools
  /** Fuso da escola. A plataforma roda em UTC; a escola, não. */
  add column time_zone text not null default 'America/Campo_Grande'
    check (char_length(time_zone) between 3 and 60),
  /** Dias letivos: 0 = domingo … 6 = sábado. */
  add column school_weekdays smallint[] not null default '{1,2,3,4,5}'
    check (array_length(school_weekdays, 1) between 1 and 7
       and school_weekdays <@ '{0,1,2,3,4,5,6}'::smallint[]),
  /** Expediente, em minutos desde a meia-noite local. 420 = 7h; 1050 = 17h30. */
  add column school_start_minutes smallint not null default 420
    check (school_start_minutes between 0 and 1439),
  add column school_end_minutes smallint not null default 1050
    check (school_end_minutes between 1 and 1440),
  add constraint school_hours_order check (school_end_minutes > school_start_minutes);

-- A escola que originou o projeto tem horário conhecido: 7h10 às 16h30.
update public.schools
set school_start_minutes = 430, school_end_minutes = 990
where name = 'EE Prof.ª Clarinda Mendes de Aquino';

-- ---------------------------------------------------------------------
-- 2. O horário daquele ar-condicionado
-- ---------------------------------------------------------------------
-- É este que a plataforma usa para decidir aviso e estimativa. Nasce igual ao
-- da escola no cadastro do captador, e se separa dela quando o bloco tem
-- horário próprio.

alter table public.collectors
  add column ac_weekdays smallint[] not null default '{1,2,3,4,5}'
    check (array_length(ac_weekdays, 1) between 1 and 7
       and ac_weekdays <@ '{0,1,2,3,4,5,6}'::smallint[]),
  add column ac_start_minutes smallint not null default 420
    check (ac_start_minutes between 0 and 1439),
  add column ac_end_minutes smallint not null default 1050
    check (ac_end_minutes between 1 and 1440),
  add constraint ac_hours_order check (ac_end_minutes > ac_start_minutes);

-- Captadores já cadastrados herdam o horário da escola deles.
update public.collectors c
set ac_weekdays = s.school_weekdays,
    ac_start_minutes = s.school_start_minutes,
    ac_end_minutes = s.school_end_minutes
from public.schools s
where s.id = c.school_id;

-- O fuso vem sempre da escola: um captador não fica em outro fuso que a escola dele.
