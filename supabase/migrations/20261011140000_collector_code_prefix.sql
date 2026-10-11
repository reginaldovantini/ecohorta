-- =====================================================================
-- EcoHorta Inteligente — 9: prefixo do código do captador
--
-- A sequência automática passou a numerar tudo como EC-001, EC-002... e com
-- isso o captador da SIMULAÇÃO tomou o EC-001, empurrando o captador FÍSICO
-- para EC-002. A convenção do projeto é a inversa e está em todo lugar
-- (README, docs/HARDWARE.md, comentários do firmware):
--
--   EC-nnn  → captador FÍSICO (ESP32 + sensor)
--   SIM-nnn → captador da SIMULAÇÃO (dispositivo virtual)
--
-- Cada prefixo passa a ter a própria sequência dentro da escola. A regra de
-- "sequencial e sem repetir" continua valendo — agora em duas faixas.
-- =====================================================================

alter table public.collectors
  add column prefix text not null default 'EC' check (prefix in ('EC', 'SIM'));

-- O prefixo acompanha o código que já existe, para a coluna não nascer mentindo.
update public.collectors set prefix = split_part(code, '-', 1) where split_part(code, '-', 1) in ('EC', 'SIM');

alter table public.collectors drop constraint collectors_seq_unique_per_school;
alter table public.collectors add constraint collectors_seq_unique_per_school unique (school_id, prefix, seq);
