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

- **Hoje:** o dispositivo virtual implementa essa interface e roda no navegador. Toda a interface exibe **SIMULAÇÃO**.
- **Dias 6–9:** uma implementação com o Supabase Realtime lê os dados enviados pelo ESP32. As telas não mudam.
- `DataOrigin` (`"device" | "simulation"`) acompanha cada leitura e cada comando. Um dado simulado nunca é exibido sem indicação.

Seleção por variável de ambiente: `NEXT_PUBLIC_DATA_SOURCE=simulation | supabase`.

## 3. Contrato IoT (implementação nos Dias 8–9)

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

## 6. Acesso dos estudantes (proposta — implementação nos Dias 6–7)

Objetivo: **nenhum e-mail e o mínimo de dados pessoais** (LGPD/ECA).

1. O professor cria a turma. O sistema gera, para cada estudante, um **código de acesso** (ex.: `7A-K3QX`) e um **PIN**, entregues em cartão impresso com QR.
2. O perfil guarda apenas o **nome de exibição** definido pelo professor (primeiro nome e inicial, ou apelido) e a turma. Não guarda e-mail, data de nascimento nem documentos.
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
| Organização | `schools`, `classes`, `profiles` (papel: student, teacher ou admin) |
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
