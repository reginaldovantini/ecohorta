#pragma once

#include <stdint.h>

#include "distance_reader.h"

// Escolhe o driver do sensor configurado na plataforma e cuida do seu estado:
// presença, início, leitura, timeout e recuperação. Não duplica lógica entre sensores:
// tudo passa pela interface DistanceSensor.
class SensorManager {
 public:
  SensorManager(DistanceSensor *const *drivers, uint8_t count);

  // Troca para o driver do modelo (para o anterior). false = nenhum driver para o modelo.
  bool select(SensorModel model);

  // Se o sensor ainda não está pronto: verifica a presença e o inicia.
  SensorState ensureReady();

  // Leitura com o driver ativo. Sem sensor pronto, devolve uma leitura inválida (nada é inventado).
  Reading read(const ReadOptions &options, uint32_t (*clockMs)());

  SensorModel model() const;
  SensorState state() const { return state_; }
  const ProbeResult &lastProbe() const { return probe_; }
  const DistanceSensor *active() const { return active_; }

  // Identificação lida, no formato da plataforma ("0xEE", "0xEACC"). Vazio se nada foi lido.
  void modelIdHex(char *out, uint8_t size) const;

 private:
  DistanceSensor *find(SensorModel model) const;

  DistanceSensor *const *drivers_;
  uint8_t count_;
  DistanceSensor *active_ = nullptr;
  SensorState state_ = SensorState::NotConfigured;
  ProbeResult probe_;
};
