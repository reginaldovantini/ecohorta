# 💧 EcoHorta Inteligente

**Investigação e Automação no Reúso Hídrico Escolar**. Projeto para o **Samsung Solve for Tomorrow Brasil**.

A água de condensação dos aparelhos de ar-condicionado costuma ser descartada. A EcoHorta capta essa água, mede o volume com um sensor e a disponibiliza em **missões reais**. O estudante aceita uma missão, a válvula libera a água, o sensor confirma o volume e a ação vira XP, evidência e impacto mensurável.

```text
ÁGUA REAL → SENSOR → ESP32 → SUPABASE → PLATAFORMA → MISSÃO → VÁLVULA
→ MEDIÇÃO REAL → CONFIRMAÇÃO → XP → EVIDÊNCIA → TIMELINE → IMPACTO
```

> **Princípio de verdade:** o que acontece na tela acontece fisicamente. Enquanto o hardware não está conectado, todo dado vem de um dispositivo virtual e aparece identificado como **SIMULAÇÃO**.

## Status

| Etapa | Situação |
|---|---|
| Setup (Next.js, TypeScript, Tailwind, testes) | ✅ |
| Documentação e contrato de dados | ✅ |
| Design System | ✅ |
| Experiência mobile (Home, missões, execução) | ✅ |
| Captador animado | ✅ |
| Dispositivo virtual (SIMULAÇÃO) | ✅ |
| Supabase (schema, RLS, login) | ⏳ Dias 6–7 |
| API IoT + ESP32 | ⏳ Dias 8–13 |

## Stack

- **Frontend:** Next.js 16 (App Router, Turbopack), React 19, TypeScript strict, Tailwind CSS 4, Motion, Lucide
- **Backend:** Route Handlers do Next.js e funções SQL no Supabase
- **Dados:** Supabase (Postgres, Auth, Storage, Realtime), plano gratuito
- **Hospedagem:** Vercel
- **App:** PWA instalável (Android, iPhone e desktop)
- **Hardware:** ESP32-C3 + VL53L1X + válvula NC de baixa pressão (a definir, veja [docs/HARDWARE.md](docs/HARDWARE.md))

## Como rodar

Requisitos: Node.js 20.9+ (testado com 24) e npm.

```bash
npm install
cp .env.example .env.local   # no Windows: copy .env.example .env.local
npm run dev
```

Abra http://localhost:3000.

### Testar no celular (mesma rede Wi-Fi)

1. Rode `npm run dev`. O terminal mostra o endereço **Network**, ex.: `http://192.168.x.x:3000`.
2. Abra esse endereço no navegador do celular.
3. Se o celular não conectar, libere o Node.js no Firewall do Windows para **redes privadas**.

### Modo simulação (sem hardware)

Enquanto o ESP32 não está conectado, os dados vêm de um **dispositivo virtual** que emula o captador e o firmware.

- **O que ele emula:**
  - entrada de condensado e saída por gravidade (vazão ∝ √altura);
  - ruído do sensor com filtro de mediana;
  - fechamento da válvula pelo volume **medido**;
  - falha por falta de vazão (`NO_FLOW`), timeout e comandos idempotentes;
  - transbordamento com descarte estimado.
- **Painel da simulação:** toque no selo **SIMULAÇÃO**. Ele controla:
  - velocidade do tempo (1× real, 30×, 120×);
  - ar-condicionado e vazão de condensado;
  - nível do captador (10–100%);
  - falhas: válvula sem vazão e captador offline.
- **Dica para demonstrar:** use **30×**. Uma liberação de 3 L leva cerca de 2 min simulados, ou 4 s na tela.
- **Estado salvo:** a simulação e o perfil de demonstração ficam salvos no navegador. Para recomeçar, use "Reiniciar simulação" no painel e "Reiniciar demonstração" no Perfil.
- **Parâmetros:** estão em `src/lib/iot/simulation-source.ts` (capacidade, altura útil, vazão) e devem ser trocados pelos valores **medidos** no captador real.

## Scripts

| Comando | O que faz |
|---|---|
| `npm run dev` | Servidor de desenvolvimento |
| `npm run build` | Build de produção |
| `npm run typecheck` | Gera os tipos de rotas e verifica o TypeScript |
| `npm run lint` | ESLint |
| `npm run test` | Testes unitários (Vitest) |
| `npm run check` | Tudo acima, na ordem. Rode antes de cada commit |
| `npm run screenshot -- /rota` | Captura telas em 360/390/412 px (requer `npm run dev` e Edge ou Chrome) |
| `npm run icons` | Gera os ícones PNG do PWA a partir de `src/app/icon.svg` |

## Variáveis de ambiente

Todas estão documentadas em [.env.example](.env.example), organizadas pela etapa em que se tornam necessárias. **Nunca coloque credenciais no código nem versione o `.env.local`.**

| Variável | Onde é usada | Etapa |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` | QR Codes e links | Já |
| `NEXT_PUBLIC_DATA_SOURCE` | `simulation` ou `supabase` | Já |
| `NEXT_PUBLIC_SUPABASE_URL` | Cliente Supabase | Dias 6–7 |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Cliente Supabase (protegido pelo RLS) | Dias 6–7 |
| `SUPABASE_SECRET_KEY` | **Somente servidor** | Dias 6–7 |
| `IOT_TOKEN_PEPPER` | Hash dos tokens dos dispositivos | Dias 8–9 |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web Push | Dia 18 |

## Estrutura

```text
src/
├── app/            rotas (App Router)
├── components/     ui/ · collector/ · missions/ · gamification/
├── lib/            iot/ · collector/ · missions/ · gamification/
└── hooks/
docs/               ARCHITECTURE.md · HARDWARE.md
```

Veja os detalhes em [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Documentação

- [Arquitetura](docs/ARCHITECTURE.md): fluxo IoT, estados, contrato da API, schema e acesso dos estudantes sem e-mail
- [Hardware](docs/HARDWARE.md): **risco da válvula em sistema por gravidade**, VL53L1X, calibração e segurança do firmware

## Convenções

- Código em inglês e interface em português (pt-BR)
- Commits no padrão `feat:`, `fix:`, `docs:`, `chore:`
- Dados simulados sempre identificados na interface
