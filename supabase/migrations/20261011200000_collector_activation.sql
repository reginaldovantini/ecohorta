-- =====================================================================
-- EcoHorta Inteligente — 12: o captador assume o código ao ser habilitado
--
-- A migração anterior abriu espaço para três prefixos. Esta define quem nasce
-- com qual, e resolve o efeito colateral de um código que muda.
--
-- Um tubo recém-cadastrado nasce PROTO-nnn e assume ECO-nnn quando a calibração
-- é aceita. Só que, nessa hora, o ESP32 já está gravado — e ele envia o código
-- junto da telemetria, como conferência de que a placa certa está no tubo certo.
-- Se a plataforma passasse a reconhecer apenas o código novo, todo captador
-- seria desautenticado no instante em que desse certo, e a pessoa teria que
-- regravar a placa justamente depois de acertar a parte mais difícil.
--
-- Então o código de protótipo fica guardado: continua valendo como identidade
-- daquela placa para sempre, e serve de histórico ("ECO-002 foi o PROTO-005").
-- =====================================================================

-- Ninguém nasce ECO: o default do cadastro é protótipo.
alter table public.collectors alter column prefix set default 'PROTO';

alter table public.collectors
  /**
   * Código que este captador teve enquanto era obra (PROTO-nnn).
   *
   * Preenchido no cadastro e nunca apagado. A autenticação do dispositivo aceita
   * tanto `code` quanto `proto_code`, porque o firmware gravado antes da
   * calibração carrega o código antigo.
   *
   * Não entra no grant de `authenticated`: é dado de administração, não aparece
   * no app do usuário.
   */
  add column proto_code text check (proto_code is null or proto_code ~ '^PROTO-\d{3,6}$');
