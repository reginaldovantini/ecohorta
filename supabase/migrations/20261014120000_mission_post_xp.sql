-- =====================================================================
-- EcoHorta Inteligente — 15: o bônus por registrar a evidência
--
-- A pontuação base continua vindo do volume MEDIDO, e isso não muda: é o que
-- impede a plataforma de premiar quem pede muita água e não a usa.
--
-- O que entra é um BÔNUS por registrar a missão com uma foto. Ele existe porque
-- o mural é o que faz outra turma querer fazer missão — e porque uma evidência
-- vale alguma coisa a mais do que nenhuma.
--
-- O bônus é bônus de propósito, nunca a pontuação: quem não autoriza o uso da
-- imagem recebe a pontuação base igual e continua no ranking. Se a foto valesse
-- a nota, um estudante ficaria fora do ranking por uma decisão de imagem que
-- não tem nada a ver com economizar água.
--
-- CURTIDA CONTINUA SEM VALER PONTO. Se valesse, dois estudantes curtindo um ao
-- outro subiriam no ranking sem economizar uma gota.
-- =====================================================================

-- O livro-razão do XP passa a reconhecer a origem "publicação da missão". A
-- restrição `xp_once_per_source` já garante o resto: um bônus por publicação,
-- quantas vezes a pessoa tente.
alter table public.xp_transactions drop constraint xp_transactions_source_type_check;
alter table public.xp_transactions
  add constraint xp_transactions_source_type_check
  check (source_type in ('mission_execution', 'mission_post', 'adjustment'));
