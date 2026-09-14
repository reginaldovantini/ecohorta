# Arquitetura — EcoHorta Inteligente

> Documento vivo. Atualize sempre que uma decisão mudar.

## 1. Visão geral

```text
ESP32-C3 ──HTTPS──► /api/iot/* (Next.js na Vercel) ──► Supabase (Postgres + funções SQL)
   ▲                          │                               │
   └── a resposta da          │                    Realtime (WebSocket)
       telemetria traz o      ▼                               ▼
       comando pendente   Dispositivo virtual         PWA (estudante / professor)
                          (mesmo contrato, SIMULAÇÃO)
```

| Camada | Responsável por |
|---|---|
| **ESP32-C3** | Leitura e filtragem do VL53L1X, distância → volume, controle da válvula, segurança (timeout, estado seguro), telemetria |
| **API IoT** (`src/app/api/iot`) | Autenticar dispositivos, validar payloads (zod), gravar telemetria, entregar comandos, receber confirmações |
| **Supabase** | Dados, regras críticas em funções SQL transacionais, RLS, Auth, Storage (evidências), Realtime |
| **PWA** | Experiência do estudante, missões, animações, painel do professor |

## 2. Princípio da fonte de dados

Toda tela lê o captador através de `CollectorDataSource` (`src/lib/iot/data-source.ts`).

- **Caminho único:** a interface usa somente a API da plataforma (`src/lib/iot/api-source.ts`). Ela nunca fala com o dispositivo.
- **Dispositivo virtual EC-001** (`tools/virtual-device/run.ts`, `is_simulated = true`) é um processo Node que se comporta como o ESP32 e usa **a mesma API**:
  - `src/lib/iot/virtual-device.ts` emula a física (condensado e saída por gravidade, Torricelli) e o firmware (ruído do sensor, faixa física, mediana, calibração, fechamento pelo volume medido, `NO_FLOW`, `TIMEOUT`, cancelamento e comandos idempotentes);
  - a velocidade (1×/30×/120×) acelera só a física; a estabilização da medição é sempre em tempo real;
  - `npm run dev` sobe a plataforma e o dispositivo, com um token aleatório a cada execução.
- **Servidor** (`src/lib/server/collector-service.ts`):
  - autentica o dispositivo por token;
  - guarda as leituras;
  - calcula tendência, transbordamento, descarte estimado e balanço (`src/lib/collector/water-accounting.ts`);
  - valida e entrega os comandos.

  O estado fica em memória até o Supabase (Dias 6–7).
- **ESP32 real:** entra como outro dispositivo, com `is_simulated = false` e token próprio. As telas não mudam.
- `DataOrigin` (`"device" | "simulation"`) acompanha cada leitura e cada comando. Um dado simulado nunca é exibido sem indicação.

## 3. Contrato IoT (implementado)

O contrato completo, validado com zod, está em `src/lib/iot/api-schema.ts`.

| Rota | Quem chama | Função |
|---|---|---|
| `POST /api/iot/telemetry` | Dispositivo | Envia leitura (`uptime_ms`, distância, volume, válvula) e relatório do comando; recebe o comando pendente |
| `GET /api/iot/simulation` | Dispositivo virtual | Canal de controle enquanto simula estar offline |
| `GET /api/collectors` | App | Lista de captadores |
| `GET /api/collectors/{code}` | App | Snapshot: telemetria, tendência, balanço e parâmetros da simulação |
| `POST /api/collectors/{code}/commands` | App | Pede liberação (idempotente por `command_id`) |
| `GET /api/collectors/{code}/commands/{id}` | App | Andamento do comando |
| `POST /api/collectors/{code}/commands/{id}/cancel` | App | Pede o fechamento da válvula |
| `POST /api/collectors/{code}/simulation` | Painel da simulação | Velocidade, condensado, nível e falhas. Recusado para captadores reais |

As rotas do app ainda não exigem login. A autenticação entra com o Supabase (Dias 6–7).

### `POST /api/iot/telemetry`

`Authorization: Bearer <token do dispositivo>`. O token fica salvo apenas como hash no banco.

```json
{
  "device_id": "ESP32-001",
  "collector_code": "EC-001",
  "seq": 18233,
  "distance_mm": 842,
  "volume_liters": 7.42,
  "valve": "closed",
  "status": "READY",
  "fw_version": "0.1.0",
  "uptime_s": 86400,
  "rssi": -61,
  "command_report": {
    "command_id": "0b7c…",
    "status": "COMPLETED",
    "delivered_liters": 2.98,
    "start_volume_liters": 10.40,
    "end_volume_liters": 7.42,
    "failure": null
  }
}
```

Resposta — o comando pendente vem junto, economizando requisições:

```json
{
  "server_time": 1789000000000,
  "next_poll_ms": 5000,
  "command": {
    "command_id": "0b7c…",
    "execution_id": "…",
    "target_liters": 3.0,
    "max_duration_ms": 120000
  }
}
```

- **Intervalo adaptativo:** ~5 s no horário escolar, 60 s fora dele e ~1 s durante uma liberação. Isso mantém o uso dentro do plano gratuito da Vercel.
- **Idempotência:**
  - `command_id` é UUID único no banco.
  - O servidor reenvia o mesmo comando até receber o relatório.
  - O ESP32 guarda os últimos IDs executados na memória não volátil (NVS) e nunca repete um comando.
  - O XP é concedido com chave única por execução.

## 4. Máquina de estados

### Missão / execução

```text
AVAILABLE → ACCEPTED → QUEUED → EXECUTING → MEASURING → COMPLETED
                │          │          │            └────► FAILED
                └► CANCELLED  └► EXPIRED  └► FAILED (NO_FLOW, TIMEOUT, SENSOR_ERROR)
```

| Estado | Significado físico |
|---|---|
| QUEUED | Comando criado; aguardando o dispositivo buscá-lo |
| EXECUTING | Válvula aberta; sensor acompanhando a queda do nível |
| MEASURING | Válvula fechada; aguardando a superfície estabilizar para a leitura final |
| COMPLETED | Volume **medido** registrado (não o comandado) |
| FAILED | Válvula fechada por segurança, com o motivo registrado |

### Dispositivo

`OFFLINE · ONLINE · READY · DISPENSING · CALIBRATING · ERROR · MAINTENANCE`

## 5. Regras de água

- **Disponível para missões** = volume medido − reserva mínima − volume já reservado por missões aceitas.
- Uma liberação por vez em cada captador, garantida por índice único parcial no banco.
- **Taxa de aproveitamento** = reutilizado ÷ captado × 100.
- **Descartado:** é sempre **estimado**. O VL53L1X não enxerga a água que sai pelo dreno. A estimativa usa a taxa de acúmulo medida antes do limite, multiplicada pelo tempo em nível máximo.

## 6. Usuários e privacidade

Participam **estudantes, professores e funcionários** (`student`, `teacher`, `staff`). O perfil `admin` gerencia a plataforma.

| Camada | Conteúdo | Tabela | Quem vê |
|---|---|---|---|
| **Dados de exibição** | Apelido, avatar (emblema ilustrado), perfil, turma ou função/setor | `profiles` | Comunidade da escola |
| **Dados cadastrais** | Nome, sobrenome, data de nascimento | `person_records` | O próprio usuário e professores/admin da escola |

- **Idade:** nunca é armazenada. É calculada a partir da data de nascimento por `ageOn()` (`src/lib/users/age.ts`) e pela view `participant_age_bands`, que agrupa por faixa etária sem expor datas.
- **Timeline e ranking:** usam só o apelido.
- **Consentimento do responsável (LGPD art. 14):** `guardian_consents` registra quem registrou, quando e como, sem guardar dados do responsável.
- **Schema:** o rascunho está em `supabase/migrations/20260914000000_identity.sql`, ainda não aplicado.
- **Hoje, sem login:** o cadastro inicial (`/boas-vindas`) guarda no aparelho **apenas dados de exibição**.

### Acesso dos estudantes (Dias 6–7)

Objetivo: **nenhum e-mail pessoal**.

1. O professor cria a turma. O sistema gera, para cada estudante, um **código de acesso** (ex.: `7A-K3QX`) e um **PIN**, entregues em cartão impresso com QR.
2. A escola registra os dados cadastrais. O estudante escolhe apelido e avatar.
3. **Parte técnica:**
   - O servidor cria o usuário no Supabase Auth com um identificador sintético não roteável (`<uuid>@alunos.ecohorta.invalid`, pois o domínio `.invalid` é reservado pela RFC 2606).
   - O estudante digita só o código e o PIN.
   - O servidor traduz e autentica.
4. O professor pode redefinir o PIN. Há limite de tentativas contra força bruta.
5. **Timeline e ranking:** mostram só o nome de exibição. **Fotos de evidência:** orientação para não fotografar rostos, com moderação do professor.

Como cada estudante continua sendo um usuário real do Supabase Auth, o RLS funciona normalmente. O modelo pode evoluir depois, por exemplo para login da escola.

## 7. Schema (Dias 6–7)

Todas as tabelas usam UUID, `created_at`/`updated_at` e `school_id` para permitir várias escolas.

| Grupo | Tabelas |
|---|---|
| Organização | `schools`, `school_classes` (nível de ensino, série, turma), `profiles` (exibição; papel student, teacher, staff ou admin), `person_records` (cadastro protegido), `guardian_consents` |
| Hardware | `collectors`, `devices` (hash do token, `is_simulated`), `sensors`, `calibrations`, `calibration_points` |
| Dados | `telemetry` (sensor_id, reading_type, value, unit, measured_at), `collector_state`, `water_events` |
| Missões | `missions`, `mission_executions`, `device_commands` |
| Jogo | `levels`, `xp_transactions`, `achievements`, `user_achievements`, `challenges`, `challenge_participants` |
| Social | `evidence`, `timeline_events`, `notifications` |

**RLS:**
- O estudante vê os próprios dados e os dados públicos da escola.
- O professor vê os dados da escola.
- O admin tem acesso total.
- O dispositivo nunca escreve direto no banco: tudo passa pela API.

## 8. Estrutura de pastas

```text
src/
├── app/                 rotas (App Router)
│   ├── (student)/       experiência mobile com barra de navegação inferior
│   └── api/iot/         contrato IoT (Dias 8–9)
├── components/
│   ├── ui/              design system (botões, cards, chips…)
│   ├── collector/       captador animado e telemetria
│   ├── missions/        cards e execução de missões
│   └── gamification/    XP, níveis e conquistas
├── lib/
│   ├── iot/             contrato, fonte de dados, dispositivo virtual, calibração
│   ├── collector/       estados de nível e regras de água
│   ├── missions/        catálogo e regras de missões
│   └── gamification/    níveis e XP
└── hooks/
docs/                    arquitetura e hardware
supabase/                migrations (Dias 6–7)
firmware/                PlatformIO ESP32-C3 (Dias 8–12)
```

Pastas são criadas quando recebem o primeiro arquivo.
