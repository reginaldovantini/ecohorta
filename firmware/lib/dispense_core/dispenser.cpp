#include "dispenser.h"

#include <string.h>

namespace {
void copyId(char *destination, size_t size, const char *source) {
  if (!source) {
    destination[0] = 0;
    return;
  }
  strncpy(destination, source, size - 1);
  destination[size - 1] = 0;
}
}  // namespace

const char *dispenseStatusName(DispenseStatus status) {
  switch (status) {
    case DispenseStatus::Executing:
      return "EXECUTING";
    case DispenseStatus::Measuring:
      return "MEASURING";
    case DispenseStatus::Completed:
      return "COMPLETED";
    case DispenseStatus::Failed:
      return "FAILED";
    case DispenseStatus::Cancelled:
      return "CANCELLED";
    default:
      return "IDLE";
  }
}

const char *dispenseFailureName(DispenseFailure failure) {
  switch (failure) {
    case DispenseFailure::NoFlow:
      return "NO_FLOW";
    case DispenseFailure::Timeout:
      return "TIMEOUT";
    case DispenseFailure::InsufficientWater:
      return "INSUFFICIENT_WATER";
    case DispenseFailure::SensorError:
      return "SENSOR_ERROR";
    default:
      return nullptr;
  }
}

bool Dispenser::isCurrent(const char *commandId) const {
  return commandId && report_.commandId[0] && strcmp(report_.commandId, commandId) == 0;
}

void Dispenser::closeValve(uint64_t uptimeMs) {
  if (!valveOpen_) return;
  valveOpen_ = false;
  closedAt_ = uptimeMs;
}

void Dispenser::finish(DispenseStatus status, DispenseFailure failure, uint64_t uptimeMs) {
  closeValve(uptimeMs);
  status_ = status;
  report_.status = status;
  report_.failure = failure;
  report_.deliveredLiters = report_.startVolumeLiters - measuredLiters_;
  if (report_.deliveredLiters < 0) report_.deliveredLiters = 0;
  report_.endVolumeLiters = measuredLiters_;
  report_.endDistanceMm = distanceMm_;
  report_.finishedUptimeMs = uptimeMs;
  hasReport_ = true;
}

bool Dispenser::start(const char *commandId, float targetLiters, uint32_t maxDurationMs, float distanceMm, bool distanceValid,
                      uint64_t uptimeMs) {
  if (busy()) return false;
  // Comando repetido enquanto o relatório ainda não foi confirmado: não reabre.
  if (isCurrent(commandId) && report_.terminal()) return false;

  report_ = DispenseReport();
  copyId(report_.commandId, sizeof(report_.commandId), commandId);
  report_.startedUptimeMs = uptimeMs;
  cancelled_ = false;
  hasReport_ = true;

  // Sem calibração a placa não sabe medir, e medir é a condição para liberar.
  if (!model_.valid()) {
    status_ = DispenseStatus::Failed;
    report_.status = DispenseStatus::Failed;
    report_.failure = DispenseFailure::SensorError;
    report_.finishedUptimeMs = uptimeMs;
    return false;
  }
  if (!distanceValid) {
    status_ = DispenseStatus::Failed;
    report_.status = DispenseStatus::Failed;
    report_.failure = DispenseFailure::SensorError;
    report_.finishedUptimeMs = uptimeMs;
    return false;
  }

  distanceMm_ = distanceMm;
  measuredLiters_ = volumeFromDistance(model_, distanceMm);
  haveReading_ = true;
  report_.startVolumeLiters = measuredLiters_;
  report_.startDistanceMm = distanceMm;
  report_.endVolumeLiters = measuredLiters_;
  report_.endDistanceMm = distanceMm;

  if (targetLiters > measuredLiters_) {
    status_ = DispenseStatus::Failed;
    report_.status = DispenseStatus::Failed;
    report_.failure = DispenseFailure::InsufficientWater;
    report_.finishedUptimeMs = uptimeMs;
    return false;
  }

  targetLiters_ = targetLiters;
  maxDurationMs_ = maxDurationMs > 0 && maxDurationMs < config_.hardMaxMs ? maxDurationMs : config_.hardMaxMs;
  openedAt_ = uptimeMs;
  lastValidAt_ = uptimeMs;
  lastRateAt_ = uptimeMs;
  lastDelivered_ = 0;
  flowLitersPerMs_ = 0;
  status_ = DispenseStatus::Executing;
  report_.status = DispenseStatus::Executing;
  valveOpen_ = true;
  return true;
}

void Dispenser::cancel(const char *commandId) {
  if (!busy()) return;
  if (commandId && report_.commandId[0] && strcmp(report_.commandId, commandId) != 0) return;
  cancelled_ = true;
}

void Dispenser::update(float distanceMm, bool distanceValid, uint64_t uptimeMs) {
  if (distanceValid) {
    distanceMm_ = distanceMm;
    measuredLiters_ = volumeFromDistance(model_, distanceMm);
    haveReading_ = true;
    lastValidAt_ = uptimeMs;
  }

  // O TETO. Vale sempre, inclusive se a máquina estiver num estado inesperado:
  // é a única regra que não pergunta nada a ninguém antes de fechar.
  if (valveOpen_ && uptimeMs - openedAt_ >= config_.hardMaxMs) {
    finish(DispenseStatus::Failed, DispenseFailure::Timeout, uptimeMs);
    return;
  }

  if (status_ == DispenseStatus::Executing) {
    const uint64_t aberta = uptimeMs - openedAt_;
    float entregue = report_.startVolumeLiters - measuredLiters_;
    if (entregue < 0) entregue = 0;

    // Sensor mudo com a válvula aberta: fechar é a única resposta honesta.
    if (uptimeMs - lastValidAt_ >= config_.sensorBlindMs) {
      finish(DispenseStatus::Failed, DispenseFailure::SensorError, uptimeMs);
      return;
    }

    // Vazão suavizada, para antecipar a latência de fechamento. Sem isso a
    // válvula sempre entrega um pouco a mais: ela leva segundos para fechar.
    if (uptimeMs > lastRateAt_) {
      const float dt = static_cast<float>(uptimeMs - lastRateAt_);
      const float taxa = (entregue - lastDelivered_) / dt;
      flowLitersPerMs_ = flowLitersPerMs_ == 0 ? taxa : flowLitersPerMs_ * 0.6f + taxa * 0.4f;
      if (flowLitersPerMs_ < 0) flowLitersPerMs_ = 0;
      lastDelivered_ = entregue;
      lastRateAt_ = uptimeMs;
    }
    const float antecipacao = flowLitersPerMs_ * static_cast<float>(config_.valveCloseMs);

    if (cancelled_ || entregue >= targetLiters_ - antecipacao) {
      closeValve(uptimeMs);
      status_ = DispenseStatus::Measuring;
      report_.status = DispenseStatus::Measuring;
      report_.deliveredLiters = entregue;
      return;
    }
    if (aberta >= config_.noFlowMs && entregue < config_.noFlowMinLiters) {
      finish(DispenseStatus::Failed, DispenseFailure::NoFlow, uptimeMs);
      return;
    }
    if (aberta >= maxDurationMs_) {
      finish(DispenseStatus::Failed, DispenseFailure::Timeout, uptimeMs);
      return;
    }
    report_.deliveredLiters = entregue;
    return;
  }

  if (status_ == DispenseStatus::Measuring) {
    // A leitura final só vale com a água parada: fechada a válvula, a superfície
    // ainda balança, e medir no balanço é medir errado.
    if (uptimeMs - closedAt_ < config_.settleMs) {
      float entregue = report_.startVolumeLiters - measuredLiters_;
      if (entregue < 0) entregue = 0;
      report_.deliveredLiters = entregue;
      return;
    }
    finish(cancelled_ ? DispenseStatus::Cancelled : DispenseStatus::Completed, DispenseFailure::None, uptimeMs);
  }
}

void Dispenser::acknowledgeReport() {
  if (!report_.terminal()) return;
  hasReport_ = false;
  status_ = DispenseStatus::Idle;
}
