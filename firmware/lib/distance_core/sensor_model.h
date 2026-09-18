#pragma once

#include <stdint.h>

// Sensores de distância suportados pelo firmware. Cada captador usa UM, escolhido na
// plataforma (Administração → Captadores → Ligações) e recebido na resposta da telemetria.
enum class SensorModel : uint8_t { None = 0, VL53L0X = 1, VL53L1X = 2 };

// "VL53L0X" / "VL53L1X" → modelo. Qualquer outro texto (ou nulo) → None.
SensorModel parseSensorModel(const char *name);

// Nome do modelo, como a plataforma usa. nullptr para None.
const char *sensorModelName(SensorModel model);
