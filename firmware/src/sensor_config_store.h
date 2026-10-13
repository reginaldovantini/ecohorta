#pragma once

#include <stdint.h>

#include "sensor_model.h"
#include "volume_model.h"

// Configuração de hardware recebida da plataforma, guardada na memória não volátil (NVS):
// depois de um reinício o firmware já sabe qual driver usar, mesmo antes de ter rede.
struct StoredHardwareConfig {
  SensorModel model = SensorModel::None;
  uint32_t revision = 0;  // 0 = nenhuma configuração recebida ainda
  /*
   * Calibração ativa, guardada junto.
   *
   * Depois de uma queda de energia no meio da manhã, a placa volta sabendo
   * converter distância em litros — e consegue fechar a válvula sozinha na
   * primeira missão, antes mesmo da primeira resposta do servidor chegar.
   */
  VolumeModel volume;
  char calibrationId[40] = {0};
  bool hasVolume() const { return volume.valid(); }
};

StoredHardwareConfig loadHardwareConfig();
void saveHardwareConfig(const StoredHardwareConfig &config);
