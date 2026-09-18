#include "i2c_probe.h"

namespace i2c {

bool ack(TwoWire &bus, uint8_t address) {
  bus.beginTransmission(address);
  return bus.endTransmission() == 0;
}

static bool readAfterIndex(TwoWire &bus, uint8_t address, uint8_t *out, uint8_t count) {
  if (bus.requestFrom(address, count) != count) return false;
  for (uint8_t i = 0; i < count; i++) out[i] = (uint8_t)bus.read();
  return true;
}

bool readReg8(TwoWire &bus, uint8_t address, uint8_t reg, uint8_t *out, uint8_t count) {
  bus.beginTransmission(address);
  bus.write(reg);
  if (bus.endTransmission() != 0) return false;
  return readAfterIndex(bus, address, out, count);
}

bool readReg16(TwoWire &bus, uint8_t address, uint16_t reg, uint8_t *out, uint8_t count) {
  bus.beginTransmission(address);
  bus.write((uint8_t)(reg >> 8));
  bus.write((uint8_t)(reg & 0xFF));
  if (bus.endTransmission() != 0) return false;
  return readAfterIndex(bus, address, out, count);
}

}  // namespace i2c
