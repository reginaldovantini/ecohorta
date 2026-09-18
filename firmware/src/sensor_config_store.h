#pragma once

#include <stdint.h>

#include "sensor_model.h"

// Configuração de hardware recebida da plataforma, guardada na memória não volátil (NVS):
// depois de um reinício o firmware já sabe qual driver usar, mesmo antes de ter rede.
struct StoredHardwareConfig {
  SensorModel model = SensorModel::None;
  uint32_t revision = 0;  // 0 = nenhuma configuração recebida ainda
};

StoredHardwareConfig loadHardwareConfig();
void saveHardwareConfig(const StoredHardwareConfig &config);
