#pragma once

#include <Wire.h>

// Leituras diretas no barramento I²C, sem biblioteca de sensor: usadas pelos drivers para
// verificar a presença e a identificação do sensor ANTES de configurá-lo.
namespace i2c {

// Algum dispositivo respondeu (ACK) no endereço?
bool ack(TwoWire &bus, uint8_t address);

// Lê `count` bytes a partir de um registrador de índice de 8 bits (VL53L0X).
bool readReg8(TwoWire &bus, uint8_t address, uint8_t reg, uint8_t *out, uint8_t count);

// Lê `count` bytes a partir de um registrador de índice de 16 bits (VL53L1X).
bool readReg16(TwoWire &bus, uint8_t address, uint16_t reg, uint8_t *out, uint8_t count);

}  // namespace i2c
