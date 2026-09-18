# Banco de dados — mapa, relações e auditoria

> 18/09/2026. Fonte oficial dos dados: **Postgres do Supabase**. Nada crítico fica em `localStorage` ou na memória do servidor.
> Migrations em `supabase/migrations/`, aplicadas em ordem por `npm run db:migrate` e validadas nos testes com PostgreSQL real (PGlite).

## 1. Migrations

| Arquivo | Conteúdo |
|---|---|
| `20260914000000_identity.sql` | Escolas, turmas, perfis, cadastro, consentimento, funções de acesso e RLS |
| `20260915000000_collectors_missions_xp.sql` | Captadores, dispositivos, estado, telemetria, comandos, execuções e XP |
| `20260917000000_volume_calibration.sql` | Calibrações versionadas e volume derivado |
| `20260917010000_physical_validation.sql` | Bancada, observações e validações experimentais |
| `20260917230000_distance_sensor_configuration.sql` | Sensor de distância, revisão de hardware e histórico de trocas |
| `20260918142000_schema_audit_hardening.sql` | Correções desta auditoria (§5) |

## 2. Relações

```text
auth.users ──1:1──► profiles ──► person_records (cadastro)   profiles ──► guardian_consents
                       │ school_id, class_id
schools ──► school_classes
   │
   └──► collectors ──1:1──► collector_state (última leitura, balanço, ensaio de bancada)
            │  distance_sensor + hardware_revision (configuração de hardware)
            ├──► devices (ESP32 ou virtual; token só em hash; 1 ativo por captador)
            │       ├──► telemetry (histórico de leituras)
            │       └──► device_commands (liberações) ──1:1──► mission_executions ──► xp_transactions
            ├──► collector_calibrations (versões) ──► calibration_validations
            ├──► sensor_observations
            └──► collector_hardware_changes (trocas de sensor)
```

| Relação | Chave | Ao apagar o pai |
|---|---|---|
| escola → captador | `collectors.school_id` | bloqueia (RESTRICT) |
| captador → dispositivo | `devices.collector_id` | apaga junto (CASCADE) |
| captador → estado | `collector_state.collector_id` | apaga junto |
| dispositivo → telemetria | `telemetry.device_id` | **bloqueia** (NO ACTION): dispositivos são desativados, nunca apagados |
| captador → telemetria | `telemetry.collector_id` | apaga junto |
| dispositivo → comandos | `device_commands.device_id` | mantém o comando (SET NULL) |
| captador → comandos e execuções | `collector_id` | apaga junto |
| captador → calibrações, observações, validações, trocas de hardware | `collector_id` | **bloqueia**: histórico experimental nunca é apagado |
| calibração → validações, telemetria, estado, comandos | `calibration_id` | bloqueia |
| perfil → execuções, XP, cadastro | `profile_id` | apaga junto (direito de exclusão do estudante, LGPD) |
| perfil → autoria (calibrou, registrou, trocou) | `created_by`, `changed_by`… | mantém o registro, autoria vira nula |

**Integridade além das chaves:**
- **Um dispositivo ativo por captador:** índice único `devices_one_active_per_collector`.
- **Uma liberação ativa por captador:** índice único.
- **XP uma vez por execução:** `xp_once_per_source`.
- **Calibrações:** uma ativa e um rascunho por captador, versão única e histórico imutável (gatilho `protect_calibration_history`).
- **Registros experimentais e trocas de hardware:** imutáveis (gatilhos `protect_experimental_record` e `protect_hardware_change`).
- **Troca do sensor:** exige a próxima revisão de hardware (gatilho `guard_collector_hardware`).
- **Coerência entre volume e origem:** `telemetry_volume_matches_source` e `collector_state_volume_matches_source`.

**Não imposto pelo banco (documentado):** a telemetria não amarra o dispositivo ao captador com chave composta, porque um dispositivo pode ser transferido de captador sem reescrever o histórico. O servidor só aceita telemetria de um dispositivo autenticado para o captador dele.

## 3. Acesso (RLS)

- **RLS ativo nas 16 tabelas.** `anon` não tem acesso. `authenticated` só **lê**, limitado à escola (`my_school_id()`) e, em dados pessoais, ao próprio usuário ou a educadores (`is_school_educator()`).
- **`devices` não é legível por usuários:** guarda o hash do token.
- **Toda escrita passa pela API** (servidor com conexão privilegiada), com as regras de negócio e validação.
- **Views** `profile_xp` e `participant_age_bands` usam `security_invoker`, ou seja, respeitam o RLS de quem consulta.

## 4. Índices

Todas as chaves estrangeiras têm índice, o que é verificado por teste (`schema.test.ts` › "toda chave estrangeira tem índice"). Consultas frequentes:
- telemetria por captador ou dispositivo e data;
- comandos ativos;
- calibrações por versão;
- observações e validações por captador.

## 5. Auditoria de 18/09/2026

Problemas encontrados e corrigidos em `20260918142000_schema_audit_hardening.sql`:

| # | Encontrado | Correção |
|---|---|---|
| 1 | `telemetry.device_id` com ON DELETE CASCADE: apagar um dispositivo apagaria as leituras físicas | NO ACTION; dispositivos são desativados (`active = false`) |
| 2 | 18 chaves estrangeiras sem índice (entre elas `telemetry.device_id`) | Índices criados |
| 3 | `anon`/`authenticated` ainda com TRUNCATE, TRIGGER e REFERENCES (padrões do Supabase), e escrita nas views | Privilégios revogados. TRUNCATE ignora o RLS |
| 4 | Funções de gatilho sem `search_path` fixo | `search_path = ''` (todas usam nomes qualificados) |
| 5 | Políticas avaliando `auth.uid()`/`my_school_id()` por linha | `(select …)`: avaliadas uma vez por consulta, com as mesmas regras |

Os testes de RLS existentes continuam passando sem alteração, o que confirma que as regras de acesso não mudaram.

## 6. Firmware e OTA — Fase C (planejado, ainda não criado)

As tabelas abaixo são necessárias para a atualização remota. Serão criadas junto com a API OTA, **na Fase C**, depois de o ESP32 funcionar com a plataforma (Fase B).

| Tabela | Para quê |
|---|---|
| `firmware_versions` | Versão, placa-alvo, sensores suportados, SHA-256, tamanho, assinatura, local do binário, estado (rascunho/disponível/revogada), obrigatória, versão mínima de origem |
| `device_firmware` | Versão instalada, versão anterior (rollback) e última verificação, por dispositivo |
| `firmware_update_events` | Histórico imutável: AVAILABLE → DOWNLOADING → INSTALLING → SUCCESS / FAILED / ROLLBACK, com detalhe do erro |

**Compatibilidade:**
- Hoje, `collectors.hardware_revision` é a revisão da **configuração do sensor** do captador (muda a cada troca de sensor), e não a revisão física da placa.
- O firmware atual suporta os dois sensores. Por isso a compatibilidade do OTA deve ser verificada por **placa/perfil de hardware** (ex.: `esp32dev` + ligação I²C GPIO21/22) e pelos **sensores suportados**.
- A proposta detalhada vem na Fase C, para aprovação.
