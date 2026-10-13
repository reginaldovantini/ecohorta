-- =====================================================================
-- EcoHorta Inteligente — 14: a linha do tempo do captador
--
-- A jornada de construção ganhou duas pontas que faltavam.
--
-- No começo, o número de alunos MATRICULADOS na escola. Sem ele, "280 missões
-- cumpridas" é um número solto: não dá para dizer se a escola envolveu metade
-- dos estudantes ou uma turma. Com ele, o projeto consegue afirmar alcance, que
-- é o que uma secretaria de educação pergunta primeiro.
--
-- No fim, a VERIFICAÇÃO: uma etapa que não pede nada e só responde "o captador
-- está no ar e as missões estão liberadas". Ela não é marcada à mão — vem dos
-- mesmos fatos de sempre — e por isso não entra na lista de etapas marcáveis.
--
-- E no meio, 'personalizacao' vira 'identificacao'. A mudança não é de nome: a
-- etapa deixa de ser "enfeitar o tubo" e passa a ser "colar o QR Code sem o
-- qual nenhuma missão começa". Arte é opcional; identificação não é.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Quantos estudantes a escola tem
-- ---------------------------------------------------------------------
-- Opcional de propósito: escola cadastrada antes desta coluna continua válida,
-- e a tela pede o número quando ele falta em vez de barrar o cadastro.

alter table public.schools
  add column enrolled_students integer
    check (enrolled_students is null or enrolled_students between 1 and 200000);

-- ---------------------------------------------------------------------
-- 2. Etapas marcadas à mão: de enum para texto com restrição
-- ---------------------------------------------------------------------
-- O enum obrigava uma migração de tipo a cada etapa nova, e `alter type ... add
-- value` não pode ser usado na mesma transação que o cria — o que torna
-- renomear uma etapa uma operação em dois passos, com o banco inconsistente no
-- meio. A lista real de etapas vive no código (MANUAL_STEPS), que é quem recusa
-- antes de chegar aqui; o banco guarda a última palavra numa restrição simples.

alter table public.collector_setup_marks
  alter column step type text using step::text;

update public.collector_setup_marks set step = 'identificacao' where step = 'personalizacao';

drop type public.setup_step;

alter table public.collector_setup_marks
  add constraint collector_setup_marks_step_check check (step in ('montagem', 'identificacao'));
