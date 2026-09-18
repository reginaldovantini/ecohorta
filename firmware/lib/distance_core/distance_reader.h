#pragma once

#include <stdint.h>

#include "distance_sensor.h"

static const uint8_t MAX_SAMPLES_PER_READING = 32;
static const uint8_t MAX_STATUS_KINDS = 8;

struct StatusCount {
  const char *name;
  uint8_t count;
};

// Resultado de um ciclo de leitura: distância (mediana) + diagnóstico, sem nenhuma correção.
struct Reading {
  float distanceMm = -1;  // -1 = sem leitura confiável (nada é inventado)
  uint8_t samples = 0;
  uint8_t validSamples = 0;
  uint8_t timeouts = 0;
  uint8_t outOfRange = 0;  // medida aceita pelo sensor, mas fora da faixa configurada/documentada
  uint16_t minMm = 0;
  uint16_t maxMm = 0;
  float signalMcps = -1;  // mediana entre amostras válidas; < 0 = não disponível
  float ambientMcps = -1;
  StatusCount statuses[MAX_STATUS_KINDS] = {};
  uint8_t statusKinds = 0;
  const char *lastStatus = "None";
  uint32_t readMs = 0;

  bool valid() const { return distanceMm >= 0; }
  void count(const char *status);
};

struct ReadOptions {
  uint8_t samples;
  uint16_t minMm;  // faixa física aceita (tubo)
  uint16_t maxMm;  // também limitada pelo alcance documentado do sensor
};

// Lê N amostras, descarta as inválidas, sem resposta e fora da faixa, e devolve a mediana
// somente se a maioria das amostras for válida.
Reading readDistance(DistanceSensor &sensor, const ReadOptions &options, uint32_t (*clockMs)());

float medianOf(float *values, uint8_t count);
