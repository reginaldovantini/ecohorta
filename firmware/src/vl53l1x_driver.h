#pragma once

#include <VL53L1X.h>
#include <Wire.h>

#include "distance_sensor.h"

// Driver do VL53L1X (biblioteca Pololu VL53L1X): modo longo, ROI configurável,
// status, sinal e luz ambiente por amostra.
class VL53L1XDriver : public DistanceSensor {
 public:
  VL53L1XDriver(TwoWire &bus, uint16_t timingBudgetMs, uint8_t roiWidth, uint8_t roiHeight);

  SensorModel model() const override { return SensorModel::VL53L1X; }
  ProbeResult probe() override;
  bool begin() override;
  void end() override;
  SensorSample sample() override;
  // Datasheet (ST): até 4 m no modo longo, em condições favoráveis.
  uint16_t documentedMaxMm() const override { return 4000; }
  const char *distanceMode() const override { return "long"; }
  const char *roi() const override { return roi_; }
  uint16_t timingBudgetMs() const override { return budgetMs_; }
  uint8_t idBytes() const override { return 2; }

 private:
  TwoWire &bus_;
  VL53L1X sensor_;
  uint16_t budgetMs_;
  uint8_t roiWidth_;
  uint8_t roiHeight_;
  char roi_[8];
};
