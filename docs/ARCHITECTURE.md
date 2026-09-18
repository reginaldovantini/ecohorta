# Arquitetura — EcoHorta Inteligente

> Documento vivo. Atualize sempre que uma decisão mudar.

## 1. Visão geral

```text
ESP32 ────────HTTPS──┐
                     ├─► /api/iot/* ─┐
Dispositivo virtual ─┘               │   Next.js (Route Handlers) na Vercel
(mesmo contrato, SIMULAÇÃO)          ├─► Postgres do Supabase (fonte oficial) + RLS
PWA ──cookie de sessão──► /api/* ────┘   Supabase Auth (identidade)
```

| Camada | Responsável por |
|---|---|
| **ESP32 (DevKit V1)** | Leitura e filtragem do sensor de distância configurado na plataforma (VL53L0X ou VL53L1X; envia a distância, e o volume é calculado no servidor pela calibração), válvula (etapa futura), segurança, telemetria |
| **API** (`src/app/api`) | Autenticar usuários e dispositivos, autorizar, validar payloads (zod), aplicar as regras e gravar tudo no banco |
| **Supabase** | Postgres (estado, telemetria, comandos, execuções, XP), Auth (sessões), RLS |
| **PWA** | Experiência do estudante e da equipe. Só exibe o que a API devolve |

## 2. Fonte oficial e persistência

O **servidor é a única autoridade**. Nada crítico fica em memória do processo nem no navegador.

| Dado | Onde fica |
|---|---|
| Estado atual do captador (última leitura, contabilidade hídrica, parâmetros da simulação) | `collector_state` |
| Histórico de telemetria (amostrado) | `telemetry` |
| Comandos de liberação | `device_commands` |
| Execuções de missão | `mission_executions` |
| XP (livro-razão) | `xp_transactions` → saldo pela soma (`profile_xp`) |
| Perfis e cadastro | `profiles`, `person_records`, `guardian_consents` |

- **Serverless:** `src/lib/server/collector-service.ts` recebe o banco por parâmetro e não guarda estado. O único objeto global é o *pool* de conexões (`src/lib/server/db/pg.ts`).
- **Concorrência:** cada operação que altera um captador trava a linha de `collector_state` (`SELECT … FOR UPDATE`). Telemetria, pedidos e cancelamentos simultâneos são serializados.
- **Telemetria amostrada:** grava no histórico quando passam 30 s, quando o volume muda ≥ 0,05 L ou quando mudam válvula, status ou transbordamento. O estado atual é sempre atualizado.
- **Conexão:** `DATABASE_URL` usa o *Transaction pooler* do Supabase (compatível com funções serverless). O servidor conecta como dono das tabelas; usuários do Supabase (`authenticated`) só leem o que o RLS permite.

## 3. Fonte de dados das telas

Toda tela lê o captador por `CollectorDataSource` (`src/lib/iot/data-source.ts`), implementada por `src/lib/iot/api-source.ts`:

- somente a API da plataforma, nunca o dispositivo;
- polling de 3 s parado e 1 s durante uma liberação, pausado com a aba oculta;
- resposta 401 → sessão encerrada → tela de entrada.

O perfil (identidade, XP e histórico) vem de `GET /api/me` (`src/lib/student/profile-store.ts`).

- **Convenção:** **EC-001** é o captador FÍSICO (ESP32-001 + sensor VL53L0X ou VL53L1X configurado na plataforma, REAL). **SIM-001** é o captador da SIMULAÇÃO (VIRTUAL-001). As telas mostram sempre o selo **REAL** ou **SIMULAÇÃO**. Com mais de um captador, um seletor escolhe qual exibir; a escolha fica só no aparelho, como preferência de tela.
- **Dispositivo virtual do SIM-001** (`tools/virtual-device/run.ts`, `is_simulated = true`): processo Node que se comporta como o ESP32 e usa a **mesma API**. Emula a física (Torricelli) e o firmware (ruído, mediana, `NO_FLOW`, `TIMEOUT`, cancelamento, idempotência) e converte distância em volume com a **mesma função do servidor**. O token vem do `.env.local` (gerado por `npm run db:seed`); o banco guarda só o hash.
- **ESP32 real (EC-001):** `is_simulated = false`, token próprio (`npm run admin -- register-device --collector EC-001 …`). Envia a distância e o diagnóstico do sensor configurado; as telas não mudam.
- **Troca de tipo:** ligar um dispositivo REAL a um captador que era da SIMULAÇÃO (ou o contrário) recomeça o estado, as leituras e o balanço desse captador. A calibração ativa passa a substituída; o histórico fica preservado.
- `DataOrigin` (`"device" | "simulation"`) acompanha cada leitura, comando e execução. Um dado simulado nunca é exibido sem o selo SIMULAÇÃO.

## 4. Autenticação e autorização

### Autenticação

| Perfil | Como entra | Rota |
|---|---|---|
| Estudante | Código de acesso + PIN de 6 dígitos (sem e-mail pessoal) | `POST /api/auth/student` |
| Professor, funcionário, admin | E-mail + senha | `POST /api/auth/login` |
| Dispositivo | `Authorization: Bearer <token>` | `/api/iot/*` |

- Contas criadas somente pelo script de administração (`scripts/admin.ts`). O cadastro público do Supabase Auth fica desativado.
- **Estudante:** o código (ex.: `6C-K3QX`) é traduzido no servidor para um identificador sintético não roteável (`6c-k3qx@alunos.ecohorta.invalid`; o domínio `.invalid` é reservado pela RFC 2606). O PIN é a senha no Supabase Auth.
- **Sessão:** cookies httpOnly do `@supabase/ssr`. Cada rota valida o JWT (`auth.getClaims()`) e carrega o perfil **ativo** do banco (`src/lib/server/auth.ts`). Papel, escola e identidade nunca vêm do navegador.
- **Dispositivo:** o token é comparado pelo hash `sha256(IOT_TOKEN_PEPPER:token)`, em tempo constante, e precisa corresponder ao `collector_code` enviado.

### Autorização

| Ação | Quem pode |
|---|---|
| Ver captadores, estado e telemetria | Membros da mesma escola |
| Pedir liberação (`POST commands`) | Qualquer participante autenticado da escola. **O volume vem da missão no servidor**; o valor enviado pelo navegador é ignorado |
| Acompanhar e cancelar um comando | Quem pediu, ou professor/admin da escola |
| Controlar a simulação | Somente professor/admin (a interface também esconde o painel) |
| Enviar telemetria | Somente o dispositivo com token válido |
| Alterar apelido/avatar | O próprio usuário (`PATCH /api/me`) |

Outra escola recebe 404 (o recurso "não existe" para ela).

### XP

`missão → comando → execução confirmada pelo sensor (COMPLETED) → validação no servidor → xp_transactions → saldo → nível/conquistas`

- O XP da missão vem do catálogo no servidor (`src/lib/missions/catalog.ts`).
- `xp_once_per_source` (único por perfil + execução) impede XP duplicado, mesmo com relatórios repetidos.
- Falha e cancelamento não geram XP. A água medida em um cancelamento conta como reúso.
- Nível e conquistas são calculados a partir do saldo e do histórico que o servidor devolve.

## 5. Contrato IoT

Validado com zod em `src/lib/iot/api-schema.ts`.

| Rota | Quem chama | Função |
|---|---|---|
| `POST /api/iot/telemetry` | Dispositivo | Distância (e, opcionalmente, volume) + relatório do comando; recebe o comando pendente e o próximo intervalo |
| `GET /api/iot/simulation` | Dispositivo virtual | Canal de controle enquanto simula estar offline |
| `GET /api/collectors` | App (login) | Captadores da escola |
| `GET /api/collectors/{code}` | App (login) | Snapshot: telemetria, tendência, balanço e parâmetros da simulação |
| `POST /api/collectors/{code}/commands` | App (login) | Pede liberação (idempotente por `command_id`) |
| `GET /api/collectors/{code}/commands/{id}` | App (dono/educador) | Andamento |
| `POST /api/collectors/{code}/commands/{id}/cancel` | App (dono/educador) | Fechamento da válvula |
| `POST /api/collectors/{code}/simulation` | Professor/admin | Velocidade, condensado, nível e falhas. Recusado para captadores reais |
| `GET/PATCH /api/me` | App (login) | Perfil, XP, histórico; apelido e avatar |
| `POST /api/auth/student`, `/login`, `/logout` | App | Sessão |

### `POST /api/iot/telemetry`

```json
{
  "device_id": "VIRTUAL-001",
  "collector_code": "SIM-001",
  "seq": 18233,
  "uptime_ms": 86400000,
  "distance_mm": 842,
  "volume_liters": 7.42,
  "sensor_model": "VL53L1X",
  "hardware_revision": 1,
  "sensor_diagnostics": { "sensor_state": "ready", "model_id": "0xEACC", "i2c_ack": true, "i2c_clock_hz": 100000, "samples": 9, "valid_samples": 9 },
  "valve": "closed",
  "status": "READY",
  "fw_version": "virtual-0.2.0",
  "applied_simulation_action_id": 3,
  "command_report": {
    "command_id": "0b7c…",
    "status": "COMPLETED",
    "delivered_liters": 2.98,
    "start_volume_liters": 10.40,
    "end_volume_liters": 7.42,
    "failure": null,
    "started_uptime_ms": 86280000,
    "finished_uptime_ms": 86394000
  }
}
```

Resposta — o comando pendente vem junto, economizando requisições:

```json
{
  "server_time": 1789000000000,
  "next_poll_ms": 3000,
  "command": { "command_id": "0b7c…", "action": "dispense", "target_liters": 3, "max_duration_ms": 240000 },
  "simulation": null,
  "hardware": { "distance_sensor": "VL53L1X", "revision": 1 }
}
```

- **Configuração de hardware:** toda resposta leva o sensor configurado na plataforma (`hardware`). O firmware usa o driver desse sensor e informa, na telemetria seguinte, o driver em uso (`sensor_model`) e a revisão aplicada (`hardware_revision`). Ver §12.

- **Intervalo:** 3 s parado e 1 s com liberação ativa (definido pelo servidor, seguido pelo dispositivo virtual e pelo ESP32).
- **Idempotência:** `command_id` é chave primária; o servidor reenvia o comando até o primeiro relatório; relatórios de comandos finalizados são ignorados; o ESP32 guardará os IDs executados em NVS.
- **Offline:** sem telemetria por 15 s o captador aparece `OFFLINE`; comando não buscado em 30 s falha com `DEVICE_OFFLINE`.

## 6. Máquina de estados

### Execução

```text
QUEUED → EXECUTING → MEASURING → COMPLETED
   │         │            └────► FAILED (NO_FLOW, TIMEOUT, SENSOR_ERROR)
   │         └► cancelamento → CANCELLED (água medida conta como reúso)
   ├► CANCELLED (ainda na fila)
   └► FAILED (DEVICE_OFFLINE, DEVICE_BUSY, INSUFFICIENT_WATER)
```

| Estado | Significado físico |
|---|---|
| QUEUED | Comando criado; aguardando o dispositivo buscá-lo |
| EXECUTING | Válvula aberta; sensor acompanhando a queda do nível |
| MEASURING | Válvula fechada; aguardando a superfície estabilizar |
| COMPLETED | Volume **medido** registrado (não o comandado) |
| FAILED | Válvula fechada por segurança, com o motivo registrado |

### Dispositivo

`OFFLINE · ONLINE · READY · DISPENSING · CALIBRATING · ERROR · MAINTENANCE`

## 7. Regras de água

- **Disponível para missões** = volume medido − reserva mínima.
- Uma liberação ativa por captador, garantida por índice único parcial (`device_commands_one_active_per_collector`).
- **Taxa de aproveitamento** = reutilizado ÷ captado × 100.
- **Descartado:** sempre **estimado**. O sensor de distância não enxerga a água que sai pelo dreno.

## 8. Usuários e privacidade

| Camada | Conteúdo | Tabela | Quem vê |
|---|---|---|---|
| **Dados de exibição** | Apelido, avatar, perfil, turma ou função/setor | `profiles` | Comunidade da escola (sem o código de acesso) |
| **Dados cadastrais** | Nome, sobrenome, data de nascimento (só estudantes) | `person_records` | O próprio usuário e professores/admin da escola |

| Perfil | Cadastro (privado) | Exibição / função |
|---|---|---|
| Estudante | nome, sobrenome, data de nascimento | apelido, avatar, turma (com nível de ensino) |
| Professor | nome, sobrenome | função, apelido, avatar |
| Funcionário | nome, sobrenome | função, setor, apelido, avatar |
| Administrador | nome, sobrenome | função (opcional), apelido, avatar |

- **Idade:** nunca armazenada. Calculada por `ageOn()` (`src/lib/users/age.ts`) e pela view `participant_age_bands` (faixas, sem datas). Data no futuro é recusada por gatilho.
- **Escola e turma:** vêm do banco (`schools`, `school_classes`).
- **Primeiro acesso:** o participante escolhe apelido e avatar (`/boas-vindas`).
- **Consentimento do responsável (LGPD art. 14):** `guardian_consents` (método, data, quem registrou; o registro continua mesmo se a conta de quem registrou for removida).
- **Timeline e ranking:** apenas apelido.

## 9. Schema aplicado

Migrations em `supabase/migrations/` (aplicar com `npm run db:migrate`), validadas nos testes com PostgreSQL real (PGlite) e as mesmas regras de RLS. Mapa completo das relações, regras ao apagar, índices e auditoria: [BANCO_DE_DADOS.md](./BANCO_DE_DADOS.md).

| Grupo | Tabelas |
|---|---|
| Organização | `schools`, `school_classes`, `profiles`, `person_records`, `guardian_consents` |
| Hardware | `collectors`, `devices` (hash do token, `is_simulated`), `collector_state` |
| Dados | `telemetry` |
| Missões | `device_commands`, `mission_executions` |
| Jogo | `xp_transactions` (+ view `profile_xp`) |

**RLS** ativo em todas as tabelas: `anon` sem acesso; `authenticated` só leitura, restrita à escola e ao próprio usuário; `devices` nunca legível por usuários. Toda escrita passa pela API.

| Calibração | `collector_calibrations` (versionada, histórico imutável por gatilho, vinculada ao sensor e à revisão de hardware) |
| Configuração de hardware | `collectors.distance_sensor` e `hardware_revision`, `collector_hardware_changes` (histórico imutável das trocas de sensor) |

**Futuro (fora desta fase):** missões no banco, evidências, timeline, notificações, desafios.

## 10. Calibração de volume

Detalhes completos em [CALIBRACAO.md](./CALIBRACAO.md).

- **Dado primário:** `distance_mm` do sensor de distância (VL53L0X ou VL53L1X). **Volume derivado** no servidor: `V = k × (D0 − D)` pela calibração **ativa** do captador.
- **Vínculo com o hardware:** a calibração registra o sensor configurado e a revisão de hardware; só converte leituras com essa mesma configuração, do driver desse sensor (§12).
- **Com calibração ativa**, o `volume_liters` enviado pelo dispositivo é ignorado. Sem calibração, vale o do dispositivo; se o dispositivo só envia distância, o volume fica desconhecido (`volume_source = none`).
- **Procedimento guiado** (professor/admin): 0, 1, 2, 3 L e nível máximo.
  - Cada registro usa a leitura **estabilizada** do servidor (janela de leituras, mediana, outliers, variação e deriva).
  - Com a tela aberta, o servidor devolve `next_poll_ms = 1000`.
- **Conclusão:** ajuste por mínimos quadrados pela origem e validação de qualidade.
  - Consistente → nova versão **ativa**.
  - Inconsistente → versão **recusada**; a anterior continua valendo.
- **Histórico imutável** e troca de calibração sem alterar a água captada.

| Rota | Quem chama | Função |
|---|---|---|
| `GET /api/admin/collectors/{code}/calibration` | Professor/admin | Leitura ao vivo estabilizada, procedimento em andamento, versões |
| `POST /api/admin/collectors/{code}/calibration/session` | Professor/admin | Inicia o procedimento (cancela um anterior não concluído) |
| `DELETE /api/admin/collectors/{code}/calibration/session` | Professor/admin | Cancela o procedimento |
| `POST /api/admin/collectors/{code}/calibration/session/points` | Professor/admin | `{ step }`: registra a leitura estável da etapa (sem distância no corpo) |
| `POST /api/admin/collectors/{code}/calibration/session/complete` | Professor/admin | Calcula, valida e grava a versão |

Telas: `/admin/captadores` e `/admin/captadores/{code}/calibracao` (link em Perfil → Administração). A tela lê a API por `src/lib/iot/calibration-source.ts`, no mesmo padrão de `CollectorDataSource`.

## 11. Validação física: bancada, observações e validações

Detalhes em [HARDWARE.md §8](./HARDWARE.md) e [CALIBRACAO.md §13](./CALIBRACAO.md).

- **Ensaio de bancada** (`collector_state.bench_mode_until`), iniciado na tela de Bancada ou ao iniciar uma calibração:
  - cada leitura é gravada em `telemetry` com `bench_mode = true`;
  - o dispositivo recebe `next_poll_ms = 1000`;
  - o balanço hídrico ignora as variações de nível (a água colocada à mão não é condensado);
  - o captador aparece em `MAINTENANCE` e pedidos de missão recebem 409.
  - O ensaio termina ao tocar **Encerrar ensaio** ou sozinho, 15 min sem as telas abertas.
- **Diagnóstico do sensor** (`sensor_diagnostics`, opcional na telemetria): estado do sensor, identificação lida, resposta no I²C e frequência, amostras válidas, faixa mín.–máx., sinal e luz ambiente (quando o sensor informa), contagem de status, tempo de leitura, modo, ROI, orçamento e RSSI. Gravado como veio, sem correção.
- **Calibração presa ao dispositivo e ao hardware:** o volume só é derivado se a calibração ativa foi feita com o dispositivo ativo, com o mesmo tipo (REAL ou SIMULAÇÃO), com o sensor configurado e na mesma revisão de hardware, e se a leitura veio do driver desse sensor.
- **Observações** (`sensor_observations`): a leitura atual registrada como está (estável, instável ou inválida), com a janela bruta, o diagnóstico, a condição do ensaio e a altura lida na mangueira transparente.
- **Validações** (`calibration_validations`): volume conhecido × volume calculado, com erro, erro absoluto e erro percentual (com sinal e absoluto). Nunca alteram a calibração.
- **Imutabilidade:** observações e validações são protegidas pelo gatilho `protect_experimental_record`.

| Rota | Quem chama | Função |
|---|---|---|
| `GET /api/admin/collectors/{code}/bench` | Professor/admin | Leitura ao vivo, diagnóstico, últimas leituras, observações, validações e resumo |
| `POST` / `DELETE /api/admin/collectors/{code}/bench` | Professor/admin | Inicia ou encerra o ensaio de bancada |
| `POST /api/admin/collectors/{code}/bench/observations` | Professor/admin | `{ condition, reference_height_mm?, note? }`: registra a leitura atual |
| `POST /api/admin/collectors/{code}/bench/validations` | Professor/admin | `{ known_volume_liters, measurement_method, known_mass_kg?, note? }`: exige leitura estável e calibração deste dispositivo |
| `GET /api/admin/collectors/{code}/bench/export?tipo=readings\|observations\|validations&horas=24` | Professor/admin | CSV para análise |

Tela: `/admin/captadores/{code}/bancada`, lida por `src/lib/iot/bench-source.ts`, no mesmo padrão de `CollectorDataSource`.

## 12. Configuração de hardware: sensores de distância

A **plataforma é a fonte da configuração de hardware** do captador. O projeto suporta dois sensores de distância, **VL53L0X** e **VL53L1X**, mas cada captador usa **um**. A ligação física é a mesma para os dois (cabo de 4 vias, SDA = GPIO21, SCL = GPIO22, I²C a 100 kHz); muda só o driver do firmware. Detalhes físicos em [HARDWARE.md §3.1 e §8.3](./HARDWARE.md).

```text
CONFIGURAR NA PLATAFORMA (Ligações) → CONSULTAR O MANUAL DE LIGAÇÕES → MONTAR
→ FIRMWARE RECEBE O SENSOR E USA O DRIVER CORRESPONDENTE → TESTAR (Bancada) → CALIBRAR → MEDIR VOLUME
```

- **Persistência:** `collectors.distance_sensor` (enum `VL53L0X` | `VL53L1X`, padrão `VL53L1X` para os captadores já existentes) e `collectors.hardware_revision`. Um gatilho exige a **próxima revisão** a cada troca de sensor e impede que a revisão volte.
- **Troca** (`PUT /api/admin/collectors/{code}/hardware`, professor/admin), nunca silenciosa:
  - exige `confirm_physical_match: true` ("Confirmo que o sensor físico instalado corresponde ao sensor selecionado.");
  - cria a próxima revisão e uma linha em `collector_hardware_changes`, imutável (autor, nota, calibração substituída);
  - substitui a calibração ativa e cancela a calibração em andamento. O volume fica desconhecido até a nova calibração;
  - inicia um ensaio de bancada (missões bloqueadas). É recusada durante uma liberação e não cria comando para o dispositivo;
  - o balanço guarda o último volume conhecido: a nova calibração o reajusta no ensaio, sem criar nem apagar água captada.
- **Firmware:** recebe `hardware` na resposta de cada telemetria, guarda na NVS e usa o driver correspondente, pela interface comum `DistanceSensor` (`firmware/lib/distance_core`).
  - Os dois sensores usam o mesmo **endereço I²C (0x29, 7 bits)**, que por isso não os distingue.
  - Antes de iniciar, o driver lê a **identificação** em um registrador do sensor: **0xEE** no registrador 0xC0 (VL53L0X, model ID) ou **0xEACC** no registrador 0x010F (VL53L1X, sensor ID). O valor lido vai em `sensor_diagnostics.model_id`. Identificação não é endereço.
- **Módulo do EC-001:** CJMCU-531, baseado no **VL53L1X** (configurado como VL53L1X). A opção VL53L0X é para outro módulo compatível.
- **Configurado × reportado** (`assessSensorCompatibility`, `src/lib/collector/distance-sensors.ts`): `compatible`, `incompatible`, `sensor_missing`, `sensor_fault`, `awaiting_config`, `not_reported` ou `offline`.
  - Com **incompatibilidade** (driver diferente do configurado, ou dispositivo no I²C que não se identifica como o sensor configurado), a plataforma mostra **⚠️ INCOMPATIBILIDADE DE HARDWARE** e o captador aparece em `ERROR`.
  - Nesse caso, a leitura não vira volume (`volume_source = none`) e calibração e validação são recusadas.
  - A janela de estabilização recomeça quando o driver informado muda.
- **Dispositivo virtual (SIM-001):** segue a mesma configuração pela resposta da telemetria; na simulação, o sensor "instalado" é sempre o configurado.
- **Provisionamento:** `register-device --sensor VL53L0X|VL53L1X` define o sensor de um captador **novo**; um captador existente só muda o sensor pela plataforma.

| Rota | Quem chama | Função |
|---|---|---|
| `GET /api/admin/collectors/{code}/hardware` | Professor/admin | Sensor configurado, revisão, sensor reportado pelo firmware, compatibilidade, calibração ativa e histórico |
| `PUT /api/admin/collectors/{code}/hardware` | Professor/admin | `{ distance_sensor, confirm_physical_match: true, note? }`: troca o sensor |

Tela: `/admin/captadores/{code}/ligacoes` (**Sensores e Ligações** + manual de ligações dinâmico por sensor), lida por `src/lib/iot/hardware-source.ts`. O conteúdo do manual está em `src/lib/collector/wiring-guide.ts`, com as especificações documentadas de `distance-sensors.ts`.

## 13. Estrutura de pastas

```text
src/
├── app/
│   ├── (student)/       experiência mobile com barra inferior
│   ├── (onboarding)/    primeiro acesso (apelido e avatar)
│   ├── (auth)/entrar    login
│   └── api/             auth · me · collectors · iot
├── components/          ui · collector · missions · gamification · auth · simulation
├── lib/
│   ├── server/          serviços, autenticação, banco, provisionamento
│   ├── iot/             contrato, fonte de dados, dispositivo virtual
│   ├── collector/       estados de nível e contabilidade hídrica
│   ├── missions/        catálogo, resgate, execução
│   ├── gamification/    níveis e conquistas
│   ├── student/         perfil vindo da API
│   └── users/           modelo de usuários e acesso
└── hooks/
scripts/                 admin.ts (migrate, seed, contas, dispositivos) · smoke.ts (teste de ponta a ponta)
tools/virtual-device/    dispositivo virtual
supabase/migrations/     schema + RLS
firmware/                PlatformIO ESP32 DevKit V1 (etapa 1: medição + telemetria; drivers VL53L0X e VL53L1X)
```
