#pragma once

#include <Arduino.h>

#define FW_VERSION "esp32-0.5.0"

// ---------- Sensor de distância ----------
// O MODELO (VL53L0X ou VL53L1X) NÃO é definido aqui: vem da plataforma (Administração →
// Captadores → Ligações), na resposta de cada telemetria, e fica guardado na memória não volátil.
// Os dois drivers estão no firmware; a ligação física é a mesma para os dois.

// ---------- Pinagem (CONFIRMAR na placa antes de ligar) ----------
// ESP32 DevKit V1 (ESP32 clássico, ESP32-WROOM-32): I2C padrão do Arduino em GPIO21 (SDA) e GPIO22 (SCL),
// marcados D21/D22 (ou G21/G22, IO21/IO22) na placa. Não são pinos de strapping nem do flash.
// Nunca use GPIO6–11 (flash interno); evite os pinos de strapping GPIO0, 2, 5, 12 e 15.
// Cabo de 4 vias (~50 cm instalado): VCC, GND, SDA, SCL. XSHUT e GPIO1 do módulo não são usados.
static const int PIN_I2C_SDA = 21;
static const int PIN_I2C_SCL = 22;
// 100 kHz, comum aos dois sensores, para o cabo de ~50 cm até a tampa.
// NÃO aumentar para 400 kHz sem validação física (registrar o ensaio em docs/HARDWARE.md).
static const uint32_t I2C_CLOCK_HZ = 100000;

// ---------- Leitura ----------
// Orçamento de tempo por amostra (os dois sensores): maior = menos ruído, leitura mais lenta.
static const uint16_t SENSOR_TIMING_BUDGET_MS = 50;
static const uint8_t SAMPLES_PER_READING = 9;  // mediana de N amostras por telemetria
// Faixa aceita: 40 mm até o fundo do tubo com folga (tubo de ~1,80 m). O firmware também
// descarta o que passar do alcance documentado do sensor em uso (VL53L0X: 2000 mm).
static const uint16_t MIN_VALID_MM = 40;
static const uint16_t MAX_VALID_MM = 3000;
// Somente VL53L1X — região de interesse (ROI): 16x16 = campo de visão completo (~27°). Um ROI menor
// (mínimo 4x4) estreita o cone dentro do tubo. É um PARÂMETRO DE ENSAIO, enviado em cada leitura
// para análise — não uma correção. Só altere registrando o ensaio (docs/HARDWARE.md, protocolo).
static const uint8_t SENSOR_ROI_WIDTH = 16;
static const uint8_t SENSOR_ROI_HEIGHT = 16;

// ---------- Volume ----------
// A calibração experimental é feita no app (Administração → Captadores → Calibração de
// volume). O servidor continua sendo o dono dela, mas a envia na resposta de cada telemetria
// e o firmware a guarda na memória não volátil — porque é a PLACA que decide o instante de
// fechar a válvula. Se esse instante dependesse de uma resposta HTTP, uma queda de Wi-Fi no
// meio da liberação deixaria a água correndo até o tempo máximo.

// ---------- Válvula esférica motorizada (12 V, 3 fios) ----------
// Ligação validada no captador da escola (ver docs/HARDWARE.md §2.2):
//
//   AMARELO  → GND da fonte 12 V (comum)
//   MARROM   → +12 V direto na fonte (alimentação permanente do motor)
//   AZUL     → passa pelo RELE; a outra ponta do contato do relé vai ao +12 V
//
// Relé acionado = contato fechado = AZUL recebe 12 V = a válvula ABRE.
// Relé solto = a válvula FECHA. Ou seja: SEM ENERGIA NO RELÉ, A ÁGUA NÃO SAI — e é por
// isso que o firmware sempre solta o relé primeiro, antes de qualquer outra coisa.
//
// ATENÇÃO à lógica do módulo de relé: a maioria dos módulos chineses aciona em NÍVEL BAIXO
// (IN em 0 V energiza a bobina). O valor abaixo precisa ser conferido NA BANCADA, com a
// válvula desligada da água, antes do primeiro uso com o tubo cheio. O firmware imprime o
// nível escolhido no monitor serial ao ligar.
static const int PIN_VALVE_RELAY = 26;  // GPIO26: não é strapping nem pino de flash
static const bool VALVE_RELAY_ACTIVE_LOW = true;

// Curso do motor da válvula: tempo entre o comando e o fechamento completo. A água continua
// saindo nesse intervalo, e o firmware antecipa o fechamento por causa dele.
static const uint32_t VALVE_CLOSE_MS = 1500;
// Tempo parado depois de fechar, antes da leitura final: a superfície precisa assentar.
static const uint32_t VALVE_SETTLE_MS = 4000;
// Válvula aberta este tempo sem o nível cair: desiste e informa NO_FLOW.
static const uint32_t VALVE_NO_FLOW_MS = 8000;
static const float VALVE_NO_FLOW_MIN_LITERS = 0.05f;
// TETO ABSOLUTO da abertura. Vale mesmo que o servidor peça mais: um comando malformado
// não molha o pátio. Igual ao teto do servidor (MAX_DISPENSE_MS) de propósito — se a placa
// cortasse antes, uma missão legítima de 3 L por gravidade, com torneira de pouca vazão,
// falharia por TIMEOUT tendo entregado quase tudo.
//
// Este NÃO é o guarda principal: água que não desce vira NO_FLOW em 8 s, e sensor mudo
// fecha em 6 s. O teto é o último recurso. O número definitivo sai do protocolo de vazão
// (docs/HARDWARE.md §2.4), medido com o tubo cheio.
static const uint32_t VALVE_HARD_MAX_MS = 240000;
// Sem leitura válida por este tempo durante a liberação: fecha e informa SENSOR_ERROR.
static const uint32_t VALVE_SENSOR_BLIND_MS = 6000;
// Com a válvula aberta, o sensor é lido neste intervalo — muito mais rápido que a telemetria.
// Quem fecha a válvula é esta malha, não o ciclo de rede.
static const uint32_t DISPENSE_TICK_MS = 150;
static const uint8_t DISPENSE_SAMPLES = 3;  // menos amostras por leitura: durante a liberação, rapidez vale mais

// ---------- Comunicação ----------
static const uint32_t DEFAULT_POLL_MS = 3000;
static const uint32_t MIN_POLL_MS = 1000;
static const uint32_t MAX_POLL_MS = 60000;
static const uint32_t HTTP_TIMEOUT_MS = 8000;
