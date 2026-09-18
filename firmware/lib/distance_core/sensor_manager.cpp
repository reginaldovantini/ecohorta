#include "sensor_manager.h"

#include <stdio.h>

const char *sensorStateName(SensorState state) {
  switch (state) {
    case SensorState::Ready:
      return "ready";
    case SensorState::NotFound:
      return "not_found";
    case SensorState::Timeout:
      return "timeout";
    case SensorState::Error:
      return "error";
    default:
      return "not_configured";
  }
}

SensorManager::SensorManager(DistanceSensor *const *drivers, uint8_t count) : drivers_(drivers), count_(count) {}

DistanceSensor *SensorManager::find(SensorModel model) const {
  for (uint8_t i = 0; i < count_; i++) {
    if (drivers_[i]->model() == model) return drivers_[i];
  }
  return nullptr;
}

SensorModel SensorManager::model() const { return active_ ? active_->model() : SensorModel::None; }

bool SensorManager::select(SensorModel model) {
  DistanceSensor *next = model == SensorModel::None ? nullptr : find(model);
  if (next != nullptr && next == active_) return true;  // mesmo driver: nada muda
  if (active_ != nullptr && state_ == SensorState::Ready) active_->end();
  active_ = next;
  probe_ = ProbeResult();
  state_ = SensorState::NotConfigured;
  if (active_ == nullptr) return false;
  ensureReady();
  return true;
}

SensorState SensorManager::ensureReady() {
  if (active_ == nullptr) return state_ = SensorState::NotConfigured;
  if (state_ == SensorState::Ready) return state_;
  // Depois de um timeout o sensor pode ter ficado em medição: para antes de reiniciar.
  if (state_ == SensorState::Timeout) active_->end();
  probe_ = active_->probe();
  if (!probe_.ack || !probe_.matches) return state_ = SensorState::NotFound;
  return state_ = active_->begin() ? SensorState::Ready : SensorState::Error;
}

Reading SensorManager::read(const ReadOptions &options, uint32_t (*clockMs)()) {
  if (active_ == nullptr || state_ != SensorState::Ready) return Reading();
  Reading r = readDistance(*active_, options, clockMs);
  // Nenhuma amostra respondeu: o sensor sumiu do barramento (cabo, alimentação).
  // Nova verificação de presença no próximo ciclo.
  if (r.samples > 0 && r.timeouts == r.samples) state_ = SensorState::Timeout;
  return r;
}

void SensorManager::modelIdHex(char *out, uint8_t size) const {
  if (size == 0) return;
  out[0] = '\0';
  if (active_ == nullptr || !probe_.idRead) return;
  if (active_->idBytes() == 1) snprintf(out, size, "0x%02X", (unsigned)(probe_.modelId & 0xFF));
  else snprintf(out, size, "0x%04X", (unsigned)probe_.modelId);
}
