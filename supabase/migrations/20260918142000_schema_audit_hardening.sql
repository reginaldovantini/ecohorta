-- =====================================================================
-- EcoHorta Inteligente — 6: correções da auditoria do schema (antes do Supabase real)
--
-- 1. Telemetria é dado físico primário: apagar um dispositivo não pode apagar as
--    leituras dele. Dispositivos não são apagados; são desativados (active = false).
-- 2. Índices em todas as chaves estrangeiras (junções e verificações ao apagar).
-- 3. Privilégios que sobraram dos padrões do Supabase: TRUNCATE ignora o RLS.
-- 4. search_path fixo nas funções de gatilho (recomendação de segurança do Supabase).
-- 5. auth.uid() e my_school_id() avaliados uma vez por consulta nas políticas
--    (mesmas regras, recomendação de desempenho do Supabase).
-- Nenhuma regra de acesso muda: só integridade, desempenho e privilégios residuais.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. dispositivo → telemetria: sem apagar o histórico em cascata
-- ---------------------------------------------------------------------
-- NO ACTION (verificado no fim do comando): um dispositivo com leituras não é apagado.
-- Apagar o captador inteiro continua removendo telemetria e dispositivos juntos
-- (e é bloqueado quando há calibrações, observações ou validações).
alter table public.telemetry drop constraint telemetry_device_id_fkey;
alter table public.telemetry
  add constraint telemetry_device_id_fkey foreign key (device_id) references public.devices (id) on delete no action;

-- ---------------------------------------------------------------------
-- 2. Índices nas chaves estrangeiras sem índice
-- ---------------------------------------------------------------------
create index telemetry_device_recorded_idx on public.telemetry (device_id, recorded_at desc);
create index device_commands_device_idx on public.device_commands (device_id);
create index device_commands_calibration_idx on public.device_commands (calibration_id) where calibration_id is not null;
create index collector_state_device_idx on public.collector_state (device_id);
create index collector_state_calibration_idx on public.collector_state (calibration_id);
create index collector_state_bench_started_by_idx on public.collector_state (bench_started_by);
create index collector_calibrations_device_idx on public.collector_calibrations (device_id);
create index collector_calibrations_created_by_idx on public.collector_calibrations (created_by);
create index calibration_validations_device_idx on public.calibration_validations (device_id);
create index calibration_validations_created_by_idx on public.calibration_validations (created_by);
create index sensor_observations_device_idx on public.sensor_observations (device_id);
create index sensor_observations_created_by_idx on public.sensor_observations (created_by);
create index sensor_observations_calibration_idx on public.sensor_observations (calibration_id) where calibration_id is not null;
create index collector_hardware_changes_changed_by_idx on public.collector_hardware_changes (changed_by);
create index collector_hardware_changes_superseded_idx on public.collector_hardware_changes (superseded_calibration_id) where superseded_calibration_id is not null;
create index collector_hardware_changes_cancelled_idx on public.collector_hardware_changes (cancelled_calibration_id) where cancelled_calibration_id is not null;
create index collectors_hardware_updated_by_idx on public.collectors (hardware_updated_by);
create index guardian_consents_recorded_by_idx on public.guardian_consents (recorded_by);

-- ---------------------------------------------------------------------
-- 3. Privilégios residuais (usuários só leem pelo Supabase; toda escrita passa pela API)
-- ---------------------------------------------------------------------
revoke truncate, trigger, references on all tables in schema public from anon, authenticated;
revoke insert, update, delete on public.profile_xp, public.participant_age_bands from anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. search_path fixo nas funções de gatilho (todas usam nomes qualificados)
-- ---------------------------------------------------------------------
alter function public.touch_updated_at() set search_path = '';
alter function public.validate_person_record() set search_path = '';
alter function public.protect_calibration_history() set search_path = '';
alter function public.protect_experimental_record() set search_path = '';
alter function public.guard_collector_hardware() set search_path = '';
alter function public.protect_hardware_change() set search_path = '';

-- ---------------------------------------------------------------------
-- 5. Políticas: mesmas regras, com auth.uid() e my_school_id() avaliados uma vez
-- ---------------------------------------------------------------------
alter policy "membros veem a própria escola" on public.schools
  using (id = (select public.my_school_id()));
alter policy "membros veem as turmas da escola" on public.school_classes
  using (school_id = (select public.my_school_id()));
alter policy "comunidade vê perfis de exibição" on public.profiles
  using (school_id = (select public.my_school_id()));
alter policy "usuário edita o próprio apelido e avatar" on public.profiles
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
alter policy "cadastro visível ao próprio usuário e educadores" on public.person_records
  using (
    profile_id = (select auth.uid())
    or public.is_school_educator((select p.school_id from public.profiles p where p.id = profile_id))
  );
alter policy "membros veem captadores da escola" on public.collectors
  using (school_id = (select public.my_school_id()));
alter policy "membros veem o estado dos captadores da escola" on public.collector_state
  using (exists (select 1 from public.collectors c where c.id = collector_id and c.school_id = (select public.my_school_id())));
alter policy "membros veem a telemetria da escola" on public.telemetry
  using (exists (select 1 from public.collectors c where c.id = collector_id and c.school_id = (select public.my_school_id())));
alter policy "comandos visíveis a quem pediu e a educadores" on public.device_commands
  using (
    requested_by = (select auth.uid())
    or public.is_school_educator((select c.school_id from public.collectors c where c.id = collector_id))
  );
alter policy "execuções visíveis ao participante e a educadores" on public.mission_executions
  using (
    profile_id = (select auth.uid())
    or public.is_school_educator((select c.school_id from public.collectors c where c.id = collector_id))
  );
alter policy "xp visível ao participante e a educadores" on public.xp_transactions
  using (
    profile_id = (select auth.uid())
    or public.is_school_educator((select p.school_id from public.profiles p where p.id = profile_id))
  );
alter policy "membros veem as calibrações dos captadores da escola" on public.collector_calibrations
  using (exists (select 1 from public.collectors c where c.id = collector_id and c.school_id = (select public.my_school_id())));
alter policy "membros veem as observações de bancada da escola" on public.sensor_observations
  using (exists (select 1 from public.collectors c where c.id = collector_id and c.school_id = (select public.my_school_id())));
alter policy "membros veem as validações da escola" on public.calibration_validations
  using (exists (select 1 from public.collectors c where c.id = collector_id and c.school_id = (select public.my_school_id())));
alter policy "membros veem o histórico de hardware da escola" on public.collector_hardware_changes
  using (exists (select 1 from public.collectors c where c.id = collector_id and c.school_id = (select public.my_school_id())));
