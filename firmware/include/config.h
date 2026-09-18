#pragma once

#include <Arduino.h>

#define FW_VERSION "esp32-0.4.0"

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
// O firmware NÃO converte distância em volume. A calibração experimental é feita no app
// (Administração → Captadores → Calibração de volume) e o servidor calcula os litros.

// ---------- Comunicação ----------
static const uint32_t DEFAULT_POLL_MS = 3000;
static const uint32_t MIN_POLL_MS = 1000;
static const uint32_t MAX_POLL_MS = 60000;
static const uint32_t HTTP_TIMEOUT_MS = 8000;
