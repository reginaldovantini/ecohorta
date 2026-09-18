#pragma once

#include <VL53L0X.h>
#include <Wire.h>

#include "distance_sensor.h"

// Driver do VL53L0X (biblioteca Pololu VL53L0X): perfil de longo alcance.
// A biblioteca não informa status, sinal nem luz ambiente por amostra: o diagnóstico
// mostra amostras aceitas, faixa, dispersão e timeouts.
class VL53L0XDriver : public DistanceSensor {
 public:
  VL53L0XDriver(TwoWire &bus, uint16_t timingBudgetMs);

  SensorModel model() const override { return SensorModel::VL53L0X; }
  ProbeResult probe() override;
  bool begin() override;
  void end() override;
  SensorSample sample() override;
  // Datasheet (ST): até 2 m no perfil de longo alcance, em condições favoráveis.
  uint16_t documentedMaxMm() const override { return 2000; }
  const char *distanceMode() const override { return "long_range"; }
  const char *roi() const override { return ""; }
  uint16_t timingBudgetMs() const override { return budgetMs_; }
  uint8_t idBytes() const override { return 1; }

 private:
  TwoWire &bus_;
  VL53L0X sensor_;
  uint16_t budgetMs_;
};
