#pragma once

#include <stdint.h>

#include "volume_model.h"

/*
 * QUEM DECIDE QUANDO A ÁGUA PARA.
 *
 * A liberação acontece embaixo de um tubo, num pátio de escola, com um estudante
 * segurando um regador. Três coisas não podem depender da internet:
 *
 *   1. FECHAR. A válvula fecha pelo volume MEDIDO pelo sensor — nunca por tempo
 *      de válvula aberta, nunca pelo volume que alguém pediu. Se a rede cair com
 *      a válvula aberta, esta máquina continua rodando e fecha do mesmo jeito.
 *   2. DESISTIR. Água que não desce (válvula travada, torneira fechada, tubo
 *      vazio) vira NO_FLOW em segundos, e não um minuto de motor ligado.
 *   3. O TETO. Existe um tempo máximo absoluto, independente do que o servidor
 *      pediu. Um comando malformado não molha o pátio inteiro.
 *
 * Por isso esta máquina é pura: ela não liga relé, não fala HTTP e não lê
 * sensor. Recebe leituras e o relógio, devolve "a válvula deve estar aberta" e
 * um relatório. Assim ela roda no computador, nos testes, antes de existir
 * qualquer placa — e a regra que molha o chão da escola é barata de provar.
 */

enum class DispenseStatus : uint8_t { Idle = 0, Executing, Measuring, Completed, Failed, Cancelled };

enum class DispenseFailure : uint8_t { None = 0, NoFlow, Timeout, InsufficientWater, SensorError };

const char *dispenseStatusName(DispenseStatus status);
const char *dispenseFailureName(DispenseFailure failure);

struct DispenseConfig {
  /** Quanto a válvula demora a fechar depois do comando. Usado para antecipar. */
  uint32_t valveCloseMs = 1500;
  /** Tempo parado após fechar, antes da leitura final: a água precisa assentar. */
  uint32_t settleMs = 4000;
  /** Válvula aberta este tempo sem sair água: desiste. */
  uint32_t noFlowMs = 8000;
  /** Abaixo disso, "não saiu água". */
  float noFlowMinLiters = 0.05f;
  /** Teto absoluto, independente do que o comando pedir. */
  uint32_t hardMaxMs = 120000;
  /** Sem leitura válida por este tempo durante a liberação: fecha e falha. */
  uint32_t sensorBlindMs = 6000;
};

struct DispenseReport {
  char commandId[40] = {0};
  DispenseStatus status = DispenseStatus::Idle;
  float deliveredLiters = 0;
  float startVolumeLiters = 0;
  float endVolumeLiters = 0;
  float startDistanceMm = 0;
  float endDistanceMm = 0;
  DispenseFailure failure = DispenseFailure::None;
  uint64_t startedUptimeMs = 0;
  uint64_t finishedUptimeMs = 0;
  bool terminal() const {
    return status == DispenseStatus::Completed || status == DispenseStatus::Failed || status == DispenseStatus::Cancelled;
  }
};

class Dispenser {
 public:
  void configure(const DispenseConfig &config) { config_ = config; }
  /** A calibração da plataforma. Sem ela válida, nenhum comando é aceito. */
  void setModel(const VolumeModel &model) { model_ = model; }
  const VolumeModel &model() const { return model_; }

  /**
   * Aceita um comando de liberação.
   *
   * Recusa — com relatório de falha, não em silêncio — quando não há calibração,
   * quando o sensor não está medindo ou quando não há água suficiente no tubo.
   * Recusar aqui é melhor do que abrir e descobrir depois.
   */
  bool start(const char *commandId, float targetLiters, uint32_t maxDurationMs, float distanceMm, bool distanceValid,
             uint64_t uptimeMs);

  /** Pedido de cancelamento. Fecha agora e mede o que saiu até aqui. */
  void cancel(const char *commandId);

  /** Uma leitura nova. Chame sempre, inclusive parado: é o relógio da máquina. */
  void update(float distanceMm, bool distanceValid, uint64_t uptimeMs);

  /** A ÚNICA fonte da verdade sobre o relé. */
  bool valveShouldBeOpen() const { return valveOpen_; }

  bool busy() const { return status_ == DispenseStatus::Executing || status_ == DispenseStatus::Measuring; }
  DispenseStatus status() const { return status_; }

  /** Há relatório a enviar? */
  bool hasReport() const { return hasReport_; }
  const DispenseReport &report() const { return report_; }
  /** O servidor recebeu o relatório terminal: pode esquecer o comando. */
  void acknowledgeReport();

  /** Este comando já é o que está em andamento (ou já terminou e foi relatado)? */
  bool isCurrent(const char *commandId) const;

 private:
  void finish(DispenseStatus status, DispenseFailure failure, uint64_t uptimeMs);
  void closeValve(uint64_t uptimeMs);

  DispenseConfig config_;
  VolumeModel model_;
  DispenseReport report_;
  bool hasReport_ = false;

  DispenseStatus status_ = DispenseStatus::Idle;
  bool valveOpen_ = false;
  bool cancelled_ = false;
  float targetLiters_ = 0;
  uint32_t maxDurationMs_ = 0;
  uint64_t openedAt_ = 0;
  uint64_t closedAt_ = 0;
  uint64_t lastValidAt_ = 0;
  float measuredLiters_ = 0;
  float distanceMm_ = 0;
  bool haveReading_ = false;

  /** Vazão estimada (L/ms), suavizada: serve para antecipar o fechamento. */
  float flowLitersPerMs_ = 0;
  float lastDelivered_ = 0;
  uint64_t lastRateAt_ = 0;
};
