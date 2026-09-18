#include "vl53l0x_driver.h"

#include "i2c_probe.h"

// Endereço I²C padrão (7 bits) — o mesmo do VL53L1X. Por isso o endereço não distingue os sensores.
static const uint8_t ADDRESS = 0x29;
// O que distingue é a identificação lida de um REGISTRADOR (não é endereço I²C):
// model ID do VL53L0X = 0xEE, no registrador IDENTIFICATION_MODEL_ID (0xC0, índice de 8 bits).
static const uint8_t MODEL_ID_REGISTER = 0xC0;
static const uint8_t MODEL_ID = 0xEE;
static const uint16_t IO_TIMEOUT_MS = 500;

VL53L0XDriver::VL53L0XDriver(TwoWire &bus, uint16_t timingBudgetMs) : bus_(bus), budgetMs_(timingBudgetMs) {}

ProbeResult VL53L0XDriver::probe() {
  ProbeResult result;
  result.ack = i2c::ack(bus_, ADDRESS);
  if (!result.ack) return result;
  uint8_t id = 0;
  result.idRead = i2c::readReg8(bus_, ADDRESS, MODEL_ID_REGISTER, &id, 1);
  if (result.idRead) {
    result.modelId = id;
    result.matches = id == MODEL_ID;
  }
  return result;
}

bool VL53L0XDriver::begin() {
  sensor_.setBus(&bus_);
  sensor_.setTimeout(IO_TIMEOUT_MS);
  if (!sensor_.init()) return false;
  // Perfil de longo alcance (exemplo de referência da biblioteca): menor limite de sinal
  // e pulsos VCSEL mais longos. O alcance real no tubo é medido na bancada.
  sensor_.setSignalRateLimit(0.1);
  sensor_.setVcselPulsePeriod(VL53L0X::VcselPeriodPreRange, 18);
  sensor_.setVcselPulsePeriod(VL53L0X::VcselPeriodFinalRange, 14);
  sensor_.setMeasurementTimingBudget(budgetMs_ * 1000UL);
  sensor_.startContinuous();
  return true;
}

void VL53L0XDriver::end() { sensor_.stopContinuous(); }

SensorSample VL53L0XDriver::sample() {
  SensorSample s;
  uint16_t mm = sensor_.readRangeContinuousMillimeters();
  if (sensor_.timeoutOccurred()) {
    s.kind = SensorSample::Kind::Timeout;
    s.status = "Timeout";
    return s;
  }
  // Sem status por amostra nesta biblioteca: a validade vem da faixa (tubo e alcance documentado).
  s.kind = SensorSample::Kind::Valid;
  s.status = "Measured";
  s.mm = mm;
  return s;
}
