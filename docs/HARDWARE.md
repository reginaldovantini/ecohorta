# Hardware — decisões, riscos e validação física

> Status (13/09/2026): o captador físico já existe. O ESP32-C3 e o VL53L1X estão sendo adquiridos. **A válvula ainda não foi definida.**

## 1. Componentes do primeiro protótipo

| Componente | Função | Status |
|---|---|---|
| ESP32-C3 | Controle, Wi-Fi, telemetria | Em aquisição |
| VL53L1X (ToF) | Distância até a superfície da água | Em aquisição |
| Válvula de saída NC | Liberação controlada por gravidade | **Não definida — ver seção 2** |
| Driver da válvula | MOSFET logic-level + diodo flyback (ou relé) | Depende da válvula |
| Fonte | Alimentação da válvula e do ESP32 | Depende da válvula |

## 2. RISCO CRÍTICO — válvula em sistema por gravidade

### O problema

A maioria das válvulas solenoides baratas de 12 V vendidas para irrigação e filtros é **servo-assistida (piloto)**. Elas precisam de uma **pressão diferencial mínima**, geralmente de 0,02 a 0,05 MPa, o que equivale a **2 a 5 metros de coluna d'água**, para abrir por completo.

O captador trabalha por gravidade, com poucos centímetros de coluna. Com uma dessas válvulas, **a água pode não sair ou sair só um fio**, mesmo com a válvula energizada.

### Requisitos para a escolha

1. **Normalmente fechada (NC).** Sem energia, fica fechada, o que é o estado seguro.
2. **Pressão mínima de operação = 0 MPa.** Procure por "acionamento direto", "direct acting" ou "zero pressure". Uma alternativa é uma **válvula de esfera motorizada** (ex.: CR02/CR05), que abre com qualquer pressão.
3. **Orifício grande o bastante** para ter vazão com baixa coluna. Com gravidade, a vazão cai conforme o nível desce (Torricelli: Q ∝ √h).
4. **Uso compatível com água**, com corpo em latão, inox ou plástico.
5. **Tensão compatível com a fonte** e com o driver. Solenoides esquentam se ficarem energizados por muito tempo, então a duração máxima de abertura deve ser respeitada.

### Como a arquitetura já se protege

- `ValveKind` em `src/lib/iot/types.ts` começa como `"undefined"`. Nada no software assume um modelo específico.
- **Confirmação por medição.** Uma missão só é concluída pelo volume **medido** pelo sensor, nunca pelo tempo de válvula aberta.
- **Detecção de falta de vazão (`NO_FLOW`).** Se a válvula abrir e o nível não cair dentro do tempo limite, o firmware fecha a válvula e a missão falha com esse motivo. É exatamente o sintoma de uma válvula inadequada para baixa pressão.
- **Tempo máximo de abertura (`TIMEOUT`).** A válvula fecha ao atingir `max_duration_ms`, mesmo que o volume alvo não tenha sido alcançado.

### Protocolo de validação da válvula (antes de comprar em quantidade)

1. Encha o captador até o nível **mínimo** de operação, que é o pior caso de pressão.
2. Energize a válvula manualmente.
3. Meça com recipiente graduado e cronômetro o volume liberado em 30 s. Repita 3 vezes.
4. Repita com o captador **cheio**.
5. Registre a vazão (L/min) nos dois níveis. Esses números alimentam o `max_duration_ms` e o modelo do dispositivo virtual.
6. **Critério de aprovação:** abrir e fechar de forma confiável no nível mínimo, sem pingar quando fechada.

## 3. Risco — VL53L1X medindo água

- **Reflexão e transparência.** A luz infravermelha pode atravessar a água ou refletir de forma irregular, e as leituras oscilam.
- **Condensação na lente.** O ambiente é úmido e a condensação altera a medição.
- **Ondulação.** A água caindo do ar-condicionado agita a superfície.

**Mitigações a testar:**
1. **Alvo flutuante:** disco leve e fosco sobre a superfície, com guia.
2. Firmware com várias leituras e **mediana**, rejeitando valores fora da faixa física.
3. Janela de proteção sobre o sensor, com teste de condensação.
4. Leitura final da missão só depois de a superfície estabilizar (estado `MEASURING`).

## 4. Calibração

Não assumir que **DN100 = 100 mm internos**. Medir fisicamente:

1. Com o captador vazio, registre a distância.
2. Adicione água em incrementos conhecidos (ex.: 0,5 L com recipiente graduado).
3. Registre cada par `distance_mm → volume_liters`.
4. A plataforma guarda a tabela (`calibration_points`) e converte por interpolação linear.

## 5. Rede

- Wi-Fi com **portal de login** ou **WPA2-Enterprise** impede ou complica a conexão do ESP32. Confirme com a escola.
- **Plano B:** roteador ou hotspot dedicado ao captador.

## 6. Segurança do firmware (Dias 8–12)

- Válvula **fechada ao ligar**, em qualquer erro, em timeout e se o sensor falhar.
- Watchdog de hardware.
- Reconexão Wi-Fi automática.
- Comandos únicos (`command_id`) guardados na memória não volátil (NVS).
- Limite de volume por comando e duração máxima de abertura.

## 7. Credenciais no firmware

Wi-Fi, URL da API e token do dispositivo ficam em `firmware/include/secrets.h`. Esse arquivo é **ignorado pelo Git**, e o repositório terá um `secrets.example.h` como modelo.

> Atenção: o caminho do projeto contém acentos (`_programação`). Configure `build_dir` no `platformio.ini` apontando para um caminho sem acentos, ex.: `C:/pio-build/ecohorta`.
