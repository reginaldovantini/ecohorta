# EcoHorta Inteligente — Escala, Replicabilidade e Aprendizagem STEM

> **Análise estratégica** · 16/09/2026 · base: commit `6ff3224` (branch `main`)
>
> Documento de análise, sem alteração de código. Serve de base para as próximas evoluções da plataforma, para o relatório de prototipagem e para a apresentação à banca do Samsung Solve for Tomorrow.

## Como ler este documento

Cada item traz **uma** das marcas abaixo. Nada marcado como `[NOVO]` ou `[VISÃO]` existe no código hoje.

| Marca | Significado |
|---|---|
| **[EXISTE]** | Implementado no repositório e coberto por testes automatizados |
| **[EVOLUIR]** | Existe uma base no código; precisa ser estendida |
| **[NOVO]** | Nova funcionalidade, sem base no código atual |
| **[VISÃO]** | Visão de longo prazo |

Prioridades usadas em todo o documento:

| Prioridade | Quando |
|---|---|
| **A** | Necessário para a demonstração de setembro de 2026 |
| **B** | Próxima evolução (piloto real na escola) |
| **C** | Roadmap de escala (replicação e primeiras escolas parceiras) |
| **D** | Visão de longo prazo (rede) |

> **Estado real em 16/09/2026.** O código da plataforma está pronto e testado (137 testes; banco e regras de acesso validados em PostgreSQL real via PGlite). Mas:
> - o projeto Supabase ainda **não foi configurado** e não há deploy público;
> - o captador físico existe, mas **o sensor e a válvula ainda não foram validados fisicamente**;
> - o firmware do ESP32 (etapa 1) mede e envia telemetria, **sem controle de válvula**, e ainda não foi compilado.
>
> O ciclo completo missão → comando → liberação → medição → confirmação → XP funciona hoje com o **dispositivo virtual** (SIMULAÇÃO).

---

## 1. Resumo executivo

**Até onde a plataforma pode chegar?** A fundação atual comporta uma rede de escolas, com várias turmas e captadores, investigação com dados reais e replicação do captador. O banco já separa escolas desde o início, o servidor é a única autoridade, o XP é um livro-razão auditável e ESP32 e dispositivo virtual usam o mesmo contrato. Em compensação, **a experiência, o catálogo de missões e a operação** ainda foram desenhados para uma escola, um captador e um único tipo de missão.

**Pontos fortes que já sustentam escala:**

1. **Isolamento por escola no banco.** `school_id` em todas as entidades e regras de acesso por escola (RLS), com 18 testes. É o modelo multiescola adequado para centenas de escolas, sem reescrita.
2. **Verdade medida.** A missão só termina com o volume **medido** pelo sensor. O comando é idempotente, o banco garante uma liberação ativa por captador e cada dado carrega a origem (`device` ou `simulation`).
3. **XP como livro-razão** (`xp_transactions`), com origem e unicidade por origem. Ele aceita outras fontes de pontuação (investigação, projeto, construção) sem mudar a lógica.
4. **Contrato de dispositivo único.** O dispositivo virtual e o ESP32 usam a mesma API. Novos captadores entram por cadastro, não por código.
5. **Privacidade estrutural.** Os dados de exibição ficam separados dos cadastrais, a idade nunca é armazenada e o consentimento do responsável é registrado. Isso já permite indicadores por faixa etária sem expor datas.

**Principais gargalos para crescer:**

1. **Missões fixas no código.** O catálogo está em [`catalog.ts`](../src/lib/missions/catalog.ts), e toda execução exige um comando de água (`mission_executions.command_id` é obrigatório). **Nenhuma missão de investigação, matemática ou engenharia cabe no modelo atual** sem migração.
2. **A interface mostra só o primeiro captador da escola** ([`usePrimaryCollectorCode`](../src/components/collector/collector-source.tsx#L24)). O banco e a API já suportam vários.
3. **Não existe camada de indicadores**, painel do professor, timeline nem ranking por turma. Os dados brutos permitem calcular boa parte dos indicadores hídricos e de participação.
4. **Não há registro de hardware.** Faltam versão do captador, componentes, custos, calibração no banco e testes. Sem isso, a replicação e a redução de custos não são mensuráveis.
5. **A operação multiescola ainda não é segura:**
   - códigos de captador são únicos no sistema inteiro;
   - o script de provisionamento pode sobrescrever um captador de outra escola com o mesmo código;
   - cada pessoa pertence a uma única escola;
   - contas são criadas só por linha de comando.
6. **Custo de escala.** O polling de 3 s, o histórico de telemetria gravado a cada 30 s e o estado de tendência reescrito a cada leitura funcionam para 1–2 captadores. Para uma rede, exigem ajustes (seção 4.3).

**Três descobertas que mudam o desenho do futuro:**

- **A água é sazonal.** A produção de condensado varia com a umidade e com o uso do ar-condicionado (férias, dias frios, estação seca). **Engajamento que depende só de liberar água para quando a água falta.** Missões de medição, dados e engenharia mantêm a plataforma viva nesses períodos.
- **XP por liberação incentiva desperdício.** Hoje nada impede um estudante de liberar água repetidamente para ganhar XP; só a água disponível limita. Em uso real, isso contradiz o propósito do projeto. É preciso limitar e, no futuro, pedir evidência do destino da água.
- **O registro de comandos já é uma bancada de testes de engenharia.** `device_commands` guarda volume pedido × medido, duração e falhas (`NO_FLOW`, `TIMEOUT`). Com a versão da válvula associada ao captador, a plataforma **compara automaticamente** a válvula comercial com a de baixo custo feita pelos estudantes.

**Recomendação para setembro:** não ampliar o sistema. Colocar em produção o que já existe (Supabase, deploy HTTPS, sensor real enviando telemetria) e demonstrar com honestidade o que é físico e o que é simulação. Apresentar a visão como roadmap **ancorado nas estruturas que já existem** (seção 15).

**Tese central (seção 20):** a unidade de valor da plataforma precisa evoluir de **"liberação de água medida"** para **"evidência verificada"**. A validação pode vir do sensor, do dado real, do professor ou do teste de engenharia, e a liberação física continua sendo a âncora da experiência.

---

## 2. O que existe hoje

### 2.1 Inventário por camada

| Camada | O que existe | Onde | Situação |
|---|---|---|---|
| Captador físico EC-001 | Tubo vertical estreito em PVC | — | **[EXISTE]** fisicamente; sem calibração |
| Firmware ESP32 DevKit V1 (etapa 1) | Drivers VL53L0X e VL53L1X (sensor escolhido na plataforma) com mediana; telemetria HTTPS no mesmo contrato; **sem válvula** | [`firmware/`](../firmware/) | **[EXISTE]** compila e tem testes do núcleo; não gravado nem validado em placa |
| Dispositivo virtual EC-001 | Física de condensado e gravidade (Torricelli), ruído + mediana, `NO_FLOW`, `TIMEOUT`, cancelamento, idempotência | [`virtual-device.ts`](../src/lib/iot/virtual-device.ts), [`tools/virtual-device/run.ts`](../tools/virtual-device/run.ts) | **[EXISTE]** 12 testes |
| API IoT | `POST /api/iot/telemetry` (token com hash + pepper), canal da simulação | [`src/app/api/iot`](../src/app/api/iot) | **[EXISTE]** |
| Serviço de captadores | Estado persistido, trava por captador, comandos, expiração, contabilidade hídrica, XP na conclusão | [`collector-service.ts`](../src/lib/server/collector-service.ts) | **[EXISTE]** 24 testes |
| Contabilidade hídrica | Tendência, transbordamento, descarte **estimado**, balanço de massa | [`water-accounting.ts`](../src/lib/collector/water-accounting.ts) | **[EXISTE]** 6 testes |
| Banco de dados | 12 tabelas + 2 views, RLS em todas | [`supabase/migrations`](../supabase/migrations) | **[EXISTE]** 18 testes; **não aplicado no Supabase** |
| Autenticação | Estudante: código + PIN (sem e-mail). Equipe: e-mail + senha. Sessão em cookie | [`src/app/api/auth`](../src/app/api/auth), [`auth.ts`](../src/lib/server/auth.ts) | **[EXISTE]** |
| Autorização | Comandos com login; cancelar só quem pediu ou educador; simulação só professor/admin; isolamento por escola | `collector-service.ts` | **[EXISTE]** testes de autorização |
| Missões | 4 missões de ação (1–4 L) + Missão de Resgate com volume calculado pelo nível medido | [`catalog.ts`](../src/lib/missions/catalog.ts), [`rescue.ts`](../src/lib/missions/rescue.ts) | **[EXISTE]** |
| XP | Livro-razão com uma transação por execução concluída | `xp_transactions`, view `profile_xp` | **[EXISTE]** |
| Níveis | 10 níveis fixos (Semente → Embaixador EcoHorta) | [`levels.ts`](../src/lib/gamification/levels.ts) | **[EXISTE]** |
| Conquistas | 5 conquistas **calculadas no app** a partir do histórico (não gravadas) | [`achievements.ts`](../src/lib/gamification/achievements.ts) | **[EXISTE]** |
| Ranking | Impacto coletivo do captador + contribuição pessoal. Listas individual e por turma são **só cartões informativos** | [`ranking-screen.tsx`](../src/components/screens/ranking-screen.tsx) | **[EXISTE]** parcial |
| Telas | Início, Água, Missões, Ranking, Perfil, Entrar, Boas-vindas, Offline, `/design` | `src/app`, `src/components/screens` | **[EXISTE]** |
| PWA | Manifest, ícones, service worker (API nunca em cache) | [`sw.js`](../public/sw.js), [`manifest.ts`](../src/app/manifest.ts) | **[EXISTE]** |
| Administração | `db:migrate`, `db:seed`, `create-user`, `list-classes`, `register-device` (linha de comando) | [`scripts/admin.ts`](../scripts/admin.ts) | **[EXISTE]** |
| Teste de ponta a ponta | Autenticação, autorização, missão completa, ocupado, cancelamento, XP | [`scripts/smoke.ts`](../scripts/smoke.ts) | **[EXISTE]** não executado contra banco real |
| Documentação | Arquitetura, hardware (checklists da válvula de 3 fios), design system, README | [`docs/`](./) | **[EXISTE]** |

### 2.2 O que **não** existe (para não ser apresentado como pronto)

- Timeline ou feed de ações (a palavra aparece apenas em textos da interface).
- Painel do professor ou da escola; criação de estudantes, turmas ou redefinição de PIN pela interface.
- Gráficos de séries temporais, exportação de dados, comparação entre captadores.
- Sensores de temperatura e umidade; cadastro dos aparelhos de ar-condicionado.
- Missões de investigação, matemática, ciências, programação, engenharia ou colaborativas. As categorias estão previstas numa verificação do banco, mas **sem fluxo**.
- Evidências (fotos, textos, respostas) e revisão pelo professor.
- Camada de indicadores agregados (por escola, turma, período ou rede).
- Seleção de captador ou leitura de QR Code. O código normaliza o formato do QR, mas não há leitor.
- Versões de hardware, lista de materiais, custos, registro de montagem, testes de aceitação no banco.
- Manual "Construa seu próprio captador".
- Onboarding de novas escolas; papéis de rede, gestor ou pesquisador.
- Atualização em tempo real (Realtime/SSE): a interface usa polling.
- Licença de software, hardware e documentação: o repositório não tem arquivo `LICENSE`.

---

## 3. Arquitetura atual

### 3.1 Visão geral

```text
┌──────────────────────── Dispositivos ────────────────────────┐
│ ESP32 + VL53L1X (etapa 1)         Dispositivo virtual EC-001  │
│ is_simulated = false              is_simulated = true         │
└───────────────┬────────────────────────────────┬──────────────┘
                │ POST /api/iot/telemetry  (Bearer token, mesmo contrato)
                ▼                                 ▼
        Next.js · Route Handlers (Vercel, serverless, região gru1)
        ├─ collector-service  estado, comandos, expiração, contabilidade, XP
        ├─ profile-service    perfil, XP e histórico (/api/me)
        ├─ auth + actor       sessão Supabase → papel e escola lidos do banco
        └─ provisioning       usado por scripts/admin.ts
                │ pg (Transaction pooler)
                ▼
        Postgres (Supabase) + RLS          Supabase Auth
                ▲
                │ /api/* com cookie de sessão · polling 3 s (1 s com liberação ativa)
        PWA: CollectorDataSource → api-source · profile-store
```

### 3.2 Modelo de dados

```text
schools
├── school_classes                (nível de ensino, série, turma, ano letivo)
├── profiles ── auth.users        (exibição: apelido, avatar, papel, turma/função)
│   ├── person_records            (cadastro protegido: nome, sobrenome, nascimento)
│   ├── guardian_consents         (LGPD art. 14)
│   └── xp_transactions ──► profile_xp (view)
└── collectors                    (código único, capacidade, reserva, valve_kind)
    ├── devices                   (device_key, token_hash, is_simulated, firmware_version; 1 ativo)
    ├── collector_state           (1:1 — última leitura, accounting jsonb, simulation jsonb)
    ├── telemetry                 (histórico amostrado)
    └── device_commands ── mission_executions   (1:1 — command_id obrigatório)

participant_age_bands (view): faixa etária por escola, papel e turma, sem datas
```

### 3.3 Fluxo da missão (existente)

```text
Estudante segura "Liberar"
  → POST /api/collectors/EC-001/commands {command_id, execution_id, mission_id}
  → servidor: missão do catálogo · litros (ou plano de resgate pelo nível medido)
              · recusa se offline / ocupado / água insuficiente (fica registrado)
  → device_commands (QUEUED) + mission_executions
  → dispositivo recebe o comando na resposta da telemetria
  → EXECUTING (válvula aberta) → MEASURING (superfície estabiliza) → COMPLETED
  → relatório com delivered_liters MEDIDO
  → servidor: reúso na contabilidade · xp_transactions (única por execução)
  → app recarrega /api/me: XP, nível e conquistas
```

### 3.4 Princípios arquiteturais já consolidados

Estes princípios devem ser **preservados** em qualquer evolução:

1. **O servidor é a autoridade.** Volume, XP, papel e escola nunca vêm do navegador.
2. **Conclusão por medição.** Nunca por comando ou por tempo de válvula aberta.
3. **Procedência explícita.** `is_simulated` em dispositivos, comandos e telemetria; selo SIMULAÇÃO na interface.
4. **Idempotência e concorrência resolvidas no banco.** Chave `command_id`, índice único parcial e `SELECT … FOR UPDATE`.
5. **Separação de dados pessoais.** `profiles` × `person_records`, idade sempre calculada.
6. **Contrato de dispositivo estável.** A tela nunca fala com o dispositivo.

### 3.5 Perguntas de arquitetura respondidas

| Pergunta | Resposta | Evidência no código |
|---|---|---|
| Suporta múltiplos captadores? | **Banco e API: sim. Interface: não.** | Estado, trava e comando ativo são por captador. A interface usa `codes[0]` ([`collector-source.tsx`](../src/components/collector/collector-source.tsx#L24)) |
| Suporta múltiplas escolas? | **Modelo de dados: sim. Operação: ainda não.** | `school_id` + RLS testados. Mas `collectors.code` é único no sistema, `schools.name` também, cada perfil tem uma escola e `ensureCollector` usa `on conflict (code)` sem checar a escola ([`provisioning.ts`](../src/lib/server/provisioning.ts#L81)) |
| Suporta múltiplos usuários? | **Sim.** | Supabase Auth, 4 papéis, código + PIN. Limites: criação só por linha de comando; sem redefinição de PIN nem bloqueio por conta |
| O modelo de dados permite expansão? | **Sim para escolas, turmas e XP. Rígido em quatro pontos.** | Execução exige comando de água ([migration](../supabase/migrations/20260915000000_collectors_missions_xp.sql#L126)); telemetria com colunas fixas; dispositivo preso a um captador; comando aceita só `dispense` (L95) |
| A API está preparada? | **Para um captador por escola.** | Contrato validado com zod, mas sem versão no caminho (`/api/iot/telemetry`). Com firmware instalado em outras escolas, mudar o contrato fica caro |
| A autenticação está preparada? | **Para uma escola.** | Sem convites, sem redefinição de PIN, sem vínculo com mais de uma escola, sem papéis de rede |
| A telemetria está preparada? | **Para poucos captadores.** | Grava no histórico no mínimo a cada 30 s ([L106](../src/lib/server/collector-service.ts#L106)); sem resumos por período nem retenção; sem variáveis ambientais |
| Os comandos estão preparados? | **Sim, para liberação de água.** | Idempotência, expiração, uma liberação ativa. Não há outros atuadores |
| O sistema de missões está preparado? | **Não, para novos tipos.** | `MissionKind = "dispense"` ([catalog.ts](../src/lib/missions/catalog.ts#L15)); catálogo em código |
| O XP está preparado? | **Sim, com um ajuste.** | Livro-razão genérico; `source_type` limitado a `mission_execution` e `adjustment` por uma verificação do banco |
| Os indicadores estão preparados? | **Não há camada.** | Os dados brutos permitem vários indicadores (seção 10); balanço só por captador e acumulado |
| Aceita novos tipos de dispositivo? | **Parcialmente.** | O HTTP é genérico, mas `devices.collector_id` é obrigatório e não há tipo nem capacidades do dispositivo |
| É possível cadastrar um captador sem alterar código? | **Sim, pela linha de comando.** | `npm run admin -- register-device` (exige credenciais do banco e o pepper). Não há interface, e a tela mostraria só o primeiro captador |
| É possível cadastrar missões sem alterar código? | **Não.** | `MISSION_CATALOG` em TypeScript, usado pelo servidor para litros e XP |
| É possível criar novos tipos de missão? | **Não, sem migração.** | `command_id` obrigatório; `target_liters > 0` |
| É possível criar novos desafios STEM? | **Não.** | Não há estrutura de desafio, resposta ou evidência |

---

## 4. Potencial de escala

### 4.1 Dimensões de crescimento

| De → para | Hoje | Limite atual | O que é necessário |
|---|---|---|---|
| 1 → N captadores por escola | **[EXISTE]** no banco e na API | Interface só com o primeiro; o app consulta **todos** os captadores da escola a cada ciclo ([`api-source.ts`](../src/lib/iot/api-source.ts) `poll()`) | **[EVOLUIR]** Seletor/QR; consultar só o captador aberto; resumo da escola num único endpoint |
| 1 → N escolas | **[EXISTE]** isolamento por `school_id` + RLS | Códigos globais; provisionamento sem checar escola; sem onboarding | **[EVOLUIR]** Unicidade por escola ou código público com prefixo; vínculos; **[NOVO]** onboarding |
| 1 → N turmas | **[EXISTE]** `school_classes` com ano letivo | Sem gestão pela interface; sem virada de ano | **[NOVO]** Gestão de turmas e rematrícula anual |
| Poucos → milhares de estudantes | **[EXISTE]** Supabase Auth; login sem e-mail | Contas criadas uma a uma pela linha de comando; PIN sem redefinição | **[NOVO]** Importação em lote + cartões impressos; redefinição de PIN; bloqueio por tentativas |
| Poucas missões → biblioteca | 5 missões em código | Deploy para cada missão nova | **[EVOLUIR]** Modelos de missão no banco com tipos de validação (seção 7) |
| 1 projeto → rede de projetos replicados | Nenhuma estrutura | — | **[NOVO]** Registro de versões, montagens e testes (seção 12) |
| Professores, gestores, pesquisadores | `teacher`, `staff`, `admin` por escola | Sem papéis acima da escola | **[NOVO]** Redes, vínculos e papéis de leitura agregada (seção 9) |

### 4.2 O que já escala bem

- **Banco compartilhado com isolamento lógico por escola.** É o modelo mais simples de operar e comporta centenas de escolas num único Postgres, desde que as consultas usem os índices por escola (já existem em `profiles`, `collectors`, `school_classes`).
- **Funções serverless sem estado.** O único objeto global é o pool de conexões.
- **Concorrência por captador.** A trava é por linha de `collector_state`: captadores diferentes não disputam a mesma trava.
- **Livro-razão de XP.** O saldo é uma soma indexada por perfil (`xp_transactions_profile_idx`).

### 4.3 Onde a carga cresce: estimativas de ordem de grandeza

> Estimativas feitas a partir do código atual, a confirmar em produção. Os valores das cotas dos planos gratuitos da Vercel e do Supabase mudam: confira as páginas oficiais.

| Fonte de carga | Por unidade (código atual) | Rede de exemplo: 16 captadores, 720 estudantes |
|---|---|---|
| Telemetria dos dispositivos | 1 requisição a cada 3 s ≈ **28.800/dia ≈ 864 mil/mês** por captador | ≈ **13,8 milhões de requisições/mês**, só dos dispositivos |
| Histórico de telemetria | Grava pelo menos a cada 30 s ≈ **2.880 linhas/dia** ≈ 0,5–0,7 MB/dia com índices (**~15–20 MB/mês**) | **~250–330 MB/mês**. Esgota em poucos meses a cota de banco de um plano gratuito (da ordem de 500 MB) |
| Estado do captador | Cada leitura reescreve `accounting` (jsonb): janela de 10 min com amostras a cada 2 s ≈ **200–600 amostras (~5–15 KB)** a cada 1–3 s ([`water-accounting.ts`](../src/lib/collector/water-accounting.ts#L37)) | Escrita e WAL desproporcionais ao dado útil |
| App aberto | Por captador **da escola**, a cada 3 s: uma transação que também roda um `UPDATE` condicional de expiração ([`getSnapshot`](../src/lib/server/collector-service.ts#L334)) | Escola C (8 captadores) com 40 estudantes de app aberto ≈ **107 requisições/s**, todas no banco principal e sem cache |
| Uso mensal do app | 200 estudantes × 15 min/dia × 20 dias letivos, 1 captador ≈ **1,2 milhão de requisições/mês** | Nessa escala, o app pesa mais que os dispositivos |

**Conclusão:** a arquitetura não precisa ser trocada, mas quatro ajustes são necessários antes de uma rede (seção 19, R6):

1. telemetria histórica com "batimento" mais longo (ex.: 5 min quando nada muda) + resumos por hora e dia + retenção dos dados brutos;
2. tendência com menos amostras ou com acumuladores da regressão, em vez de uma lista de amostras;
3. o app consulta só o captador aberto; a expiração de comandos sai da leitura;
4. Realtime/SSE ou cache curto para as leituras.

---

## 5. Potencial de replicabilidade

### 5.1 O que já favorece a replicação

| Característica | Por que ajuda | Marca |
|---|---|---|
| Contrato único dispositivo ↔ plataforma | Uma escola pode usar outro microcontrolador, desde que siga o mesmo JSON | **[EXISTE]** |
| Dispositivo virtual | A escola aprende e testa a plataforma **antes** de comprar peças | **[EXISTE]** |
| Firmware aberto no repositório, com credenciais fora do Git | Base para qualquer escola gravar o seu | **[EXISTE]** etapa 1 |
| Cadastro de captador sem mudar código | `register-device` gera o token uma vez; o banco guarda só o hash | **[EXISTE]** pela linha de comando |
| Status honestos do dispositivo | Firmware sem calibração envia `CALIBRATING`; sem válvula, `MAINTENANCE`. As missões ficam indisponíveis | **[EXISTE]** |
| Protocolos físicos documentados | Identificação da válvula de 3 fios, relés, teste de vazão, calibração ([`HARDWARE.md`](./HARDWARE.md)) | **[EXISTE]** como texto |
| Mensagens de falha legíveis | `FAILURE_COPY` explica `NO_FLOW`, `TIMEOUT` etc. | **[EXISTE]** |

### 5.2 O que impede a replicação hoje

1. **Não há lista de materiais com custos**, desenhos, fotos, esquema elétrico nem arquivos 3D.
2. **A calibração é gravada no firmware** ([`config.h`](../firmware/include/config.h#L27)): não fica registrada na plataforma, não tem versão e não é auditável.
3. **O cadastro exige credenciais de banco** (linha de comando). Uma escola parceira não consegue se cadastrar sozinha.
4. **Códigos de captador são globais.** Duas escolas não podem ter `EC-001`.
5. **Não há versão do hardware** associada ao captador. Dados de captadores diferentes não são comparáveis.
6. **Não há "certificação" da instalação.** Um captador mal calibrado entraria nos indicadores de impacto.
7. **Licenças não definidas.** Sem licença explícita, outra escola não tem permissão clara para reutilizar código, projeto e manual. *(Decisão do responsável pelo projeto; ver R11.)*

### 5.3 Arquitetura de replicabilidade proposta

A replicação deve ser tratada como um **pacote versionado** e um **registro de montagens**:

```text
PACOTE DE REPLICAÇÃO  (ex.: "Captador EcoHorta 1.1")
├── versão do projeto hidráulico (medidas, peças, arquivos 3D)
├── versão do projeto eletrônico (esquema, componentes)
├── versão do firmware compatível
├── versão do manual
├── protocolo de calibração
└── protocolos de teste de aceitação (vazão, estanqueidade, NO_FLOW)

MONTAGEM (unidade física construída por uma escola)
├── pacote/versão usada + componentes realmente instalados
├── custo real, equipe, data
├── calibração registrada
├── testes de aceitação executados
└── ► certificação ► captador passa a contar nos indicadores de impacto
```

### 5.4 Jornada de uma escola (10 passos pedidos) × plataforma

| Passo | Como pode funcionar | Base hoje | Marca | Prioridade |
|---|---|---|---|---|
| 1. Conhecer o projeto | Página pública com impacto real e vídeo | Nenhuma página pública; app exige login | **[NOVO]** | C |
| 2. Aprender como funciona | Laboratório no navegador com a física do dispositivo virtual, sempre marcado SIMULAÇÃO | `virtual-device.ts` é TypeScript puro, sem dependências de Node: **pode rodar no navegador** | **[EVOLUIR]** | C |
| 3. Construir | Manual versionado + lista de materiais + arquivos | `HARDWARE.md` (checklists) | **[EVOLUIR]** | B (registrar o EC-001) / C (manual) |
| 4. Cadastrar o captador | Formulário da escola → captador + montagem | `register-device` (linha de comando) | **[EVOLUIR]** | C |
| 5. Conectar o dispositivo | Token exibido uma vez + configuração do firmware | Token gerado uma vez; `secrets.example.h` | **[EVOLUIR]** | C |
| 6. Calibrar | Assistente: adicionar 0,5 L, registrar `distance_mm`, gerar a tabela e enviar ao dispositivo | Procedimento manual; a telemetria já envia `distance_mm` | **[EVOLUIR]** | C |
| 7. Coletar dados | Painel de saúde: online, leituras, falhas | Snapshot por captador | **[EVOLUIR]** | B |
| 8. Participar das missões | Missões atribuídas pela escola | Missões de reúso | **[EXISTE]** / **[EVOLUIR]** | A/B |
| 9. Registrar resultados | Execuções, evidências, testes | Execuções de liberação | **[EVOLUIR]** | B/C |
| 10. Gerar indicadores | Painel da escola e da rede | Balanço por captador | **[EVOLUIR]** | B/C |

---

## 6. Aprendizagem STEM

### 6.1 Princípio proposto: **missões verificáveis por dados reais**

A plataforma já valida a missão de reúso pelo sensor. O mesmo princípio pode valer para as outras áreas: **o servidor confere a resposta do estudante contra o dado real medido.**

Exemplo: "Estime quantos litros o EC-001 vai captar até sexta às 12 h". Na sexta, o servidor compara a estimativa com a medição. O XP depende da qualidade do raciocínio registrado e da proximidade do resultado.

Isso transforma o captador em **laboratório de dados reais**, coerente com o "princípio de verdade" do projeto.

### 6.2 Progressão em 7 níveis × plataforma

| Nível | O que já suporta hoje | Dados disponíveis | O que falta | Primeira missão viável | Prioridade |
|---|---|---|---|---|---|
| **1. Sustentabilidade** | **[EXISTE]** Missões de reúso, resgate, balanço hídrico, alerta de transbordamento, tendência | Volume, litros reutilizados, descarte estimado, taxa de aproveitamento | Limite anti-desperdício; destino da água | Já existe: regar, irrigar, resgatar | A |
| **2. Investigação** | **[EVOLUIR]** Histórico de volume; taxa de acúmulo estimada pelo servidor | `telemetry.volume_liters` ao longo do tempo; taxa aprendida só do momento atual | Histórico da taxa de produção; **temperatura e umidade**; cadastro do aparelho de ar-condicionado; registro de hipótese e conclusão | "Em que horário o captador enche mais rápido?" (série de volume) | B |
| **3. Matemática** | **[EVOLUIR]** Volumes, percentuais, taxas e balanço já calculados | Volume, capacidade, taxa (L/h), aproveitamento | Gráficos, exportação CSV, resposta numérica validada pelo servidor | "Estimativa verificada": prever o volume de amanhã e conferir com o sensor | B |
| **4. Ciências** | **[EVOLUIR]** A física do dispositivo virtual (vazão ∝ √altura) é um modelo real | Queda de nível na liberação (dados de vazão) | Sensores de temperatura e umidade; ponto de orvalho; qualidade da água | "A vazão cai quando o nível cai?" usando os dados de uma liberação | B/C |
| **5. Programação e IoT** | **[EXISTE]** Firmware aberto, contrato documentado, dispositivo virtual em TypeScript, teste de API | Contrato JSON, códigos de status e falha | Captador "de bancada" por equipe, separado dos indicadores de impacto; trilha guiada | "Leia a telemetria do EC-002 e explique cada campo" | C |
| **6. Engenharia** | **[EVOLUIR]** Checklists da válvula e dos relés; registro de comandos (alvo × medido, falhas) | `device_commands` | Registro de versões, componentes e testes (seção 12) | "Execute o protocolo de vazão e registre os resultados" | B/C |
| **7. Design e inovação** | Nenhum | — | Projetos com iterações, custo, comparação entre versões | "Proponha uma melhoria do suporte do sensor e compare com a versão atual" | C |

### 6.3 Laboratório virtual no navegador

**[EVOLUIR, prioridade C].** A física e o "firmware" do dispositivo virtual ([`virtual-device.ts`](../src/lib/iot/virtual-device.ts)) e a calibração ([`calibration.ts`](../src/lib/iot/calibration.ts)) não dependem de Node.js. Podem rodar **no navegador de cada estudante**, como laboratório pessoal:

- mudar a vazão de condensado, a capacidade ou o ruído do sensor;
- ver a fórmula de Torricelli agir;
- provocar `NO_FLOW` e investigar por quê.

**Isso não mexe no captador compartilhado**; hoje o painel da simulação altera o EC-001 de todos e é exclusivo de educadores. Tudo continua com o selo SIMULAÇÃO.

### 6.4 Relação com o currículo

- As competências gerais da BNCC (por exemplo, pensamento científico, crítico e criativo; cultura digital; responsabilidade e cidadania) são um bom eixo para organizar as trilhas.
- **O mapeamento para habilidades específicas deve ser feito pelos professores.** Este documento não propõe códigos de habilidades.
- Registrar competências exige **evidência pedagógica** (seção 8). Não deve ser inferido de XP.

---

## 7. Sistema de missões evolutivo

### 7.1 Situação atual

| Elemento | Hoje | Consequência |
|---|---|---|
| Definição | `MISSION_CATALOG` em TypeScript | Missão nova exige código e deploy |
| Tipo | `MissionKind = "dispense"` | Só liberação de água |
| Categoria | `mission_category` aceita 7 valores no banco (`action`, `investigation`, `math`, `science`, `engineering`, `collaborative`, `rescue`) | **A intenção está no banco, mas o fluxo não existe** |
| Execução | `mission_executions.command_id` e `target_liters > 0` obrigatórios | Toda execução é uma liberação |
| Disponibilidade | Calculada pelo nível medido e pela reserva ([`availability.ts`](../src/lib/missions/availability.ts)) | Correta para reúso; não se aplica a outras missões |
| Atribuição | Todas as missões para todos | Sem turma, prazo ou agenda |
| Repetição | Ilimitada, limitada só pela água | Risco de liberar água para ganhar XP |

### 7.2 Arquitetura conceitual proposta

```text
MODELO DE MISSÃO                 (biblioteca: rede ou escola; versionado; rascunho/publicado)
│  categoria · nível/trilha · pré-requisitos · XP · competências
│  tipo de validação ───────────────────────────────┐
▼                                                  │
ATRIBUIÇÃO                                          │  Tipos de validação
│  escola / turma / equipe · período · limites      │  ─────────────────────────────────────────
▼                                                  │  sensor      liberação medida (FLUXO ATUAL)
EXECUÇÃO                                            │  dado        janela de telemetria confere um fato
│  participante ou equipe · status                  │  resposta    número comparado com o dado real (tolerância)
│  comando (só no tipo "sensor")                    │  evidência   foto/texto revisado pelo professor
▼                                                  │  experimento hipótese → coleta → conclusão (revisão)
SUBMISSÃO / EVIDÊNCIA                               │  teste       execução de protocolo de engenharia
│  respostas · arquivos · dados vinculados          │  meta        objetivo coletivo (turma, escola, rede)
▼                                                  │
VALIDAÇÃO ◄────────────────────────────────────────┘
│  automática (sensor/dado) · professor · pares
▼
RECOMPENSA
   xp_transactions (livro-razão atual) · conquistas · competências · indicadores
```

### 7.3 Caminho incremental, sem quebrar o fluxo atual

| Passo | Mudança | Preserva | Marca | Prioridade |
|---|---|---|---|---|
| 1 | Tabela de modelos de missão; `catalog.ts` vira dado inicial. As missões de liberação continuam validadas pelo sensor | Volume decidido pelo servidor; resgate calculado pelo nível | **[EVOLUIR]** | B |
| 2 | `mission_executions.command_id` e `target_liters` passam a ser obrigatórios **somente** quando o tipo é `sensor` (verificação por tipo) | Todas as regras de liberação e seus testes | **[EVOLUIR]** | B |
| 3 | `xp_transactions.source_type` aceita novas origens (ex.: validação de missão, conquista, marco de projeto) | Unicidade por origem | **[EVOLUIR]** | B |
| 4 | Tipo de validação `dado` e `resposta` (automáticos, sem carga para o professor) | — | **[NOVO]** | B |
| 5 | Atribuição por turma, prazo e **limite de repetições por dia** | — | **[NOVO]** | B |
| 6 | Submissões com evidência e revisão pelo professor | — | **[NOVO]** | C |
| 7 | Execução por equipe e metas coletivas (turma, escola) | — | **[NOVO]** | C |
| 8 | Missões entre escolas e biblioteca compartilhada com autoria | — | **[VISÃO]** | D |

### 7.4 Regras para missões de reúso em uso real

- **Limite por participante** (ex.: liberações por dia) e **missões agendadas pelo professor** quando houver horta ou jardim a regar.
- **XP só pela ação útil.** Em estágio posterior, pedir evidência do destino da água (foto do canteiro, validada por amostragem).
- **Reúso não depende de XP.** Os litros continuam contando no impacto mesmo sem pontuação.

---

## 8. Gamificação orientada a impacto

### 8.1 Diagnóstico

| Elemento | Hoje | Ponto forte | Limitação |
|---|---|---|---|
| XP | Livro-razão, só por missão concluída e medida | Auditável, sem duplicidade, nunca calculado no navegador | Uma única dimensão; só uma fonte (liberação) |
| Níveis | 10 fixos, com títulos que já contam a jornada: *Explorador, Investigador, Engenheiro Verde, Cientista, Multiplicador* | A narrativa STEM já está nos nomes | Só se sobe por liberações: "Engenheiro Verde" sem ter feito engenharia |
| Conquistas | 5, ligadas a ações físicas medidas | Nenhuma conquista por clique | Calculadas no app sobre os últimos 100 registros ([`profile-service.ts`](../src/lib/server/profile-service.ts#L102)); não ficam gravadas; regras fixas |
| Ranking | Impacto coletivo primeiro + contribuição pessoal | Não inventa participantes; privilegia o coletivo | Sem ranking por turma ou escola. O RLS impede um estudante de ler o XP de outro (correto): ranking precisa ser agregado no servidor |
| Timeline | Não existe | — | — |

### 8.2 Proposta: três dimensões em vez de uma

| Dimensão | O que representa | Como é ganha | Marca |
|---|---|---|---|
| **XP** (participação validada) | Esforço e constância | Qualquer missão **validada** (sensor, dado, professor) | **[EVOLUIR]** livro-razão atual |
| **Competências** (aprendizagem) | Medir, investigar, modelar, programar, construir, colaborar, cuidar da água | Evidências associadas a missões e projetos, validadas pelo servidor ou pelo professor | **[NOVO]** |
| **Impacto** (resultado real) | Litros reutilizados, dados coletados, versões melhoradas, escolas ajudadas | Medido pela plataforma, nunca atribuído à mão | **[EVOLUIR]** hoje só litros |

**Regras para evitar gamificação superficial:**

1. **Sem XP por clique, visita ou tempo de tela.** Só por validação (já é assim para liberações).
2. **Níveis altos exigem diversidade**, não volume. Ex.: *Engenheiro Verde* pede pelo menos um teste de engenharia registrado.
3. **Conquistas gravadas no servidor**, com regra configurável e data. Viram indicador educacional.
4. **Coletivo antes do individual**: metas de turma e escola ("a turma 6º C reutilizou 50 L"). Ranking individual, se existir, é opcional e por apelido.
5. **Colaboração vale pontos**: ajudar outra equipe ou outra escola a montar o captador (o nível *Multiplicador* ganha significado real).
6. **Timeline só com apelido** e eventos do livro-razão (missão validada, conquista, marco de projeto). **[NOVO], prioridade C.**

---

## 9. Sistema multi-escola

### 9.1 Modelo de isolamento atual: manter

A plataforma usa **banco compartilhado com isolamento por linha** (`school_id` + RLS com `my_school_id()`). É o modelo recomendado para esta escala:

- uma migração vale para todas as escolas;
- indicadores agregados são consultas simples;
- o custo operacional é mínimo.

**Não é necessário um banco por escola.**

### 9.2 Lacunas antes da segunda escola

| Lacuna | Risco | Correção proposta | Prioridade |
|---|---|---|---|
| `collectors.code` único no sistema | Duas escolas não podem ter `EC-001`; o QR Code depende disso | Código público com prefixo da escola (ex.: `CLA-EC-001`) **ou** unicidade por escola + identificador público no QR | C |
| `ensureCollector` com `on conflict (code)` sem checar a escola | Provisionar o mesmo código para outra escola **altera o captador existente e troca o token do dispositivo** | Recusar conflito entre escolas | C (antes da 2ª escola) |
| `devices` com `on conflict (device_key)` move o dispositivo de captador | Um dispositivo pode ser "sequestrado" por engano | Recusar mudança de escola; exigir desativação explícita | C |
| `schools.name` único; só o nome | Escolas homônimas; sem município, UF ou código INEP para indicadores | Código INEP, município e UF | C |
| `profiles.school_id` único | Professor que atua em duas escolas precisa de duas contas | Tabela de vínculos (pessoa × escola × papel) | C |
| Papéis limitados à escola | Sem gestor regional, coordenador de rede ou pesquisador | Papéis de rede, acima da escola | D |
| Contas só pela linha de comando | Escola parceira não opera sozinha | Onboarding + convites + importação em lote | C |
| `access_code` e e-mail sintético com espaço global | Colisões controladas por tentativa; PIN de 6 dígitos | Bloqueio por conta; limite de tentativas | B |

### 9.3 Hierarquia proposta

```text
REDE (ex.: "Rede EcoHorta" ou uma diretoria de ensino)        [NOVO · D]
└── ESCOLA (INEP, município, UF)                              [EVOLUIR · C]
    ├── TURMAS (ano letivo)                                   [EXISTE]
    ├── CAPTADORES ── MONTAGENS ── DISPOSITIVOS               [EVOLUIR · C]
    ├── EQUIPES DE PROJETO                                    [NOVO · C]
    └── VÍNCULOS (pessoa × escola × papel)                    [NOVO · C]

Papéis:
  estudante · professor · funcionário · admin da escola       [EXISTE]
  gestor da escola (leitura de indicadores)                   [NOVO · C]
  coordenador de rede (onboarding e indicadores da rede)      [NOVO · D]
  pesquisador (somente dados agregados e anonimizados)        [NOVO · D]
```

### 9.4 Exemplo: três escolas

| | Escola A | Escola B | Escola C | Rede |
|---|---|---|---|---|
| Captadores | 5 | 3 | 8 | 16 |
| Estudantes | 200 | 120 | 400 | 720 |
| O que cada escola vê | Seus usuários, turmas, captadores, missões, indicadores | idem | idem | — |
| O que a rede vê | — | — | — | Totais agregados (litros, captadores ativos, participantes por faixa etária), **sem dados pessoais** |

**Regra de privacidade para agregados:** não publicar recortes com poucas pessoas (ex.: menos de 5 estudantes numa turma), para impedir a identificação indireta de menores.

---

## 10. Indicadores de impacto

### 10.1 Viabilidade com a arquitetura atual

Legenda:
- **Disponível:** já calculado e exibido.
- **Consulta nova:** dado já gravado; falta consulta ou tela.
- **Nova estrutura:** exige novas tabelas ou campos.
- **Externo:** depende de processo fora da plataforma.

#### Impacto hídrico

| Indicador | Viabilidade | Fonte | Observação |
|---|---|---|---|
| Litros captados (acumulado por captador) | Disponível | `collector_state.accounting` → `totals.capturedLiters` | Derivado do balanço; "Reiniciar simulação" zera; sem série por período |
| Litros captados por período | Nova estrutura | — | Resumo periódico do balanço ou da taxa de produção |
| Litros armazenados agora | Disponível | `collector_state.volume_liters` | Medido |
| Litros armazenados ao longo do tempo | Consulta nova | `telemetry.volume_liters` | Amostrado (≤ 30 s) |
| Litros reutilizados por captador | Disponível | `accounting.reusedLiters`; `device_commands.delivered_liters` | Medido pelo sensor |
| Litros reutilizados por escola | Consulta nova | `device_commands` ⨝ `collectors.school_id` | — |
| Litros reutilizados por período | Consulta nova | `device_commands.finished_at` | — |
| Litros reutilizados por turma ou participante | Consulta nova | `mission_executions` ⨝ `profiles.class_id` | Respeitar tamanho mínimo de grupo |
| Número de ações de reúso | Consulta nova | `mission_executions` com `COMPLETED` | Definir se cancelamento com água liberada conta |
| Descarte estimado | Disponível (acumulado) | `accounting.discardedEstimatedLiters` | Sempre rotulado **estimado**; sem série |
| Taxa de aproveitamento | Disponível | `reuseRate()` | — |
| Destino da água (horta, jardim…) | Consulta nova (declarado) | `mission_id` → local da missão | Local **declarado** pela missão, não verificado |

#### Impacto tecnológico

| Indicador | Viabilidade | Fonte | Observação |
|---|---|---|---|
| Captadores ativos | Consulta nova | `collector_state.last_seen_at` | Definir "ativo" (ex.: telemetria nas últimas 24 h) |
| Dispositivos conectados agora | Disponível (por captador) | Snapshot: `OFFLINE` após 15 s | — |
| Horas de operação | Consulta nova (aproximada) | Intervalos em `telemetry.recorded_at` | Mais preciso com resumo de disponibilidade |
| Leituras armazenadas | Consulta nova | `count(telemetry)` | Leituras **enviadas** ≠ **armazenadas** (amostragem) |
| Liberações e falhas por motivo | Consulta nova | `device_commands.status`, `failure` | Também indicador de engenharia |
| Precisão da liberação (pedido × medido) | Consulta nova | `target_liters` × `delivered_liters` | — |
| Versões de firmware em campo | Consulta nova | `devices.firmware_version` | Atualizado a cada telemetria |
| Experimentos realizados | Nova estrutura | — | — |

#### Impacto educacional

| Indicador | Viabilidade | Fonte | Observação |
|---|---|---|---|
| Estudantes cadastrados e ativos | Consulta nova | `profiles`; `mission_executions` | Ativo = ao menos uma execução no período |
| Turmas participantes | Consulta nova | `profiles.class_id` | — |
| Participantes por faixa etária | Disponível (view) | `participant_age_bands` | Sem datas de nascimento |
| Missões concluídas por categoria | Consulta nova (só ação e resgate) | `mission_executions.mission_category` | Outras categorias não têm fluxo |
| Missões STEM, investigações, desafios de programação e matemática, projetos de engenharia | Nova estrutura | — | Seção 7 |
| Habilidades desenvolvidas | Nova estrutura + processo pedagógico | — | Não inferir de XP |
| Professores envolvidos | Consulta nova (parcial) | `profiles` + `device_commands.requested_by` | Só registra atividade de liberação |

#### Impacto de replicabilidade

| Indicador | Viabilidade | Observação |
|---|---|---|
| Escolas que construíram o captador | Nova estrutura | Registro de montagens |
| Captadores construídos (total) | Consulta nova | Contagem de `collectors`, mas **sem distinguir construído × cadastrado** |
| Captadores por versão | Nova estrutura | Não há versão de hardware |
| Custo médio de construção | Nova estrutura | Lista de materiais + custo real da montagem |
| Versões desenvolvidas | Nova estrutura | Só existe versão de firmware |
| Componentes substituídos por alternativas de baixo custo | Nova estrutura | `valve_kind` (4 valores) não representa versões |
| Materiais reutilizados | Nova estrutura | — |
| Comunidades alcançadas | Nova estrutura + externo | `schools` só tem nome |

#### Impacto social

| Indicador | Viabilidade | Observação |
|---|---|---|
| Escolas participantes | Consulta nova | Escolas com captador ativo ou participantes ativos |
| Estudantes e professores envolvidos | Consulta nova | Ver impacto educacional |
| Ações sustentáveis realizadas | Consulta nova (só reúso de água) | Outras ações exigem novos tipos de missão |
| Comunidades alcançadas | Nova estrutura + externo | Município/UF + informação da escola |

### 10.2 Regras obrigatórias para indicadores

1. **Separar real × simulação** em todo indicador. Os dados já têm a marcação: `devices.is_simulated`, `device_commands.is_simulated`, `telemetry.is_simulated`. Número apresentado à banca sem essa separação viola o princípio do projeto.
2. **Estimativas sempre rotuladas** (descarte, horas de operação).
3. **Definições escritas e versionadas** (glossário: o que é "litro reutilizado", "estudante ativo", "captador ativo").
4. **Só captadores certificados** (calibração + teste de aceitação) entram nos indicadores **reais** de impacto.
5. **Tamanho mínimo de grupo** em qualquer recorte com pessoas.

### 10.3 Arquitetura de indicadores proposta

```text
tabelas operacionais (existentes)
  → views de indicadores (sempre com real × simulação)            [NOVO · B]
  → resumos diários por captador / escola / turma                  [NOVO · C]
  → API de indicadores com autorização por papel                   [NOVO · B/C]
  → painel da escola · painel da rede · página pública anonimizada [NOVO · B/C/D]
```

---

## 11. Dados e investigação

### 11.1 Inventário de dados

| Dado | Onde | Frequência | Marca |
|---|---|---|---|
| Distância do sensor (mm), volume (L), percentual, faixa de nível | `telemetry`, `collector_state` | Estado a cada leitura; histórico ≤ 30 s ou em mudança | **[EXISTE]** |
| Válvula, status do dispositivo, transbordamento | `telemetry` | idem | **[EXISTE]** |
| Relógio do dispositivo (`uptime_ms`) e sequência | `telemetry` | idem | **[EXISTE]** |
| Taxa de acúmulo aprendida (L/h), tendência | `collector_state.accounting` | **Só o valor atual**, sem histórico | **[EVOLUIR]** |
| Liberações: pedido, medido, início, fim, falha, quem pediu | `device_commands`, `mission_executions` | Por evento | **[EXISTE]** |
| Temperatura, umidade relativa, ponto de orvalho | — | — | **[NOVO]** |
| Aparelho de ar-condicionado (potência, sala, horas de uso) | — | — | **[NOVO]** |
| Calibração usada em cada leitura | — (fica no firmware) | — | **[NOVO]** |
| Clima externo | — | — | **[NOVO]**, fonte pública a avaliar |

### 11.2 Perguntas investigáveis × dados necessários

| Pergunta | Dados necessários | Hoje |
|---|---|---|
| Em que horário o captador enche mais rápido? | Série de volume | **Viável** com consulta e gráfico |
| Quanta água a escola deixou de desperdiçar no mês? | Reutilizado + descarte estimado por período | **Parcial**: reutilizado sim; descarte sem série |
| A vazão cai quando o nível do tubo cai? | Leituras durante a liberação | **Parcial**: histórico amostrado (≤ 30 s ou 0,05 L); falta leitura fina da liberação |
| A produção de condensado muda com a umidade? | Umidade + taxa de produção | **Não**: sem sensor e sem série da taxa |
| Aparelhos diferentes produzem quantidades diferentes? | Um captador por aparelho + dados do aparelho | **Parcial**: vários captadores no banco; sem cadastro de aparelhos |
| Quanto teremos na sexta? (previsão) | Série + modelo simples | **Dados sim; interface não** |
| A válvula de baixo custo é tão precisa quanto a comercial? | Liberações por versão da válvula | **Parcial**: tudo gravado em `device_commands`; falta a versão do componente |
| Qual o ponto de orvalho na sala? | Temperatura + umidade | **Não** |

### 11.3 Arquitetura de dados científicos proposta

**Híbrida, sem tocar no núcleo operacional:**

- **Telemetria operacional** (nível, volume, válvula): continua tipada em `telemetry`, porque é ela que decide missões e XP. **[EXISTE]**
- **Leituras científicas genéricas**: `sensors` (tipo, modelo, unidade, instalação, calibração) + `sensor_readings` (sensor, grandeza, valor, unidade, horário). Permite temperatura, umidade e, no futuro, umidade do solo da horta, sem migração por grandeza. **[NOVO, B]**
- **Resumos por hora e dia** de volume, taxa de produção, reúso, descarte estimado, temperatura e umidade. É a base de gráficos, missões de matemática e indicadores. **[NOVO, B/C]**
- **Procedência em cada conjunto de dados**: real × simulação, versão da calibração, versão do hardware e do firmware, qualidade (leitura válida, sensor em erro). **[EVOLUIR, C]**
- **Acesso:** gráficos no app (B), exportação CSV para missões de matemática (B), dados abertos anonimizados da rede (D).

**Observação técnica:** o firmware da etapa 1 já usa o barramento I²C do VL53L1X. Um sensor de temperatura e umidade I²C no mesmo barramento é uma adição de hardware pequena. O modelo exato deve ser escolhido nos testes, como a válvula.

**Limites de interpretação a ensinar:**
- correlação não é causa;
- poucos dias de dados não sustentam conclusões;
- captadores diferentes só são comparáveis com a mesma versão de hardware e calibração conhecida.

**Previsões e IA:** fora do escopo agora. A tendência calculada hoje já é uma **regressão linear** sobre uma janela de 10 minutos ([`water-accounting.ts`](../src/lib/collector/water-accounting.ts)): é um modelo matemático real, que pode ser explicado aos estudantes.

---

## 12. Engenharia e redução de custos

### 12.1 O ciclo de engenharia registrado pela plataforma

```text
PROBLEMA (válvula motorizada cara)
→ INVESTIGAÇÃO (requisitos: vazão por gravidade, estanqueidade, torque, falha segura)
→ PROJETO (versão 0.1 · registro convencional + motor + engrenagens impressas)
→ MODELAGEM / IMPRESSÃO / MONTAGEM (arquivos, material, custo real, equipe)
→ PROGRAMAÇÃO (firmware compatível com o novo acionamento)
→ TESTE (mesmos protocolos da válvula comercial + dados reais das liberações)
→ MELHORIA (versão 0.2 …)
→ COMPONENTE DE BAIXO CUSTO APROVADO (entra no pacote de replicação)
```

### 12.2 Sementes que já existem

| Semente | Onde | Uso futuro |
|---|---|---|
| Tipo de válvula no captador | `collectors.valve_kind` (`undefined`, `solenoid_direct_acting`, `motorized_ball`, `pump`) | Insuficiente para versões; vira referência a um componente |
| Versão do firmware | `devices.firmware_version`, atualizada pela telemetria | Comparar comportamento entre versões |
| Registro de cada liberação | `device_commands`: `target_liters`, `delivered_liters`, `started_at`, `finished_at`, `failure` | **Bancada de testes automática** |
| Detecção de queda sem comando | [`water-accounting.ts`](../src/lib/collector/water-accounting.ts#L100): queda > 0,3 L sem liberação ajusta o balanço | Pode virar **evento de possível vazamento** (teste de estanqueidade) |
| Protocolos físicos | [`HARDWARE.md`](./HARDWARE.md) §2.2–2.4 (identificação da válvula, relés, vazão) | Viram protocolos de teste registrados |
| Falhas tipadas | `NO_FLOW`, `TIMEOUT`, `SENSOR_ERROR` | Confiabilidade por versão |

### 12.3 Métricas de engenharia calculáveis a partir dos comandos

| Métrica | Cálculo | Hoje |
|---|---|---|
| Erro de volume (precisão) | `delivered_liters − target_liters` (absoluto e %) | **Consulta nova** |
| Taxa de falha por motivo | Comandos `FAILED` por `failure` ÷ total | **Consulta nova** |
| Vazão média por liberação | `delivered_liters ÷ duração` | **Aproximada**: a duração inclui a estabilização. Mais preciso com um campo opcional de tempo de válvula aberta no relatório do firmware (compatível com o contrato atual) |
| Ciclos de acionamento (desgaste) | Contagem de liberações por montagem ou componente | **Consulta nova**, mas exige saber qual válvula estava instalada |
| Estanqueidade | Quedas de nível sem comando (eventos) | **[EVOLUIR]** hoje só ajusta o balanço, sem registro |
| Tempo de resposta da válvula | Comando → abertura detectada | **[NOVO]** campo no relatório |

### 12.4 Modelo de registro proposto

```text
hardware_designs          captador · válvula · suporte do sensor · caixa eletrônica
└── design_versions       1.0 · 1.1 · 2.0 — status (experimental/validado/descontinuado),
    │                     changelog, arquivos (3D, esquemas), licença, autores/equipe
    ├── bom_items ──► components    (catálogo; custo de referência COM data e fonte)
    └── test_protocols              (vazão, estanqueidade, ciclos, NO_FLOW)

builds                    unidade física: versão, escola, equipe, data, custo real
├── build_components      componente instalado com datas de instalação e remoção
├── calibrations          pontos distância → volume, data, responsável, ativa
├── test_runs             protocolo, medições, aprovado?
└── collectors.build_id   → comandos e telemetria passam a ter hardware conhecido

engineering_projects      problema → hipótese → versões → testes → conclusão · equipe
```

**Detalhe importante:** a válvula pode ser trocada no mesmo captador. Por isso os componentes instalados precisam de **período de instalação**: cada liberação é atribuída à válvula que estava instalada **naquele momento**. Sem isso, a comparação comercial × baixo custo fica errada.

### 12.5 Versões do captador físico

| Captador | Montagem | Válvula | Uso nos dados |
|---|---|---|---|
| EC-001 | Versão 1.0 (escola de origem) | Esférica motorizada comercial | Referência |
| EC-002 | Versão 1.1 (montado pelos estudantes seguindo o manual v1) | Comercial | Valida o manual |
| Escola parceira | Versão 2.0 | Baixo custo (projeto dos estudantes) | Comparação por versão |

Hoje nenhuma dessas diferenças pode ser registrada. **[NOVO]**: uma versão simples de hardware no captador é prioridade **B**; o modelo completo é **C**.

### 12.6 Critérios para a válvula de baixo custo

Os mesmos critérios da válvula comercial ([`HARDWARE.md`](./HARDWARE.md) §2), mais os específicos de peças impressas:

- vazão por gravidade no nível mínimo;
- não pingar fechada;
- comportamento definido na falta de energia (a válvula de 3 fios comercial **fica na última posição**);
- fim de curso confiável e tempo máximo de motor ligado;
- material adequado à umidade e ao esforço;
- número de ciclos sem falha;
- custo total **real**, incluindo filamento, motor, driver e tempo de impressão.

A plataforma **não deve assumir** um modelo de válvula (regra do projeto). A versão entra como dado, não como código.

---

## 13. Manual "Construa seu próprio captador"

### 13.1 Estrutura proposta × o que existe

| Módulo | Conteúdo | Existe hoje |
|---|---|---|
| 0. Visão e segurança | O que é, riscos elétricos perto da água, trabalho em altura, responsabilidades | Parcial (HARDWARE.md) |
| 1. Como funciona | Condensado → captador → sensor → plataforma; laboratório virtual | Parcial (dispositivo virtual) |
| 2. Materiais e custos | Lista de materiais por versão, custo de referência com data, alternativas | Não |
| 3. Parte hidráulica | Tubo, medidas, dreno de segurança, vedação, fixação | Não |
| 4. Eletrônica | Esquema ESP32 DevKit V1 + VL53L1X + relés + válvula, fonte, proteção | Parcial (checklists §2.2–2.3) |
| 5. Peças 3D | Arquivos, material, parâmetros de impressão | Não |
| 6. Firmware | Gravação, credenciais, configuração, pinagem | Parcial ([`firmware/`](../firmware/), HARDWARE.md §6) |
| 7. Instalação | Ligação ao dreno do ar-condicionado, altura, acesso para manutenção | Não |
| 8. Cadastro e conexão | Cadastro na plataforma, token, primeira telemetria | Parcial (linha de comando) |
| 9. Calibração | Enchimentos de volume conhecido, tabela | Parcial (HARDWARE.md §4) |
| 10. Testes de aceitação | Vazão, estanqueidade, `NO_FLOW` provocado | Parcial (§2.4) |
| 11. Operação e missões | Uso com turmas | Não |
| 12. Manutenção | Limpeza, algas, sensor, **vedação contra mosquitos** | Não |
| 13. Solução de problemas | Status e falhas → causa provável → ação | Parcial (`FAILURE_COPY`) |
| 14. Contribuir com melhorias | Como propor uma nova versão | Não |

### 13.2 Temas de segurança obrigatórios no manual

- **Água não potável.** A água de condensação não é para beber. O uso em hortas pede orientação técnica: a missão atual já orienta "regue a base das plantas, não as folhas". A qualidade da água para cada uso é, por si, um tema de investigação (nível 4).
- **Água parada.** O reservatório precisa ser **fechado e vedado** contra o mosquito *Aedes aegypti*, com limpeza periódica.
- **Eletricidade perto da água.** Fonte adequada, caixa protegida, sem tensão de rede exposta.
- **Falha de energia com válvula aberta.** Destino seguro da água (seção 12.6).

### 13.3 Arquitetura de entrega

- **Conteúdo como código:** o manual fica versionado no repositório (Markdown), com a mesma versão do pacote de hardware (ex.: `docs/construa/1.1/`). Toda mudança fica rastreável. **[NOVO, B/C]**
- **Página `/construa` na plataforma**, renderizando a versão escolhida. **[NOVO, C]**
- **Pontos de verificação automáticos** em cada etapa: dispositivo online? calibração salva? teste de vazão aprovado? Ao final, **certificado de instalação** que libera os indicadores reais. **[NOVO, C]**
- **Gravação do firmware pelo navegador** (Web Serial), a avaliar. **[VISÃO, D]**
- **Licenças:** escolher licenças abertas para software, hardware e documentação antes de publicar o manual. **Decisão do responsável pelo projeto.**

---

## 14. Roadmap

### 14.1 Avaliação do mapa proposto (6 fases)

| Fase proposta | Avaliação |
|---|---|
| 1 — Protótipo (captador + ESP32 + sensor + válvula + plataforma) | **Concordo, com um critério de passagem.** A válvula só entra depois dos checklists físicos. O firmware atual **não controla válvula**. Sem validação até a demonstração, o protótipo mostra sensor real + liberação na SIMULAÇÃO, declarado |
| 2 — Demonstração (missões + água real + indicadores) | **Juntar com a Fase 1.** A demonstração de setembro **é** o marco do protótipo. Falta uma fase que o mapa não tem: **piloto real na escola**, semanas de operação com dados reais. Sem ele, investigação e indicadores não têm base |
| 3 — Aprendizagem STEM | **Concordo**, depois do piloto. Missões de dados precisam de dados reais acumulados |
| 4 — Replicação (manual, vídeos, kits) | **Dividir em duas.** Primeiro **replicação interna** (EC-002 montado pelos estudantes com o manual v1), depois externa. Um manual não testado por outra equipe não está pronto para outra escola |
| 5 — Rede (várias escolas e captadores) | **Começar por um piloto com 2–3 escolas parceiras.** A replicação externa e a rede acontecem juntas: a escola que constrói também precisa estar cadastrada |
| 6 — Escala (indicadores agregados, comunidade) | **Concordo** como visão de longo prazo |
| — | **Faltava:** a trilha de **engenharia e redução de custos** é paralela, não uma fase. Começa quando a válvula comercial estiver validada, porque ela é a referência de comparação |

### 14.2 Mapa de evolução revisado

```text
FASE 0 — PROTÓTIPO DEMONSTRÁVEL                          até 30/09/2026   [A]
  Plataforma em produção (Supabase + HTTPS) · sensor real enviando telemetria
  · missão ponta a ponta (válvula real SE validada; senão SIMULAÇÃO declarada)
  · registro fotográfico e de custos da montagem do EC-001

FASE 1 — PILOTO REAL NA ESCOLA                           ~4–8 semanas     [B]
  Operação contínua · dados reais · painel do professor · indicadores reais × simulação
  · limites anti-desperdício · firmware com válvula (após checklists)

FASE 2 — APRENDIZAGEM STEM COM DADOS REAIS                                 [B]
  Missões no banco · validação por dado e por resposta · temperatura e umidade
  · gráficos e CSV · conquistas gravadas · ranking por turma

FASE 3 — REPLICAÇÃO INTERNA + ENGENHARIA                                   [C]
  EC-002 montado pelos estudantes com o manual v1 · registro de versões, montagens e testes
  · calibração registrada · início da válvula de baixo custo

FASE 4 — PILOTO DE REDE (2–3 ESCOLAS PARCEIRAS)                             [C]
  Multi-escola endurecido · onboarding · /construa · certificação de instalação
  · evidências · timeline · missões colaborativas

FASE 5 — REDE E COMUNIDADE                                                  [D]
  Indicadores agregados públicos · biblioteca compartilhada de missões · dados abertos
  · contribuições de versões de hardware · novos dispositivos

TRILHA PARALELA — ENGENHARIA E CUSTO   (a partir da válvula comercial validada)
```

### 14.3 Matriz de escala

| Recurso | Existe hoje | Precisa evoluir | Complexidade | Impacto | Prioridade |
|---|---|---|---|---|---|
| Múltiplos captadores | Sim no banco e na API; interface mostra só o primeiro | Seletor/QR; consultar só o captador aberto | Baixa–média | Alto | **A\*** / B |
| Múltiplas escolas | Parcial: `school_id` + RLS testados | Códigos, provisionamento seguro, vínculos, onboarding | Média | Alto | C |
| Múltiplas turmas | Sim, com ano letivo | Gestão pela interface; virada de ano; ranking por turma | Baixa | Médio | B |
| Usuários | Sim: 4 papéis, código + PIN, e-mail | Criação e PIN pela interface; bloqueio por conta; papéis de rede | Média | Alto | B / D |
| Telemetria | Sim: nível, volume, válvula, status (amostrada) | Batimento mais longo, resumos, retenção, variáveis ambientais | Média | Alto | B / C |
| Comandos | Sim: liberação idempotente | Tempo de válvula no relatório; outros atuadores | Média | Médio | B / C |
| Missões | Parcial: 4 + resgate, em código | Modelos no banco, tipos de validação, atribuição, limites | Alta | Alto | B |
| XP | Sim: livro-razão | Novas origens; limites | Baixa | Médio | B |
| Níveis e conquistas | Parcial: fixos; conquistas calculadas no app | Conquistas gravadas e configuráveis; níveis com diversidade | Baixa–média | Médio | B |
| Ranking | Parcial: coletivo + pessoal | Por turma e escola (agregado no servidor) | Média | Médio | B |
| Timeline | Não | Feed de eventos do livro-razão, só apelido | Média | Médio | C |
| Indicadores | Parcial: balanço por captador; faixa etária | Views real × simulação, resumos, API, painéis | Média | Alto | B |
| Dashboard (professor e escola) | Não | Turma, participantes, captadores, indicadores | Média | Alto | B |
| STEM | Não (categorias previstas no banco) | Validação por dado e resposta; evidências; trilhas | Alta | Alto | B / C |
| Documentação | Parcial: arquitetura, hardware, README | Registro da montagem; manual versionado | Média | Alto | **A** (registro) / B |
| Replicabilidade | Parcial: contrato único, virtual, firmware aberto | Pacote versionado, certificação, licenças, onboarding | Alta | Alto | C |
| Cadastro de dispositivos | Parcial: linha de comando | Interface com token de exibição única; tipos e capacidades | Média | Alto | C |
| Calibração | Parcial: gravada no firmware | Registro no banco; assistente; envio ao dispositivo | Média | Alto | B / C |
| Dashboard de dados científicos | Parcial: série de volume | Temperatura e umidade; taxa histórica; gráficos; CSV | Média | Alto | B |
| Engenharia (versões e testes) | Não (`valve_kind`, `firmware_version`) | Versão simples; depois designs, montagens, testes | Média | Alto | B / C |
| Redução de custos | Não | Materiais e custos; válvula de baixo custo; comparação por dados | Alta | Alto | C |
| Evidências (fotos e textos) | Não | Armazenamento, moderação, LGPD | Média | Médio | C |
| Segurança em escala | Parcial | Bloqueio por conta, redefinição de PIN, TLS verificado, versão da API | Média | Alto | B / C |
| Custo de infraestrutura | Não monitorado | Intervalos, resumos, Realtime/cache | Média | Alto | B / C |
| Laboratório virtual | Parcial: física em TS puro, rodando em Node | Versão no navegador para estudantes | Média | Médio | C |
| Rede e indicadores agregados | Não | Redes, papéis, anonimização, dados abertos | Alta | Alto | D |

\* **A apenas se o ESP32 real for demonstrado num captador separado** (ex.: EC-002). Hoje a interface mostraria só o EC-001 (simulado). Ver seção 15, item A5.

---

## 15. MVP de setembro (prioridade A)

Faltam cerca de duas semanas. O critério é: **só entra o que torna a demonstração real e honesta.**

| # | Item | Por que é A | Marca |
|---|---|---|---|
| A1 | Supabase configurado + migrations + seed + contas reais (professor e alguns estudantes) | Sem isso, nada da persistência, do login e do XP funciona fora dos testes. **Bloqueado pelo `.env.local`** | **[EXISTE]** em código; falta configurar |
| A2 | Deploy HTTPS + PWA instalado no celular + `npm run smoke` na URL pública | A banca precisa ver o app real, e o service worker só funciona com HTTPS | **[EXISTE]** em código; falta publicar |
| A3 | ESP32 + VL53L1X enviando telemetria real com calibração mínima (ideal: 5 pontos ou mais) | É a prova física central: água real → sensor → plataforma | **[EXISTE]** firmware etapa 1 (compila); falta gravar, montar e calibrar |
| A4 | **Decisão sobre a válvula na demonstração** | Liberação real exige firmware com controle de válvula, que **ainda não existe**, e os checklists físicos. Proposta: se a válvula estiver validada até ~23/09, implementar a etapa 2 mínima; senão, liberação na SIMULAÇÃO, **declarada**, ao lado do nível real | **[NOVO]** se válvula real |
| A5 | **Mostrar o captador real na interface** | O plano atual registra o ESP32 como EC-002; a interface só mostra o primeiro captador (EC-001, simulado). Opções: (a) ESP32 no EC-001, perdendo a simulação de missões; (b) seletor mínimo de captador. **Decisão do responsável** | **[EVOLUIR]** |
| A6 | Registrar a montagem do EC-001: fotos, medidas, materiais, custos reais, tempo gasto, problemas | Custo zero; se não for feito agora, se perde. Alimenta o relatório, o manual e a linha de base de custo | Processo, sem código |
| A7 | Roteiro de demonstração e narrativa "existe × roadmap" | Evita apresentar visão como funcionalidade; este documento é a base | Processo |

**Fica fora de setembro** (e por quê):
- missões novas, missões no banco, indicadores agregados, painel do professor: exigem migrações e telas, e competem com A1–A5;
- sensores de temperatura e umidade: exigem hardware, firmware e migração;
- multi-escola, onboarding, manual na plataforma, válvula de baixo custo: dependem de um captador validado e de dados reais;
- timeline, ranking por turma, evidências com fotos: não mudam a prova física.

**Checklist de honestidade para a banca:**
- [ ] Todo número mostrado diz se é **real** ou **SIMULAÇÃO**.
- [ ] "Descartado" sempre aparece como **estimado**.
- [ ] A liberação só é chamada de física se a válvula real estiver ligada e validada.
- [ ] A visão (STEM, replicação, rede) aparece como **roadmap**, apontando as estruturas que já existem (isolamento por escola, livro-razão, contrato único, procedência dos dados).

---

## 16. Próxima fase (prioridade B): piloto real

| # | Item | Por que é B |
|---|---|---|
| B1 | Painel do professor: turmas, participantes, criação em lote e cartões de acesso, redefinição de PIN | O piloto não pode depender da linha de comando nem de uma única pessoa |
| B2 | Camada de indicadores (views + tela) com real × simulação | Primeiros indicadores reais para relatório e escola, com dados já gravados |
| B3 | Modelos de missão no banco + execução generalizada + novas origens de XP | Destrava STEM sem deploy por missão; preserva o fluxo de liberação |
| B4 | Primeiras missões validadas por dado e por resposta (medição, estimativa verificada) | Aprendizagem sem sobrecarregar o professor com revisões |
| B5 | Limites anti-desperdício nas missões de reúso + conquistas gravadas | Com água real, XP não pode incentivar desperdício |
| B6 | Sensor de temperatura e umidade + leituras genéricas + gráficos + CSV | Base das investigações científicas e matemáticas |
| B7 | Vários captadores na interface (seletor/QR) + consulta só do captador aberto | Necessário assim que houver EC-002 ou captador de bancada |
| B8 | Versão simples de hardware e componente no captador + calibração registrada no banco | Garante que os dados do piloto sejam comparáveis depois |
| B9 | Firmware etapa 2 (válvula), após checklists; tempo de válvula aberta no relatório | Liberação física real, com métricas de engenharia |
| B10 | Custo de operação: batimento de telemetria, intervalo menor fora do horário escolar | Operação contínua cabendo em planos gratuitos |
| B11 | Bloqueio de tentativas de PIN por conta; política de retenção e relatório de impacto à proteção de dados (RIPD) | Dados de menores em uso real |
| B12 | Ranking por turma (coletivo, agregado no servidor) | Engajamento sem expor indivíduos |
| B13 | Licenças do software, hardware e documentação | Pré-requisito para publicar o manual |

---

## 17. Visão de longo prazo (prioridades C e D)

### C: roadmap de escala

| Item | Por que é C |
|---|---|
| Replicação interna (EC-002 com o manual v1) | Valida o manual antes de outra escola |
| Registro completo de engenharia: designs, versões, montagens, componentes com período, testes | Necessário para comparar versões e custos |
| Trilha da válvula de baixo custo | Depende da válvula comercial validada como referência |
| Multi-escola endurecido: códigos, provisionamento seguro, vínculos, INEP/município | Obrigatório antes da segunda escola |
| Onboarding de escola + cadastro de captador e assistente de calibração pela interface | Autonomia das escolas parceiras |
| `/construa` com pontos de verificação e certificado de instalação | Replicação com dados confiáveis |
| Evidências com fotos e revisão; missões colaborativas e por equipe | Aprendizagem por projeto, com cuidados de LGPD |
| Timeline | Engajamento, depois de existirem eventos além das liberações |
| Laboratório virtual no navegador | Aprender antes de construir; escola sem hardware participa |
| Resumos, retenção, Realtime/cache; versão da API IoT para firmware em campo | Custo e evolução segura com dispositivos em outras escolas |
| Piloto com 2–3 escolas parceiras | Prova de replicação |

### D: visão de longo prazo

| Item | Por que é D |
|---|---|
| Rede de escolas com indicadores agregados públicos | Exige várias escolas certificadas e governança de dados |
| Papéis de rede (coordenação, gestão, pesquisa) com dados anonimizados | Exige acordos institucionais e LGPD madura |
| Biblioteca compartilhada de missões com autoria entre escolas | Exige comunidade de professores |
| Dados abertos anonimizados | Exige volume, qualidade e procedência dos dados |
| Comunidade de versões de hardware e kits | Exige projeto estável e licenças |
| Gravação de firmware pelo navegador | Conveniência que só compensa com muitas escolas |
| Novos dispositivos (umidade do solo, estação meteorológica, composteira) | Exige tipos e capacidades de dispositivo |
| Previsões e modelos de IA | Exige histórico longo e bem documentado |
| Missões entre escolas | Exige rede ativa |

---

## 18. Riscos e desafios

| Risco | Tipo | Impacto | Mitigação |
|---|---|---|---|
| Válvula não validada até setembro; a de 3 fios fica na última posição sem energia | Hardware | Alto | Checklists do HARDWARE.md; demonstração com SIMULAÇÃO declarada; destino seguro da água |
| VL53L1X instável na superfície da água (reflexo, condensação, ondulação) | Hardware | Alto | Alvo flutuante, mediana, janela protegida, estado `MEASURING` |
| Wi-Fi da escola com portal de login | Infraestrutura | Alto | Roteador ou hotspot dedicado |
| **Sazonalidade do condensado** (férias, dias frios, estação seca) | Pedagógico | Alto | Missões de dados e engenharia que não dependem de água disponível |
| **XP incentivando desperdício** | Pedagógico | Alto | Limites, agendamento, evidência do destino |
| Sobrecarga do professor com revisões | Pedagógico | Alto | Priorizar validação automática por sensor e dado; revisão por amostragem |
| Gamificação superficial | Pedagógico | Médio | Três dimensões; níveis com diversidade; coletivo primeiro |
| Qualidade da água e proliferação de mosquitos | Saúde e segurança | Alto | Água não potável; reservatório vedado; limpeza; manual com segurança |
| Dados de menores (LGPD art. 14), fotos, pesquisadores | Legal | Alto | Separação já existente; tamanho mínimo de grupo; RIPD; consentimento para imagens |
| Cotas de planos gratuitos (invocações, banco) | Custo | Alto | Seção 4.3; intervalos, resumos, retenção |
| Operação dependente de uma pessoa e da linha de comando | Operacional | Alto | Painel do professor; documentação; mais de um administrador |
| Firmware em campo impede mudanças no contrato da API | Técnico | Médio | Versão da API antes de distribuir firmware a outras escolas |
| Provisionamento sobrescrevendo captador de outra escola | Segurança | Alto (em rede) | Recusar conflitos entre escolas (seção 9.2) |
| Montagens diferentes tornando dados incomparáveis | Científico | Alto | Versão de hardware, calibração registrada, certificação |
| Escolas sem impressora 3D ou sem recursos para peças | Replicação | Médio | Parceiros, kits, alternativa comercial documentada |
| Variação de preço dos componentes | Replicação | Médio | Custo de referência **com data e fonte** |
| Escopo crescendo antes do protótipo físico funcionar | Projeto | Alto | Critério da seção 15; este documento como roadmap, não como lista de tarefas |
| Sustentação após a competição | Projeto | Médio | Licenças abertas, documentação, comunidade de professores |

---

## 19. Recomendações arquiteturais

Ordenadas por dependência. Todas incrementais e preservando o fluxo missão → comando → liberação → medição → confirmação → XP.

### Manter (não mudar)

- **R1.** Isolamento por `school_id` + RLS; servidor como autoridade; conclusão por medição; `command_id` idempotente; índice de uma liberação ativa; livro-razão de XP; separação `profiles` × `person_records`; `is_simulated` em todo dado; contrato único de dispositivo.

### Evoluir

- **R2. Missões como dados** (B):
  - modelos de missão no banco, com tipo de validação;
  - `catalog.ts` vira carga inicial;
  - o servidor continua decidindo volume e XP.
- **R3. Execução generalizada** (B):
  - `command_id` e `target_liters` obrigatórios só para o tipo `sensor`;
  - submissões e evidências numa tabela própria;
  - novas origens em `xp_transactions.source_type`.
- **R4. Gamificação gravada** (B):
  - conquistas gravadas no servidor com regras configuráveis;
  - limites de repetição;
  - dimensão de competências por evidência (C).
- **R5. Camada de indicadores** (B/C):
  - views com real × simulação e definições documentadas;
  - resumos diários;
  - API por papel;
  - `schools` com INEP, município e UF.
- **R6. Ajustes de escala** (B/C):
  - interface com seletor ou QR, consultando só o captador aberto;
  - expiração de comandos fora da leitura;
  - batimento de telemetria mais longo;
  - tendência com menos amostras;
  - resumos e retenção;
  - Realtime ou cache curto.
- **R7. Multi-escola seguro** (C, antes da 2ª escola):
  - códigos públicos por escola;
  - provisionamento que recusa conflito entre escolas;
  - vínculos pessoa × escola × papel;
  - onboarding e convites;
  - importação em lote.
- **R8. Registro de hardware** (B simples, C completo):
  - versões, componentes com período de instalação, montagens, calibrações e testes;
  - `collectors.build_id`;
  - tipo e capacidades do dispositivo;
  - evento de queda sem comando (estanqueidade).
- **R9. Dados científicos** (B):
  - `sensors` + `sensor_readings` genéricos;
  - histórico da taxa de produção;
  - cadastro do aparelho de ar-condicionado;
  - gráficos e CSV.
- **R10. Contrato IoT versionado** (C):
  - caminho ou campo de versão antes de distribuir firmware;
  - campos opcionais de engenharia (tempo de válvula aberta, latência).

### Novo

- **R11. Governança** (B):
  - licenças do software, hardware e documentação;
  - política de retenção;
  - RIPD;
  - tamanho mínimo de grupo em agregados;
  - consentimento para imagens.
- **R12. Replicação** (C):
  - manual versionado junto com o pacote de hardware;
  - `/construa` com pontos de verificação;
  - certificação de instalação como condição para os indicadores reais.

---

## 20. Conclusão

### Resposta à pergunta central

> *Como transformar o atual EcoHorta Inteligente, um captador de água de condensação conectado a uma plataforma gamificada, em uma plataforma escalável de sustentabilidade, aprendizagem STEM, investigação, engenharia e replicação entre comunidades escolares?*

**Mudando a unidade de valor, de "liberação de água medida" para "evidência verificada", e organizando a plataforma em quatro camadas sobre as estruturas que já existem.**

| Camada | O que existe | O que pode ser evoluído | O que seria nova funcionalidade | Visão de longo prazo |
|---|---|---|---|---|
| **Física** (dispositivos) | Contrato único ESP32/virtual; token com hash; estado e comando por captador; procedência real × simulação | Versão de hardware; calibração no banco; tipo e capacidades do dispositivo; API versionada | Registro de montagens, componentes e testes; sensores ambientais | Novos dispositivos da horta e da escola; kits |
| **Dados** | Telemetria amostrada; contabilidade hídrica; registro completo das liberações | Histórico da taxa de produção; resumos; retenção; views real × simulação | Leituras científicas genéricas; exportação; gráficos | Dados abertos anonimizados |
| **Aprendizagem** | Missões de reúso validadas pelo sensor; livro-razão de XP; níveis com narrativa STEM | Missões no banco; execução generalizada; conquistas gravadas; limites | Validação por dado, resposta, evidência e teste; competências; trilhas | Biblioteca compartilhada; missões entre escolas |
| **Rede** | Isolamento por escola com RLS testado; privacidade estrutural; faixas etárias | Códigos por escola; provisionamento seguro; dados da escola (INEP, município) | Vínculos; onboarding; painéis; `/construa`; certificação | Redes, papéis de pesquisa, indicadores agregados públicos |

**Por que isso é viável sem reescrever:** os quatro pilares que tornam a escala possível já estão no código e testados:

1. dados separados por escola desde a primeira tabela;
2. o servidor como única autoridade;
3. um livro-razão que aceita qualquer origem de pontuação;
4. um contrato de dispositivo que já provou funcionar com dois dispositivos diferentes (virtual e ESP32).

O que falta é, principalmente, **transformar em dado o que hoje é código**: missões, conquistas, versões de hardware e calibração. Também faltam uma **camada de indicadores** e a **interface de operação** para professores e escolas.

**O que decidir agora:** nada da visão deve entrar antes da demonstração de setembro. O protótipo precisa provar a cadeia física com honestidade: água real → sensor → plataforma, e liberação real se a válvula for validada. A partir daí, o piloto real gera os dados que tornam possíveis as missões STEM, os indicadores e a replicação.

---

## Anexo: base da análise

- **Código:**
  - `src/app` (páginas e 12 rotas de API);
  - `src/components` (telas, missões, captador, simulação, autenticação, PWA);
  - `src/lib` (servidor, banco, IoT, captador, missões, gamificação, usuários, perfil);
  - `src/hooks`.
- **Banco:** `supabase/migrations/20260914000000_identity.sql` e `20260915000000_collectors_missions_xp.sql`.
- **Dispositivos:** `firmware/` (PlatformIO, etapa 1) e `tools/virtual-device/run.ts`.
- **Ferramentas:** `scripts/admin.ts`, `scripts/smoke.ts`, `scripts/dev.mjs`, `scripts/screenshot.mjs`, `scripts/generate-icons.mjs`.
- **Configuração:** `package.json`, `next.config.ts`, `vercel.json`, `.env.example`, `public/sw.js`.
- **Documentação:** `README.md`, `docs/ARCHITECTURE.md`, `docs/HARDWARE.md`, `docs/DESIGN-SYSTEM.md`.
- **Testes (15 arquivos, 137 testes):** serviço de captadores, schema e RLS, provisionamento, perfil, dispositivo virtual, missões, resgate, captador, contabilidade hídrica, conquistas, níveis, usuários, acesso, formatação.
