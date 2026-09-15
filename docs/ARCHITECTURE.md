# Arquitetura — EcoHorta Inteligente

> Documento vivo. Atualize sempre que uma decisão mudar.

## 1. Visão geral

```text
ESP32-C3 ─────HTTPS──┐
                     ├─► /api/iot/* ─┐
Dispositivo virtual ─┘               │   Next.js (Route Handlers) na Vercel
(mesmo contrato, SIMULAÇÃO)          ├─► Postgres do Supabase (fonte oficial) + RLS
PWA ──cookie de sessão──► /api/* ────┘   Supabase Auth (identidade)
```

| Camada | Responsável por |
|---|---|
| **ESP32-C3** | Leitura e filtragem do VL53L1X, distância → volume, válvula (etapa futura), segurança, telemetria |
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

- **Dispositivo virtual EC-001** (`tools/virtual-device/run.ts`, `is_simulated = true`): processo Node que se comporta como o ESP32 e usa a **mesma API**. Emula a física (Torricelli) e o firmware (ruído, mediana, calibração, `NO_FLOW`, `TIMEOUT`, cancelamento, idempotência). O token vem do `.env.local` (gerado por `npm run db:seed`); o banco guarda só o hash.
- **ESP32 real:** outro dispositivo, `is_simulated = false`, token próprio (`npm run admin -- register-device`). As telas não mudam.
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
| `POST /api/iot/telemetry` | Dispositivo | Leitura + relatório do comando; recebe o comando pendente e o próximo intervalo |
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
  "collector_code": "EC-001",
  "seq": 18233,
  "uptime_ms": 86400000,
  "distance_mm": 842,
  "volume_liters": 7.42,
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
  "simulation": null
}
```

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
- **Descartado:** sempre **estimado**. O VL53L1X não enxerga a água que sai pelo dreno.

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

Migrations em `supabase/migrations/` (aplicar com `npm run db:migrate`), validadas nos testes com PostgreSQL real (PGlite) e as mesmas regras de RLS.

| Grupo | Tabelas |
|---|---|
| Organização | `schools`, `school_classes`, `profiles`, `person_records`, `guardian_consents` |
| Hardware | `collectors`, `devices` (hash do token, `is_simulated`), `collector_state` |
| Dados | `telemetry` |
| Missões | `device_commands`, `mission_executions` |
| Jogo | `xp_transactions` (+ view `profile_xp`) |

**RLS** ativo em todas as tabelas: `anon` sem acesso; `authenticated` só leitura, restrita à escola e ao próprio usuário; `devices` nunca legível por usuários. Toda escrita passa pela API.

**Futuro (fora desta fase):** calibração no banco, missões no banco, evidências, timeline, notificações, desafios.

## 10. Estrutura de pastas

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
firmware/                PlatformIO ESP32-C3 (etapa 1: medição + telemetria)
```
