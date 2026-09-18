# 💧 EcoHorta Inteligente

**Investigação e Automação no Reúso Hídrico Escolar**. Projeto para o **Samsung Solve for Tomorrow Brasil**.

A água de condensação dos aparelhos de ar-condicionado costuma ser descartada. A EcoHorta capta essa água, mede o volume com um sensor e a disponibiliza em **missões reais**. O estudante aceita uma missão, a válvula libera a água, o sensor confirma o volume e a ação vira XP, evidência e impacto mensurável.

```text
ÁGUA REAL → SENSOR → ESP32 → API → SUPABASE → PLATAFORMA → MISSÃO → VÁLVULA
→ MEDIÇÃO REAL → CONFIRMAÇÃO → XP → EVIDÊNCIA → TIMELINE → IMPACTO
```

> **Princípio de verdade:** o que acontece na tela acontece fisicamente. Enquanto o hardware não está conectado, todo dado vem de um dispositivo virtual e aparece identificado como **SIMULAÇÃO**.

## Status

| Etapa | Situação |
|---|---|
| Setup, documentação, Design System, experiência mobile | ✅ |
| Captador animado e dispositivo virtual (SIMULAÇÃO) pela API IoT | ✅ |
| Missões, Missão de Resgate, cancelamento, XP, conquistas, ranking coletivo | ✅ |
| PWA (manifest, ícones, service worker) | ✅ |
| Supabase: schema, RLS, persistência de estado, telemetria, comandos, execuções e XP | ✅ (Fase 1) |
| Login (estudante por código + PIN; equipe por e-mail) e autorização | ✅ (Fase 1) |
| Calibração experimental de volume, versionada e vinculada ao sensor | ✅ (Fase 2) · falta executar no EC-001 |
| Integração física: bancada, diagnóstico do sensor, validação experimental, REAL × SIMULAÇÃO | ✅ (Fase 3) · falta o primeiro teste físico |
| Sensores de distância VL53L0X e VL53L1X: escolha na plataforma, manual de ligações, compatibilidade com o firmware | ✅ · falta o primeiro teste físico |
| Firmware ESP32 etapa 1 (dois drivers de sensor, distância + telemetria, sem válvula) | 🧪 compila e tem testes; falta gravar na placa |
| Válvula e lógica de liberação no ESP32 | ⏳ após checklist da válvula |

## Stack

- **Frontend:** Next.js 16 (App Router, Turbopack), React 19, TypeScript strict, Tailwind CSS 4, Motion, Lucide
- **Backend:** Route Handlers do Next.js; Postgres via `pg`
- **Dados e identidade:** Supabase (Postgres + RLS, Auth), plano gratuito
- **Hospedagem:** Vercel (região `gru1`)
- **App:** PWA instalável (Android, iPhone e desktop)
- **Hardware:** ESP32 DevKit V1 (ESP32 clássico) + um sensor de distância dentro da tampa, **VL53L0X ou VL53L1X** (um por captador, escolhido na plataforma; no EC-001, módulo CJMCU-531 = VL53L1X), ligado por cabo de 4 vias de ~50 cm (VCC, GND, SDA→GPIO21, SCL→GPIO22, I²C a 100 kHz) + válvula esférica motorizada (em validação, veja [docs/HARDWARE.md](docs/HARDWARE.md)).

## Como rodar

Requisitos: Node.js 20.9+ (testado com 24) e npm.

### 1. Supabase (uma vez)

1. Crie um projeto no [Supabase](https://supabase.com) (região São Paulo).
2. **Authentication → Sign In / Providers:** desative **Allow new users to sign up**. As contas são criadas só pelo script de administração.
3. Copie o modelo de variáveis e preencha com os dados do painel:
   ```bash
   copy .env.example .env.local   # macOS/Linux: cp .env.example .env.local
   ```
   Gere o `IOT_TOKEN_PEPPER`: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

### 2. Banco e contas

```bash
npm install
npm run db:migrate                                   # aplica supabase/migrations
npm run db:seed -- --class "6º Ano C:elementary:6:C"  # escola, turmas, SIM-001 + dispositivo virtual
npm run admin -- register-device --collector EC-001 --name "EcoCaptador" --location "Horta" --capacity 11.8 --reserve 0.5 --diameter 100 --height 1500 --key ESP32-001 --sensor VL53L1X
npm run admin -- create-user --role admin --first Nome --last Sobrenome --email voce@escola.exemplo
npm run admin -- create-user --role student --class "6º Ano C" --first Nome --last Sobrenome --birth 2013-05-20 --consent termo_impresso
```

Senhas, códigos e PINs aparecem **uma única vez** no terminal. Outros comandos estão no cabeçalho de [scripts/admin.ts](scripts/admin.ts).

### 3. Desenvolvimento

```bash
npm run dev
```

Abra http://localhost:3000 e entre em `/entrar`.

### Testar no celular (mesma rede Wi-Fi)

1. Rode `npm run dev`. O terminal mostra o endereço **Network**, ex.: `http://192.168.x.x:3000`.
2. Abra esse endereço no navegador do celular.
3. Se o celular não conectar, libere o Node.js no Firewall do Windows para **redes privadas**.

### Deploy (Vercel)

1. Importe o repositório na Vercel.
2. Cadastre em **Settings → Environment Variables**: `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `DATABASE_URL` (Transaction pooler), `IOT_TOKEN_PEPPER` e `STUDENT_EMAIL_DOMAIN`. **Não** cadastre `SUPABASE_SECRET_KEY` nem `DATABASE_MIGRATION_URL`.
3. Para o dispositivo virtual enviar para a URL pública, defina `ECOHORTA_API_URL=https://<app>.vercel.app` no `.env.local` e rode `npm run device:virtual`.
4. Rode o teste de ponta a ponta: `SMOKE_BASE_URL=https://<app>.vercel.app npm run smoke`.

## Modo simulação (sem hardware)

**EC-001** é o captador físico (ESP32 + sensor VL53L0X ou VL53L1X, selo **REAL**). **SIM-001** é o captador da simulação (selo **SIMULAÇÃO**), alimentado pelo **dispositivo virtual**. É um processo separado que emula o captador e o firmware e conversa com a plataforma **pela mesma API que o ESP32 usa**. O app nunca fala com o dispositivo, só com a API. `npm run dev` sobe a plataforma e o dispositivo.

- **O que ele emula:**
  - entrada de condensado e saída por gravidade (vazão ∝ √altura);
  - ruído do sensor com filtro de mediana;
  - fechamento da válvula pelo volume **medido**;
  - falha por falta de vazão (`NO_FLOW`), timeout e comandos idempotentes;
  - transbordamento com descarte estimado.
- **Painel da simulação** (somente professor/admin): toque no selo **SIMULAÇÃO**. Controla velocidade do tempo (1×, 30×, 120×), condensado, nível do captador, distância do sensor e falhas (válvula sem vazão, captador offline).
- **Calibração de volume na simulação:** Perfil → Administração → Captadores → SIM-001. Cada etapa tem um botão para colocar o volume no captador virtual; a calibração resultante fica marcada como SIMULAÇÃO.
- **Dica para demonstrar:** use **30×**. Uma liberação de 3 L leva cerca de 2 min simulados, ou 4 s na tela.
- **Estado salvo:**
  - estado do captador, balanço, comandos, execuções e XP ficam no **Supabase** e sobrevivem a reinícios;
  - o nível físico do dispositivo virtual fica em `.data/` no computador que o executa.
- **Para recomeçar a simulação:** "Reiniciar simulação" no painel (XP e histórico dos participantes são mantidos).
- **Parâmetros:** `src/lib/iot/simulation-config.ts` (capacidade, altura útil, vazão), a substituir pelos valores **medidos** no captador real.

## Scripts

| Comando | O que faz |
|---|---|
| `npm run dev` | Plataforma + dispositivo virtual (captador SIM-001) |
| `npm run dev:app` | Só a plataforma |
| `npm run device:virtual` | Só o dispositivo virtual (usa `IOT_SIMULATED_DEVICE_TOKEN` e `ECOHORTA_API_URL`) |
| `npm run db:migrate` | Aplica as migrations no Supabase (`DATABASE_MIGRATION_URL`) |
| `npm run db:seed` | Escola, turmas, captador SIM-001 e dispositivo virtual (gera o token no `.env.local`) |
| `npm run admin -- <comando>` | `create-user`, `list-classes`, `register-device` |
| `npm run smoke` | Teste de ponta a ponta da API (local ou `SMOKE_BASE_URL`) |
| `npm run build` | Build de produção |
| `npm run typecheck` | Gera os tipos de rotas e verifica o TypeScript |
| `npm run lint` | ESLint |
| `npm run test` | Testes (Vitest; banco e RLS com PostgreSQL real via PGlite) |
| `npm run check` | typecheck + lint + test + build. Rode antes de cada commit |
| `npm run screenshot -- /rota` | Captura telas em 360/390/412 px (requer `npm run dev` e Edge ou Chrome) |
| `npm run icons` | Gera os ícones PNG do PWA a partir de `src/app/icon.svg` |
| `pio run -d firmware` | Compila o firmware do ESP32 DevKit V1 (PlatformIO; `-t upload` grava na placa) |
| `pio test -d firmware -e windows_test` | Testes do núcleo de sensores do firmware no computador, sem placa |

## Sensores de distância e ligações

O projeto suporta **dois sensores de distância**, **VL53L0X** e **VL53L1X**, mas **cada captador usa um**. A plataforma é a fonte da configuração do hardware:

```text
CONFIGURAR NA PLATAFORMA → CONSULTAR O MANUAL DE LIGAÇÕES → MONTAR → FIRMWARE USA O DRIVER DO SENSOR
→ TESTAR O SENSOR (Bancada) → CALIBRAR → MEDIR VOLUME
```

- **Onde:** Perfil → Administração → Captadores → {código} → **Ligações** (professor/admin). A área **Sensores e Ligações** mostra:
  - o sensor configurado e o firmware esperado;
  - o sensor que o firmware informa estar usando e o estado do sensor;
  - o manual de ligações do sensor: ilustração, especificações documentadas, diagrama, tabela de vias, alimentação, cabo, posição, umidade, janela óptica, teste e calibração.
- **EC-001:** módulo **CJMCU-531, baseado no VL53L1X** → configurado como **VL53L1X**. O VL53L0X é para outro módulo compatível.
- **Endereço × identificação:** os dois sensores usam o mesmo endereço I²C, **0x29**. O firmware os distingue pela identificação lida de um registrador: **0xEE** (VL53L0X, registrador 0xC0) ou **0xEACC** (VL53L1X, registrador 0x010F). Esses valores não são endereços.
- **Mesma ligação para os dois:** cabo de 4 vias (~50 cm): VCC → alimentação adequada ao módulo (3V3 na maioria; **não assuma 5 V**), GND → GND, SDA → GPIO21, SCL → GPIO22. XSHUT e GPIO1 não são usados. I²C a 100 kHz.
- **Troca do sensor:** exige confirmar que o sensor físico instalado corresponde ao selecionado. Cria uma nova revisão de hardware (histórico imutável), substitui a calibração ativa e inicia um ensaio de bancada. O firmware recebe o novo sensor na resposta da telemetria e troca o driver sozinho, sem regravar.
- **Incompatibilidade:** se o firmware informar outro sensor, a plataforma mostra **⚠️ INCOMPATIBILIDADE DE HARDWARE** e não calcula volume.

Detalhes em [docs/HARDWARE.md](docs/HARDWARE.md) (§3.1, §6 e §8.3) e [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (§12).

## Variáveis de ambiente

Todas estão documentadas em [.env.example](.env.example). **Nunca coloque credenciais no código nem versione o `.env.local`.**

| Variável | Onde é usada | Vercel |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` | QR Codes e links | ✅ |
| `NEXT_PUBLIC_SUPABASE_URL` | Sessão (Supabase Auth) | ✅ |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Sessão (protegida pelo RLS) | ✅ |
| `DATABASE_URL` | Banco (Transaction pooler) | ✅ |
| `IOT_TOKEN_PEPPER` | Hash dos tokens dos dispositivos | ✅ |
| `STUDENT_EMAIL_DOMAIN` | Identificador sintético das contas de estudante | ✅ |
| `SUPABASE_SECRET_KEY` | **Somente scripts** (criar contas) | ❌ |
| `DATABASE_MIGRATION_URL` | **Somente scripts** (Session pooler) | ❌ |
| `IOT_SIMULATED_DEVICE_TOKEN`, `ECOHORTA_API_URL` | Dispositivo virtual | ❌ |
| `SMOKE_*` | Teste de ponta a ponta | ❌ |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web Push (futuro) | — |

## Estrutura

```text
src/
├── app/            rotas (App Router) e API
├── components/     ui/ · collector/ · missions/ · gamification/ · auth/
├── lib/            server/ · iot/ · collector/ · missions/ · gamification/ · users/
└── hooks/
supabase/           migrations (schema + RLS)
scripts/            administração e teste de ponta a ponta
tools/              dispositivo virtual
firmware/           ESP32 DevKit V1 (PlatformIO): drivers VL53L0X e VL53L1X, testes do núcleo
docs/               ARCHITECTURE.md · BANCO_DE_DADOS.md · HARDWARE.md · CALIBRACAO.md
```

Veja os detalhes em [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Documentação

- [Arquitetura](docs/ARCHITECTURE.md): persistência, autenticação, autorização, XP, contrato IoT, estados e privacidade
- [Banco de dados](docs/BANCO_DE_DADOS.md): relações, regras ao apagar, RLS, índices e auditoria do schema
- [Hardware](docs/HARDWARE.md): **válvula de 3 fios e relés (checklist)**, sensores VL53L0X e VL53L1X e firmware
- [Calibração de volume](docs/CALIBRACAO.md): procedimento físico, ZERO físico, estabilização, modelo V = k × H, qualidade, versões e validação experimental
- [Protocolo de validação física do EC-001](docs/HARDWARE.md): montagem, sensor na tampa, cabo de 4 vias até o ESP32, alimentação do módulo, testes sem e com água, calibração, validação e análise de erro (§8)

## Convenções

- Código em inglês e interface em português (pt-BR)
- Commits no padrão `feat:`, `fix:`, `docs:`, `chore:`
- Dados simulados sempre identificados na interface
