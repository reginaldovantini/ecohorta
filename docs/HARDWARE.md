# Hardware — decisões, riscos e validação física

> Status (15/09/2026):
> - o captador físico em PVC já existe;
> - ESP32-C3 Super Mini, VL53L1X, válvula esférica motorizada de 3 fios e dois relés: **em validação**;
> - o firmware da etapa 1 (medição + telemetria, **sem válvula**) está em `firmware/`.

## 1. Componentes do primeiro protótipo

| Componente | Função | Status |
|---|---|---|
| Captador em PVC (tubo vertical estreito) | Acúmulo do condensado | Existe — falta calibrar (§4) |
| ESP32-C3 Super Mini | Controle, Wi-Fi, telemetria | Em validação — firmware etapa 1 |
| VL53L1X (ToF) | Distância até a superfície da água | Em validação (§3) |
| Válvula esférica motorizada, 3 fios | Liberação por gravidade | **Modelo elétrico a identificar (§2.2)** |
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

- **Nível lógico:** muitos módulos relé de 5 V exigem VCC de 5 V e acionam com nível **baixo** (ativo em LOW). A saída de 3,3 V do ESP32-C3 pode não acionar de forma confiável: verifique o módulo (optoacoplador, jumper JD-VCC) ou use transistor.
- **Contatos:** tensão e corrente nominais acima da corrente de pico do motor medida no §2.2.
- **Intertravamento** (esquema de inversão): os dois relés nunca podem fechar ao mesmo tempo. Garanta isso no firmware **e**, se possível, no hardware (relé reversor/SPDT em cascata).
- **Boot do ESP32-C3:** use GPIOs que não pulsam na inicialização nem são pinos de strapping (evite GPIO2, GPIO8 e GPIO9) e confirme que os relés ficam **desligados** ao ligar e ao reiniciar.
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

## 3. Risco — VL53L1X medindo água

- **Reflexão e transparência:** a luz infravermelha pode atravessar a água ou refletir de forma irregular.
- **Condensação na lente:** ambiente úmido.
- **Ondulação:** a água que cai agita a superfície.

**Mitigações a testar:**
1. **Alvo flutuante:** disco leve e fosco sobre a superfície, com guia.
2. Várias leituras com **mediana**, rejeitando valores fora da faixa física (já no firmware etapa 1).
3. Janela de proteção sobre o sensor, com teste de condensação.
4. Leitura final da missão só depois de a superfície estabilizar (estado `MEASURING`).

## 4. Calibração

Não assumir que **DN100 = 100 mm internos**. Medir fisicamente:

1. Com o captador vazio, registre a distância informada pelo firmware (`distance_mm`).
2. Adicione água em incrementos conhecidos (ex.: 0,5 L com recipiente graduado).
3. Registre cada par `distance_mm → volume_liters`.
4. Preencha `CALIBRATION[]` em `firmware/include/config.h` (distância crescente). Com menos de 2 pontos, o firmware envia só a distância e o status `CALIBRATING`: **nenhum volume inventado** chega à plataforma.

## 5. Rede

- Wi-Fi com **portal de login** ou **WPA2-Enterprise** impede ou complica a conexão do ESP32. Confirme com a escola.
- **Plano B:** roteador ou hotspot dedicado ao captador.

## 6. Firmware

### Etapa 1 (pronta para validação na bancada)

`firmware/` — PlatformIO, ESP32-C3 Super Mini, framework Arduino.

- Lê o VL53L1X (modo longo, mediana de 9 leituras, faixa física).
- Converte distância em volume pela tabela de calibração.
- Envia `POST /api/iot/telemetry` por HTTPS no **mesmo contrato do dispositivo virtual** e segue o `next_poll_ms` do servidor.
- Status enviado: `CALIBRATING` (sem calibração), `MAINTENANCE` (calibrado, sem válvula) ou `ERROR` (sensor). As missões ficam indisponíveis nesse captador.
- **Sem válvula:** comandos recebidos são ignorados e expiram no servidor (`FAILED/DEVICE_OFFLINE`), sem liberar água.

**Passos:**

1. Registrar o dispositivo em um captador próprio de bancada (o EC-001 continua com o dispositivo virtual):
   ```bash
   npm run admin -- register-device --collector EC-002 --name "Captador de bancada" --location "Laboratório" --capacity 12 --reserve 0.5 --key ESP32-001
   ```
   O token aparece **uma vez**.
2. Copiar `firmware/include/secrets.example.h` para `secrets.h` e preencher Wi-Fi, URL, `DEVICE_ID`, `COLLECTOR_CODE` e o token.
3. Conferir a pinagem I2C em `config.h` (padrão SDA=GPIO8, SCL=GPIO9 — confirmar na placa).
4. Compilar e gravar: `pio run -d firmware -t upload` e acompanhar com `pio device monitor -d firmware`.
5. Verificar no app (conta de professor) o captador EC-002 com `distance_mm` real.

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
