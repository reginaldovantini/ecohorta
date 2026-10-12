-- =====================================================================
-- EcoHorta Inteligente — 14: índice que faltou em admin_grants
--
-- A auditoria de schema (src/lib/server/db/schema.test.ts) exige índice em
-- toda chave estrangeira, e `granted_by` passou sem um. Sem ele, apagar um
-- perfil obriga o Postgres a varrer a tabela inteira para resolver o
-- `on delete set null`.
--
-- Vem em arquivo próprio, e não corrigindo a migration anterior, porque
-- aquela já foi aplicada: migration aplicada não se reescreve, sob pena de
-- bancos iguais no papel e diferentes na prática.
-- =====================================================================

create index admin_grants_granted_by_idx on public.admin_grants (granted_by);
