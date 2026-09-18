#include "vl53l1x_driver.h"

#include <stdio.h>

#include "i2c_probe.h"

// Endereço I²C padrão (7 bits) — o mesmo do VL53L0X. Por isso o endereço não distingue os sensores.
static const uint8_t ADDRESS = 0x29;
// O que distingue é a identificação lida de um REGISTRADOR (não é endereço I²C):
// sensor ID do VL53L1X = 0xEACC, no registrador IDENTIFICATION__MODEL_ID (0x010F, índice de 16 bits).
// O módulo CJMCU-531 do EC-001 usa este sensor.
static const uint16_t MODEL_ID_REGISTER = 0x010F;
static const uint16_t MODEL_ID = 0xEACC;
static const uint16_t IO_TIMEOUT_MS = 500;

VL53L1XDriver::VL53L1XDriver(TwoWire &bus, uint16_t timingBudgetMs, uint8_t roiWidth, uint8_t roiHeight)
    : bus_(bus), budgetMs_(timingBudgetMs), roiWidth_(roiWidth), roiHeight_(roiHeight) {
  snprintf(roi_, sizeof(roi_), "%ux%u", roiWidth, roiHeight);
}

ProbeResult VL53L1XDriver::probe() {
  ProbeResult result;
  result.ack = i2c::ack(bus_, ADDRESS);
  if (!result.ack) return result;
  uint8_t id[2];
  result.idRead = i2c::readReg16(bus_, ADDRESS, MODEL_ID_REGISTER, id, 2);
  if (result.idRead) {
    result.modelId = (uint16_t)((id[0] << 8) | id[1]);
    result.matches = result.modelId == MODEL_ID;
  }
  return result;
}

bool VL53L1XDriver::begin() {
  sensor_.setBus(&bus_);
  sensor_.setTimeout(IO_TIMEOUT_MS);
  if (!sensor_.init()) return false;
  sensor_.setDistanceMode(VL53L1X::Long);
  sensor_.setMeasurementTimingBudget(budgetMs_ * 1000UL);
  sensor_.setROISize(roiWidth_, roiHeight_);
  sensor_.startContinuous(budgetMs_);
  return true;
}

void VL53L1XDriver::end() { sensor_.stopContinuous(); }

SensorSample VL53L1XDriver::sample() {
  SensorSample s;
  uint16_t mm = sensor_.read();
  if (sensor_.timeoutOccurred()) {
    s.kind = SensorSample::Kind::Timeout;
    s.status = "Timeout";
    return s;
  }
  s.mm = mm;
  s.status = VL53L1X::rangeStatusToString(sensor_.ranging_data.range_status);
  s.signalMcps = sensor_.ranging_data.peak_signal_count_rate_MCPS;
  s.ambientMcps = sensor_.ranging_data.ambient_count_rate_MCPS;
  s.kind = sensor_.ranging_data.range_status == VL53L1X::RangeValid ? SensorSample::Kind::Valid : SensorSample::Kind::Invalid;
  return s;
}
