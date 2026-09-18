# Hardware — decisões, riscos e validação física

> Status (17/09/2026):
> - o captador físico **EC-001** em PVC DN100 está sendo montado (~1,80 m de tubo, ~1,50 m úteis);
> - ESP32 DevKit V1 (ESP32 clássico) na caixa eletrônica e **um único** sensor de distância dentro da tampa, ligados por **cabo de 4 vias (~50 cm)**: **prontos para a primeira validação física** (§8);
> - sensor: **VL53L0X ou VL53L1X**, escolhido na plataforma (**Administração → Captadores → {código} → Ligações**). O firmware tem os dois drivers e usa o do sensor configurado (§3.1);
> - módulo físico do EC-001: **CJMCU-531, baseado no VL53L1X** → o EC-001 é configurado como **VL53L1X** (nunca como VL53L0X);
> - válvula esférica motorizada DC 12 V de 3 fios e dois relés: adquiridos, **NÃO integrados** (§2);
> - firmware da etapa 1 (distância + diagnóstico + telemetria, **sem válvula**) em `firmware/`: compila para o ESP32 DevKit V1 e tem testes do núcleo de sensores no computador; ainda **não foi gravado em uma placa** (§6).

> **Convenção de identificação:** **EC-001** = captador FÍSICO (dispositivo `ESP32-001`, REAL).
> **SIM-001** = captador da SIMULAÇÃO (dispositivo `VIRTUAL-001`), só para testes e demonstração.
> O app mostra sempre o selo **REAL** ou **SIMULAÇÃO**.

## 1. Componentes do primeiro protótipo

| Componente | Função | Status |
|---|---|---|
| Captador EC-001 em PVC (DN100, ~1,80 m de tubo, ~1,50 m úteis) | Acúmulo do condensado | Em montagem — calibração e bancada no app prontas (§4, §8) |
| Mangueira transparente lateral | Indicador visual de nível (referência independente do sensor) | Em montagem |
| ESP32 DevKit V1 — ESP32 clássico, ESP32-WROOM-32 (na caixa eletrônica) | Wi-Fi, leitura do sensor, telemetria | Pronto para validação — firmware etapa 1 (compila; ainda não gravado) |
| Sensor de distância ToF **VL53L0X ou VL53L1X** — um único sensor, dentro da tampa superior, apontado para baixo. No EC-001: módulo **CJMCU-531 (VL53L1X)** | Distância até a superfície da água | Pronto para validação. Modelo escolhido na plataforma (§3.1, §8.3) |
| Cabo de 4 vias, ~50 cm instalado (VCC, GND, SDA, SCL) | Liga o sensor da tampa ao ESP32 na caixa eletrônica | Em montagem — ligação em §8.3 |
| Válvula esférica motorizada DC 12 V, 3 fios | Liberação por gravidade | Adquirida — **não integrada; modelo elétrico a identificar (§2.2)** |
| 2 módulos relé | Acionamento da válvula | **Compatibilidade a verificar (§2.3)** |
| Fonte | Alimentação da válvula e do ESP32 | Depende da tensão da válvula |

## 2. Válvula

### 2.1 Risco — válvula em sistema por gravidade

A maioria das válvulas solenoides baratas de 12 V é **servo-assistida (piloto)**. Elas precisam de **pressão diferencial mínima** (geralmente 0,02 a 0,05 MPa, ou 2 a 5 m de coluna d'água) para abrir por completo. O captador trabalha por gravidade, com poucos centímetros de coluna: com uma dessas válvulas, **a água pode não sair**.

A **válvula esférica motorizada** abre com qualquer pressão, por isso foi a escolha planejada. Mesmo assim, ela precisa passar pelo protocolo de vazão (§2.4).

### 2.2 Válvula de 3 fios — NÃO assumir o modelo elétrico

"3 fios" descreve pelo menos dois esquemas diferentes, e ligar no esquema errado pode queimar o motor ou deixar a válvula aberta:

| Esquema comum | Como funciona | Consequência |
|---|---|---|
| **Inversão por fio** (ex.: marcações CR01/CR03) | Um fio comum + um fio "abrir" + um fio "fechar". A tensão no fio "abrir" gira para um lado; no "fechar", para o outro. Fins de curso internos cortam o motor | Cada relé energiza um sentido. **Nunca** os dois ao mesmo tempo |
| **Alimentação + controle** (ex.: CR02) | Um fio de alimentação permanente, um de controle e o comum. Controle energizado = abre; desenergizado = fecha | Precisa de alimentação contínua; um relé pode bastar |

**Nenhuma das duas é à prova de falha:** sem energia, a válvula fica **na última posição**. Se faltar energia com a válvula aberta, a água continua saindo. Isso precisa ser considerado no local de instalação (a água deve escoar para uma área segura) e na política do firmware.

**Checklist de identificação (antes de ligar ao ESP32):**

1. Fotografe a etiqueta: modelo (CR01…CR05), tensão (DC 5 V, 12 V, 24 V ou AC) e esquema de fios impresso.
2. Confira a documentação do vendedor e anote as cores dos fios.
3. Com fonte de bancada **na tensão da etiqueta** e limite de corrente:
   - aplique tensão em cada par de fios e anote o que acontece (abre, fecha ou nada);
   - meça o **tempo** para abrir e para fechar por completo;
   - meça a **corrente** em movimento e ao chegar ao fim de curso;
   - confirme se o motor **desliga sozinho** no fim de curso (corrente cai a ~0).
4. Desligue a energia com a válvula no meio do curso e confirme que ela fica parada (sem retorno por mola).
5. Registre tudo nesta seção antes de escrever qualquer lógica de válvula no firmware.

### 2.3 Relés

- **Nível lógico:** muitos módulos relé de 5 V exigem VCC de 5 V e acionam com nível **baixo** (ativo em LOW). A saída de 3,3 V do ESP32 pode não acionar de forma confiável: verifique o módulo (optoacoplador, jumper JD-VCC) ou use transistor.
- **Contatos:** tensão e corrente nominais acima da corrente de pico do motor medida no §2.2.
- **Intertravamento** (esquema de inversão): os dois relés nunca podem fechar ao mesmo tempo. Garanta isso no firmware **e**, se possível, no hardware (relé reversor/SPDT em cascata).
- **Boot do ESP32 (DevKit V1):** use GPIOs que não pulsam na inicialização nem são pinos de strapping (evite GPIO0, 1, 2, 3, 5, 12, 14 e 15), nunca use GPIO6–11 (flash interno), lembre que GPIO34–39 são só entrada, e confirme que os relés ficam **desligados** ao ligar e ao reiniciar.
- **Alimentação separada** para a válvula, com terra comum apenas se o módulo exigir.

### 2.4 Protocolo de vazão (antes da lógica da válvula)

1. Encha o captador até o nível **mínimo** de operação (pior caso de pressão).
2. Abra a válvula manualmente pela fonte de bancada.
3. Meça, com recipiente graduado e cronômetro, o volume liberado em 30 s. Repita 3 vezes.
4. Repita com o captador **cheio**.
5. Registre a vazão (L/min) nos dois níveis. Esses números definem `max_duration_ms` e ajustam o dispositivo virtual (`src/lib/iot/simulation-config.ts`).
6. **Aprovação:** abre e fecha de forma confiável no nível mínimo e **não pinga fechada**.

### 2.5 Como o software já se protege

- `ValveKind` (`src/lib/iot/types.ts`) começa como `"undefined"`: nada assume um modelo.
- Missão concluída só pelo volume **medido** pelo sensor, nunca pelo tempo de válvula aberta.
- `NO_FLOW`: a válvula abre e o nível não cai → fecha e falha (sintoma de válvula inadequada).
- `TIMEOUT`: fecha ao atingir `max_duration_ms`.
- O servidor só aceita uma liberação ativa por captador (índice único no banco).

## 3. Risco — sensor ToF medindo água

- **Reflexão e transparência:** a luz infravermelha pode atravessar a água ou refletir de forma irregular.
- **Condensação na lente:** ambiente úmido.
- **Ondulação:** a água que cai agita a superfície.

**Mitigações a testar:**
1. **Alvo flutuante:** disco leve e fosco sobre a superfície, com guia.
2. Várias leituras com **mediana**, rejeitando valores fora da faixa física (já no firmware etapa 1).
3. Janela de proteção sobre o sensor, com teste de condensação.
4. Leitura final da missão só depois de a superfície estabilizar (estado `MEASURING`).

### 3.1 Sensores de distância suportados (VL53L0X e VL53L1X)

O projeto suporta **dois** sensores, mas cada captador usa **um**, escolhido na plataforma. A ligação física é a mesma (§8.3); muda só o driver do firmware.

| | VL53L0X | VL53L1X |
|---|---|---|
| Alcance documentado (ST) | até 2 m no perfil de longo alcance (1,2 m no padrão) | até 4 m no modo longo (cerca de 1,3 m no curto); mínimo 4 cm |
| Campo de visão | 25° | 27° (ROI programável, de 16×16 a 4×4) |
| Alimentação do chip | 2,6 V a 3,5 V | 2,6 V a 3,5 V |
| Endereço I²C padrão (7 bits) | **0x29** | **0x29** |
| Frequência I²C máxima | 400 kHz | 1 MHz |
| Identificação lida de registrador (conferida pelo firmware) | **model ID 0xEE**, registrador `IDENTIFICATION_MODEL_ID` = 0xC0 (índice de 8 bits, 1 byte lido) | **sensor ID 0xEACC**, registrador `IDENTIFICATION__MODEL_ID` = 0x010F (índice de 16 bits, 2 bytes lidos) |
| Módulo | outro módulo compatível com o VL53L0X | **CJMCU-531** (módulo do EC-001) |
| Driver no firmware | `VL53L0XDriver` (biblioteca Pololu VL53L0X) | `VL53L1XDriver` (biblioteca Pololu VL53L1X) |
| Configuração do firmware | longo alcance (limite de sinal 0,1 MCPS, pulsos VCSEL 18/14), 50 ms por amostra | modo longo, 50 ms por amostra, ROI 16×16 |
| Diagnóstico por amostra | amostras aceitas, faixa e timeouts (a biblioteca não informa status nem sinal) | status, sinal e luz ambiente (MCPS) |

**Endereço I²C × identificação — não confundir:**

- **0x29** é o **endereço I²C** padrão (7 bits) dos **dois** sensores: é para onde o ESP32 envia a conversa no barramento. Como é o mesmo, o endereço **não distingue** o VL53L0X do VL53L1X.
- **0xEE** e **0xEACC** são **identificadores lidos de registradores** dentro do sensor. Não são endereços.
  - VL53L0X: o firmware lê 1 byte do registrador 0xC0 (índice de 8 bits) e espera **0xEE** (model ID).
  - VL53L1X: o firmware lê 2 bytes a partir do registrador 0x010F (índice de 16 bits) e espera **0xEACC** (sensor ID).
- Os mesmos registradores e valores são conferidos pelas bibliotecas Pololu no `init()` de cada sensor. O firmware confere antes de configurar, com o driver do sensor configurado, e informa o valor lido em `sensor_diagnostics.model_id`.

**Módulo do EC-001: CJMCU-531 = VL53L1X.** O CJMCU-531 é um módulo baseado no **VL53L1X** e deve ser configurado como **VL53L1X** em Ligações. A opção VL53L0X continua existindo para **outro** módulo compatível com o VL53L0X. Se o CJMCU-531 for configurado como VL53L0X, o firmware lê o registrador 0xC0, não encontra 0xEE e não inicia o sensor, e a plataforma mostra a incompatibilidade.

- Os alcances valem para alvo branco em condições controladas. Sobre a água, dentro do tubo, precisam ser medidos na bancada.
- **VL53L0X no EC-001:** a distância da tampa até o ZERO fica perto de 1,6–1,7 m. Com o tubo vazio o sensor pode ficar fora do alcance: valide antes de calibrar.
- O manual de ligações de cada sensor (ilustração, especificações, diagrama, alimentação, testes e calibração) está no app, em **Ligações**.

**Como a escolha chega ao firmware:**

```text
Ligações (plataforma) ─► collectors.distance_sensor + hardware_revision (banco)
   troca só com a confirmação: "Confirmo que o sensor físico instalado corresponde ao sensor selecionado."
        │
        ▼
resposta de POST /api/iot/telemetry: { "hardware": { "distance_sensor": "VL53L0X", "revision": 2 } }
        │
        ▼
ESP32: guarda na NVS → escolhe o driver → confere a identificação do sensor → inicia → lê
        │
        ▼
próxima telemetria: sensor_model + hardware_revision + sensor_state → plataforma compara configurado × reportado
```

- Se o firmware informar um driver diferente do sensor configurado, a plataforma mostra **⚠️ INCOMPATIBILIDADE DE HARDWARE**, não calcula volume e recusa calibração e validação.
- Se o dispositivo no endereço 0x29 não se identificar como o sensor configurado, o firmware não o inicia: estado `not_found`, com a identificação lida no diagnóstico.
- Sem configuração guardada (primeira ligação), o firmware não lê o sensor: envia `sensor_state = not_configured`, recebe a configuração na resposta e passa a ler no ciclo seguinte.

**Trocar o sensor (VL53L0X ↔ VL53L1X), sem mudar código nem regravar o firmware:**

1. Com o USB desligado, troque o módulo na tampa. O cabo e os pinos são os mesmos.
2. Em **Ligações**, escolha o novo sensor e confirme. Isso:
   - cria a próxima **revisão de hardware**, registrada no histórico (imutável);
   - substitui a calibração ativa e cancela a calibração em andamento;
   - inicia um ensaio de bancada (missões bloqueadas). Nenhuma válvula é acionada.
3. Religue o USB: o firmware recebe o novo sensor na primeira resposta, troca o driver e guarda na memória.
4. Confira em Ligações o estado **Compatível**, teste na **Bancada** e faça a **nova calibração**.

## 4. Calibração

Não assumir que **DN100 = 100 mm internos**. A calibração é **experimental e específica de cada captador** e é feita no app:
**Administração → Captadores → {código} → Calibração de volume**.

- Cinco etapas: 0 L (centro da saída da válvula), 1 L, 2 L, 3 L e nível máximo (saída do dreno).
- O servidor usa apenas leituras **estáveis** do sensor.
- Resultado: constante `k` (L/mm), diâmetro efetivo, altura útil e capacidade efetiva, com validação de qualidade e versões.
- O firmware **não guarda calibração**: envia a distância e o servidor calcula o volume.

- A calibração fica vinculada ao **sensor e à revisão de hardware** com que foi feita. Trocar o sensor exige nova calibração (§3.1).

Procedimento físico, modelo matemático, limites e riscos (inclusive o cone do sensor dentro do tubo): [CALIBRACAO.md](./CALIBRACAO.md).

## 5. Rede

- Wi-Fi com **portal de login** ou **WPA2-Enterprise** impede ou complica a conexão do ESP32. Confirme com a escola.
- **Plano B:** roteador ou hotspot dedicado ao captador.

## 6. Firmware

### Etapa 1 (pronta para validação na bancada)

`firmware/` — PlatformIO, ESP32 DevKit V1 (ESP32 clássico, `board = esp32dev`), framework Arduino. Versão `esp32-0.4.0`.

**Camada de sensores (os dois sensores, sem duplicar a lógica):**

```text
firmware/
├── lib/distance_core/          núcleo sem Arduino (testado no computador)
│   ├── distance_sensor.h       interface DistanceSensor: presença, início, parada, amostra, alcance e diagnóstico
│   ├── distance_reader.*       N amostras → descarta inválidas, timeouts e fora da faixa → mediana
│   ├── sensor_manager.*        escolhe o driver do sensor configurado e cuida do estado
│   └── sensor_model.*          "VL53L0X" / "VL53L1X"
├── src/vl53l0x_driver.*        DistanceSensor com a biblioteca Pololu VL53L0X
├── src/vl53l1x_driver.*        DistanceSensor com a biblioteca Pololu VL53L1X
├── src/i2c_probe.*             leitura da identificação do sensor, antes de configurá-lo
├── src/sensor_config_store.*   configuração recebida da plataforma, guardada na NVS
└── src/main.cpp                Wi-Fi e telemetria; só conhece a interface DistanceSensor
```

- **Sensor:** o configurado na plataforma, recebido na resposta de cada telemetria (`hardware.distance_sensor`) e guardado na NVS para os próximos reinícios (§3.1).
- **Presença:** antes de configurar, o driver confere se há resposta no endereço I²C **0x29** e se a identificação lida do registrador é a do sensor configurado (VL53L0X: registrador 0xC0 = **0xEE**; VL53L1X: registrador 0x010F = **0xEACC**). Os identificadores não são endereços I²C.
- **Estados do sensor:** `ready`, `not_found`, `timeout`, `error` (falhou ao iniciar) e `not_configured`.
- **Leitura:** 9 amostras de 50 ms; aceita a faixa do tubo (40 a 3000 mm) limitada ao alcance documentado do sensor (VL53L0X: 2000 mm); mediana só com a maioria válida. Nada é inventado: sem maioria válida, a distância vai nula.
- **Timeout:** se nenhuma amostra responde, o estado vira `timeout`; no ciclo seguinte o firmware confere a presença e reinicia o sensor.
- **I²C:** SDA = GPIO21, SCL = GPIO22, **100 kHz** para os dois sensores. Não aumentar para 400 kHz sem validação física.
- **Telemetria:** distância (`distance_mm`), driver em uso (`sensor_model`), revisão aplicada (`hardware_revision`) e diagnóstico (`sensor_state`, `model_id`, `i2c_ack`, `i2c_clock_hz`, amostras válidas, faixa, sinal e luz ambiente quando o sensor informa, contagem de status, tempo de leitura, modo, ROI e RSSI). O volume é calculado no servidor pela calibração ativa.
- Reaproveita a conexão HTTPS, conta o intervalo pedido pelo servidor a partir do início do ciclo e segue o `next_poll_ms`, no **mesmo contrato do dispositivo virtual**.
- Status enviado: `MAINTENANCE` (leitura válida, sem válvula) ou `ERROR` (sem leitura). Sem calibração na plataforma, o app mostra `CALIBRATING`. As missões ficam indisponíveis nesse captador.
- **Sem válvula:** comandos recebidos são ignorados e expiram no servidor (`FAILED/DEVICE_OFFLINE`), sem liberar água. Trocar o sensor só troca o driver de medição.

**Mensagens do monitor serial:**

| Mensagem | Significado |
|---|---|
| `[config] sensor da plataforma: VL53L1X (revisão 2, da memória)` | Configuração guardada na NVS, usada ao ligar |
| `[config] sensor da plataforma: VL53L0X (revisão 3) — trocando o driver` | A plataforma mudou o sensor |
| `[sensor] VL53L1X pronto (id 0xEACC)` | Sensor identificado e iniciado |
| `[sensor] aguardando a configuração da plataforma` | Primeira ligação: ainda sem sensor configurado |
| `[sensor] VL53L0X NÃO encontrado: nenhum dispositivo respondeu…` | Ligação, alimentação ou XSHUT (§8.3) |
| `[sensor] o dispositivo no endereço 0x29 NÃO se identificou como…` | O sensor instalado não é o configurado |
| `[sensor] VL53L1X parou de responder (timeout)…` | Cabo ou alimentação; nova tentativa a cada ciclo |
| `[leitura] VL53L1X …` | Uma linha por leitura: status, distância, amostras, faixa, sinal, tempo e HTTP |

**Verificado em 17/09/2026:**
- `pio run -e esp32dev` compila (RAM 14,5%, flash 73,5%) com as bibliotecas Pololu VL53L0X 1.3.1 e VL53L1X 1.3.1;
- `pio test -e windows_test`: 13 testes do núcleo no computador (driver correto, sensor ausente, outro modelo no barramento, falha ao iniciar, timeout e recuperação, leitura válida e inválida, alcance do VL53L0X, troca de sensor);
- **ainda não gravado nem testado em uma placa real.**

**Passos:**

1. Registrar o ESP32 no captador físico **EC-001** (o `npm run db:seed` cria o **SIM-001** da simulação):
   ```bash
   npm run admin -- register-device --collector EC-001 --name "EcoCaptador" --location "Horta" --capacity 11.8 --reserve 0.5 --diameter 100 --height 1500 --key ESP32-001
   ```
   O token aparece **uma vez**. Se o EC-001 já tinha sido usado pela simulação, o estado, o balanço e a calibração simulados deixam de valer para ele (o histórico fica guardado). Um captador novo pode ser criado com `--sensor VL53L0X` (padrão: VL53L1X); em um captador existente, o sensor só muda em **Ligações**.
2. Copiar `firmware/include/secrets.example.h` para `secrets.h` e preencher Wi-Fi, URL, `DEVICE_ID`, `COLLECTOR_CODE` e o token.
3. Em **Ligações**, conferir o sensor configurado e seguir o manual de ligações daquele sensor (§8.3). A pinagem está em `config.h` (DevKit V1: SDA=GPIO21, SCL=GPIO22 — confirmar na placa).
4. Compilar e gravar: `pio run -d firmware -t upload` e acompanhar com `pio device monitor -d firmware`.
   - Se a porta COM não aparecer no Windows, instale o driver do conversor USB-serial da placa (CP210x ou CH340).
   - Se o upload parar em `Connecting...`, segure o botão **BOOT** da placa até a gravação começar.
5. Seguir o **protocolo de validação física** (§8): bancada → calibração → validação.

Testes do núcleo de sensores, sem placa: `pio test -d firmware -e windows_test` (Windows; em Linux ou macOS, troque a plataforma do ambiente por `native`, que exige gcc).

> O caminho do repositório tem acentos (`_programação`). O `platformio.ini` já compila em `C:/pio-build/ecohorta`.

### Próximas etapas (somente após os checklists §2.2–2.4)

- Válvula **fechada ao ligar**, em qualquer erro, em timeout e se o sensor falhar.
- Intertravamento dos relés e tempo máximo de motor ligado.
- Watchdog de hardware e reconexão Wi-Fi.
- `command_id` executados guardados na memória não volátil (NVS).
- Relatório do comando (`command_report`) igual ao do dispositivo virtual.

## 7. Credenciais no firmware

- Wi-Fi, URL da API e token ficam em `firmware/include/secrets.h`, **ignorado pelo Git** (`firmware/.gitignore`). O modelo é `secrets.example.h`.
- O servidor guarda somente o **hash** do token (`sha256(IOT_TOKEN_PEPPER:token)`).
- **TLS:** com `API_ROOT_CA` vazio, o firmware usa TLS **sem verificar o certificado** do servidor. Serve só para a bancada. Antes de instalar na escola, preencha o certificado raiz da URL da API.

## 8. PROTOCOLO DE VALIDAÇÃO FÍSICA DO EC-001

**Objetivo:**
- verificar, com medições documentadas, se o sensor configurado (VL53L0X ou VL53L1X) mede a água dentro do tubo DN100;
- verificar se a calibração converte distância em litros com erro conhecido.

**Sem acionar a válvula.** Tudo o que é registrado no app é dado experimental: nada é apagado nem corrigido.

### 8.1 Montagem

1. Tubo **vertical**: conferir com nível de bolha em duas faces e registrar foto.
2. Marcar por fora do tubo, com fita e caneta:
   - **ZERO:** linha do **centro da saída da válvula esférica** (eixo do furo de saída);
   - **MÁXIMO:** linha da **borda inferior da saída do dreno de segurança**;
   - na **mangueira transparente**, uma régua ou fita métrica com o **0 mm na linha do ZERO**.
3. Anotar as medidas físicas:

   | Medida | Instrumento |
   |---|---|
   | Comprimento total do tubo | Trena |
   | Distância da tampa até o ZERO e até o MÁXIMO | Trena |
   | Posição das luvas e conexões internas | Trena |
   | Diâmetro interno do tubo | Paquímetro |
   | Diâmetro interno do furo de saída da válvula | Paquímetro |

4. Anotar tudo que fica **dentro do tubo** no caminho do sensor: entrada da mangueira do ar-condicionado, parafusos, bordas de luvas, fita veda-rosca.

### 8.2 Posicionamento do sensor

- **Um único sensor**, instalado **dentro da tampa** superior. O ESP32 fica na caixa eletrônica, ligado ao sensor pelo cabo de 4 vias (§8.3).
- **Posição:** **centralizado** no eixo do tubo e **apontado verticalmente para baixo**. Conferir o prumo antes de fixar.
- **Janela do sensor livre:** retire a película protetora de fábrica, se houver. Não cubra a janela com cola, silicone, verniz ou fita.
- **Distância até o nível MÁXIMO:** no mínimo 40 mm (alcance mínimo do sensor); recomenda-se 100 mm ou mais.
- **Sem janela de proteção** no primeiro teste. Uma janela exige calibração de *crosstalk* do sensor e pode criar reflexos.
- **Lente limpa e seca.** O ambiente é úmido: registrar se aparecer condensação na lente.
- **Cone de visão:** ~25° no VL53L0X e ~27° no VL53L1X (ROI 16x16).
  - A 1,5 m, o cone é muito mais largo que os ~97 mm do tubo. O sinal pode refletir nas paredes, nas luvas e na entrada da mangueira **antes** de chegar à água.
  - Esse risco **não é corrigido por software**: ele é medido nos testes §8.5 e §8.6.
  - Só no VL53L1X: o ROI (`SENSOR_ROI_WIDTH/HEIGHT` em `config.h`) é um parâmetro de ensaio. Se for alterado, anote e repita os testes.

### 8.3 Ligação: sensor na tampa → cabo de 4 vias → ESP32 na caixa

Montagem definida para o EC-001: **ESP32 DevKit V1 + um sensor VL53L0X ou VL53L1X (o configurado em Ligações) + cabo de 4 vias com ~50 cm instalado**. A mesma ligação serve para os dois sensores.

No app, **Administração → Captadores → {código} → Ligações** mostra o manual visual desta ligação para o sensor configurado: ilustração do módulo, diagrama, tabela de vias, alimentação, cabo, posição, umidade, janela óptica, teste e calibração.

```text
TAMPA DO CAPTADOR           CABO DE 4 VIAS (~50 cm)          CAIXA ELETRÔNICA
módulo do sensor (um só)                                     ESP32 DevKit V1
  VCC ─────────────────────────── via 1 ──────────────────── alimentação do módulo (3V3 na maioria)
  GND ─────────────────────────── via 2 ──────────────────── GND
  SDA ─────────────────────────── via 3 ──────────────────── GPIO21 (D21)
  SCL ─────────────────────────── via 4 ──────────────────── GPIO22 (D22)
  XSHUT, GPIO1: não vão pelo cabo
```

| Via | Módulo do sensor (tampa) | ESP32 DevKit V1 (caixa) | Cor do fio (anotar) |
|---|---|---|---|
| 1 | VCC (ou VIN) | Alimentação adequada ao módulo: **3V3** na maioria dos casos (ver abaixo) | |
| 2 | GND | GND | |
| 3 | SDA | **GPIO21** (D21) | |
| 4 | SCL | **GPIO22** (D22) | |
| — | XSHUT, GPIO1 | **não vão pelo cabo** nesta versão | — |

**Pinos do ESP32**

- **Confirme a pinagem na sua placa** antes de energizar (há versões de 30 e 38 pinos; o rótulo pode ser D21/D22, G21/G22 ou IO21/IO22).
- GPIO21 e GPIO22 são o I²C padrão do Arduino no ESP32 clássico e **não** são pinos de *strapping* nem do flash: o sensor ligado não interfere na inicialização.
- Não use GPIO6–11 (flash interno) e evite GPIO0, 2, 5, 12 e 15 (*strapping*; o GPIO2 também aciona o LED azul da placa).

**Alimentação do módulo — NÃO assumir 5 V**

Os chips VL53L1X e VL53L0X funcionam com cerca de 2,6 a 3,5 V. Aceitar 5 V depende do **módulo** (a plaquinha), não do sensor. E os GPIOs do ESP32 **não toleram 5 V**.

| Módulo (confira na placa e na página do vendedor) | Ligar a via 1 (VCC) em |
|---|---|
| Com regulador e entrada que inclui 3,3 V | **3V3** do DevKit (preferencial) |
| Sem regulador (chip alimentado direto) | **Somente 3V3.** 5 V queima o sensor |
| Que exige 5 V (pouco comum) | VIN/5V do DevKit **apenas** se SDA e SCL medirem no máximo 3,3 V (teste abaixo); senão, use conversor de nível |

Teste antes de ligar SDA e SCL ao ESP32:

1. Ligue só VCC e GND do módulo, na tensão escolhida.
2. Meça com multímetro SDA–GND e SCL–GND: deve dar **no máximo 3,3 V** (tipicamente 2,8 V ou 3,3 V).
3. Se der perto de 5 V, os resistores de pull-up do módulo estão no 5 V: **não ligue** em GPIO21/22.
4. Anote o modelo do módulo, a tensão de alimentação escolhida e as tensões medidas.

Os módulos já trazem resistores de pull-up em SDA e SCL. Não acrescente outros, a não ser que o diagnóstico mostre falhas; se acrescentar, ligue-os ao 3V3.

**Cabo de 4 vias (~50 cm)**

- Anote o **comprimento instalado** e as **cores** na tabela acima, com as mesmas cores nas duas pontas.
- Se puder escolher a ordem das vias: em **cabo plano**, SDA – GND – VCC – SCL (a alimentação fica entre SDA e SCL e reduz a interferência entre elas); em **cabo com pares trançados**, SDA com GND e SCL com VCC.
- **I²C a 100 kHz** (padrão do firmware, igual para os dois sensores). Não aumente para 400 kHz sem validação física; se mudar `I2C_CLOCK_HZ` em `config.h`, registre numa observação de bancada.
- **Umidade:**
  - emendas soldadas e isoladas com termorretrátil;
  - passagem do cabo pela tampa vedada (prensa-cabo ou silicone);
  - **laço de gotejamento** antes da caixa, para a água que condensar no cabo não escorrer para dentro dela;
  - cabo preso perto do módulo, para não puxar o sensor.
- Mantenha o cabo afastado dos fios da válvula e da fonte de 12 V quando eles forem instalados.
- Desligue o USB antes de mexer na ligação.

**Um único sensor: XSHUT e GPIO1**

- Com um só sensor no barramento, o endereço I²C padrão (0x29) basta. **XSHUT** (desligar ou trocar o endereço) e **GPIO1** (interrupção) não são usados pelo firmware e **não vão pelo cabo**.
- O sensor só funciona com XSHUT em nível alto. A maioria dos módulos já tem um resistor de pull-up no XSHUT. Se o seu não tiver (o sensor não é encontrado mesmo com a ligação correta), ligue XSHUT ao VCC do módulo por um resistor de 10 kΩ, **na própria tampa** e **somente com VCC de 3,3 V**, sem acrescentar uma quinta via.

**Modelo do sensor: VL53L0X ou VL53L1X**

- A ligação é a mesma para os dois: 4 vias, mesmos pinos, endereço 0x29.
- O modelo é escolhido na plataforma (Ligações) e o firmware usa o driver correspondente (§3.1).
- **EC-001: módulo CJMCU-531 = VL53L1X.** Configure VL53L1X. O VL53L0X é para outro módulo compatível.
- Confirme o modelo pela marcação da placa ou pelo anúncio do vendedor antes de configurar. A plataforma exige confirmar que o sensor físico instalado corresponde ao selecionado.
- VL53L0X: o alcance pode não cobrir o tubo vazio do EC-001 (§3.1).

**Se o sensor não for encontrado**

1. Tensão entre VCC e GND **na ponta do módulo**, conforme a alimentação escolhida.
2. SDA e SCL invertidos (erro mais comum) ou mal soldados.
3. GND do módulo ligado ao GND do ESP32.
4. Mensagem "NÃO se identificou como…": o sensor instalado não é o configurado. Instale o configurado ou troque o sensor em Ligações (com confirmação).
5. XSHUT sem pull-up (ver acima).
6. Se o sensor aparece e some (`timeout`), confira o cabo, as emendas e a alimentação; o I²C já está em 100 kHz.

Corrija a ligação com o USB desligado e religue: o firmware inicia o sensor ao ligar e, se falhar, tenta de novo a cada ciclo.

- **Válvula e relés não são ligados** nesta fase.

### 8.4 Alimentação

- **Bancada:** ESP32 pela porta USB da placa (micro-USB ou USB-C, conforme a versão), com carregador de celular de 1 A ou mais, ou pelo computador (monitor serial).
- **Instalação:** fonte 5 V estável. Se houver fonte de 12 V para a válvula futura, use um regulador 12→5 V com **terra comum**. A válvula continua desligada.
- **Sensor:** alimentado pelo DevKit, pela via 1 do cabo, conforme o módulo (§8.3). Nunca ligue o sensor direto na fonte de 5 V ou de 12 V.
- **Caixa eletrônica:** fechada e **longe de respingos**. Nada de tensão de rede exposta.

### 8.5 Teste sem água

1. Gravar o firmware (§6) e abrir o monitor serial. Devem aparecer `[config] sensor da plataforma: …`, `[sensor] {modelo} pronto (id …)` e linhas `[leitura]`. Em **Ligações**, o estado deve ser **Compatível**. Se o sensor não for encontrado, seguir a verificação da ligação (§8.3).
2. No app, com conta de professor, abrir **Perfil → Administração → Captadores → EC-001 → Bancada**. Conferir o selo **REAL**.
3. Tocar em **Iniciar ensaio de bancada**. As leituras passam a ser gravadas a cada 1 s.
4. Com o **tubo vazio e seco**, aguardar 60 s e registrar em "Observar o sensor" a condição **Tubo sem água**. Registrar mesmo se a leitura estiver **INSTÁVEL** ou **INVÁLIDA**.
5. Repetir com a tampa bem fechada e com luz ambiente diferente (dia e noite).
6. **Teste de alvo (recomendado):**
   - descer, preso a um barbante, um disco fosco com o diâmetro interno do tubo menos ~10 mm;
   - posicionar em alturas conhecidas (ex.: 500, 1000 e 1500 mm abaixo do sensor) e registrar uma observação em cada, com a altura na nota;
   - isso separa "o sensor não enxerga a água" de "o sensor reflete nas paredes".

### 8.6 Teste com água

1. **Desviar a mangueira do ar-condicionado** para um balde.
2. Encher até alguns níveis de referência: logo acima do ZERO, meio da altura útil, na altura de cada luva e perto do MÁXIMO.
3. Em cada nível:
   - aguardar a superfície parar;
   - ler a altura na **mangueira transparente**, com o olho na altura da marca para evitar paralaxe;
   - registrar a observação na condição **Com água**, informando a **altura na mangueira**.

   Quando já houver calibração, a tela mostra a diferença sensor − mangueira.
4. **O que observar e registrar:**

   | Dado | Onde aparece |
   |---|---|
   | Estado (ESTÁVEL, INSTÁVEL ou INVÁLIDO) | Leitura atual |
   | Variação (desvio-padrão) e deriva | Diagnóstico da leitura |
   | Leituras inválidas e outliers | Diagnóstico da leitura |
   | Amostras válidas (x de 9) e dispersão entre amostras (máx. − mín.) | Diagnóstico da leitura |
   | Sinal e luz ambiente (MCPS) | Diagnóstico da leitura |
   | Tempo médio entre leituras | Diagnóstico da leitura |
   | Picos (reflexos) e degraus (conexões) | Gráfico de distância |

5. Opcional: repetir com um **alvo flutuante** fosco, na condição **Com alvo flutuante**.

### 8.7 Calibração

Seguir [CALIBRACAO.md](./CALIBRACAO.md) §3 no EC-001: 0 L, 1 L, 2 L, 3 L e nível máximo.

- **Distâncias:** capturadas **pelo servidor** a partir da leitura estável. Ninguém digita distância.
- **Ensaio de bancada:** iniciar a calibração também inicia o ensaio de bancada, que:
  - pausa o balanço hídrico (a água colocada à mão não conta como condensado);
  - bloqueia as missões;
  - encerra sozinho 15 min depois que as telas de bancada e calibração forem fechadas.
- **Medição da água de cada etapa:**
  - por **massa** na balança: 1,000 kg de água ≈ 1,00 L (a 20–25 °C a diferença é de ~0,2–0,3%);
  - ou com recipiente graduado conferido na balança.

### 8.8 Validação

Com a calibração ativa, **sem tirar a água da etapa 3 L**, continuar enchendo e validar na tela de **Bancada**:

| Ponto | Como | Uso |
|---|---|---|
| 0 L | Voltar ao ZERO retirando água por cima, sem usar a válvula | Verifica o zero; erro percentual não se aplica |
| 5 L | Total de 5,00 L medidos por massa | **Validação independente** (não é ponto da calibração) |
| 8 L | Total de 8,00 L | **Validação independente** |
| Perto do máximo | Total conhecido, alguns centímetros abaixo do dreno | Verifica a extrapolação da capacidade |

**Em cada ponto:**
1. aguardar **ESTÁVEL**;
2. informar o **volume conhecido** e, se usou balança, a massa;
3. tocar em **Registrar validação**.

**O que o sistema grava:**
- distância e volume calculado;
- erro (calculado − conhecido), erro absoluto e erro percentual;
- versão da calibração e sensor.

A validação **nunca altera a calibração**.

Repetir o ciclo completo (encher e validar) pelo menos **duas vezes**, para separar erro aleatório de erro sistemático.

### 8.9 Análise de erro

**Fórmulas:**
- erro absoluto: `|Vcalculado − Vreal|`;
- erro percentual: `|(Vcalculado − Vreal) ÷ Vreal| × 100` (não se aplica quando Vreal = 0).

**Estatística na tela:**
- erro médio com sinal (viés);
- erro absoluto médio;
- maior erro absoluto;
- erro percentual absoluto médio.

**Não há limite de aprovação definido a priori.** A equipe analisa os resultados depois.

**Exportar CSV** em Bancada → Dados para análise: leituras, observações e validações, com REAL ou SIMULAÇÃO em cada linha.

**O que procurar:**

| Padrão observado | Causa provável |
|---|---|
| Erro que **cresce com o nível** | Seção variável (luvas) ou extrapolação acima de 3 L |
| Erro **constante** | Zero deslocado ou volume das etapas mal medido |
| Erro **aleatório grande** e muitas leituras inválidas | Reflexos no tubo ou superfície agitada |
| Diferença sensor − mangueira **mudando por nível** | Reflexo nas conexões |

Se a análise indicar mudança na definição do ZERO, na posição do sensor ou no ROI, **faça nova calibração**. Ela gera uma nova versão e o histórico fica preservado.

### 8.10 Limitações

- **Cone de visão × tubo estreito:** é o risco principal. Só os testes dirão se o sensor mede a água e não as paredes.
- **Extrapolação:** a calibração usa 0–3 L. A capacidade até o dreno é **capacidade efetiva estimada** até ser validada perto do máximo.
- **ZERO físico:** a água para de escoar na **borda inferior** do furo de saída, não no centro. Ver [CALIBRACAO.md](./CALIBRACAO.md) §2.1.
- **Erro das referências:** balança ±1–5 g; recipiente graduado ±10–20 mL; leitura da mangueira ±2 mm (paralaxe e menisco).
- **Ambiente:** temperatura, umidade, condensação na lente e luz ambiente alteram o sinal do sensor.
- **Cabo I²C de ~50 cm:** comprimento comum para I²C a 100 kHz, mas ainda não testado nesta montagem.
- **Sensor:** o protocolo vale para os dois sensores, mas os resultados de cada ensaio valem só para o sensor usado. O VL53L0X pode não alcançar o tubo vazio (§3.1).
- **Firmware compilado, mas não gravado** em placa: o primeiro teste real acontece na bancada.
- **Válvula não acionada** nesta fase. Esvaziar o captador para testes é feito sem a válvula motorizada.
