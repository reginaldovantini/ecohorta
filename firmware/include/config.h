#pragma once

#include <Arduino.h>

#define FW_VERSION "esp32-0.1.0"

// ---------- Pinagem (CONFIRMAR na placa antes de ligar) ----------
// ESP32-C3 Super Mini: I2C padrão do Arduino em GPIO8 (SDA) e GPIO9 (SCL).
// Atenção: na maioria das Super Mini o GPIO8 também aciona o LED azul e o GPIO9 é o botão BOOT.
static const int PIN_I2C_SDA = 8;
static const int PIN_I2C_SCL = 9;

// ---------- Sensor ----------
static const uint16_t SENSOR_TIMING_BUDGET_MS = 50;
static const uint8_t SAMPLES_PER_READING = 9;   // mediana de N leituras
static const uint16_t MIN_VALID_MM = 30;        // faixa física do captador (ajustar após medir)
static const uint16_t MAX_VALID_MM = 2000;

// ---------- Calibração distância → volume ----------
// SUBSTITUIR pelos pares medidos no captador (docs/HARDWARE.md §4), em ordem de distância CRESCENTE.
// Com menos de 2 pontos, o firmware envia apenas a distância e o status CALIBRATING (volume 0):
// nenhum volume inventado é apresentado como real.
struct CalibrationPoint {
  float distanceMm;
  float volumeLiters;
};
static const CalibrationPoint CALIBRATION[] = {
  // {60.0f, 12.0f},   // exemplo: cheio
  // {1589.0f, 0.0f},  // exemplo: vazio
  {0.0f, 0.0f},
};
static const size_t CALIBRATION_COUNT = 0;  // atualizar para o número de pontos reais

// ---------- Comunicação ----------
static const uint32_t DEFAULT_POLL_MS = 3000;
static const uint32_t MIN_POLL_MS = 1000;
static const uint32_t MAX_POLL_MS = 60000;
static const uint32_t HTTP_TIMEOUT_MS = 8000;
