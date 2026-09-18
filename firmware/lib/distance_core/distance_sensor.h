#pragma once

#include <stdint.h>

#include "sensor_model.h"

// Estado do sensor informado à plataforma (sensor_diagnostics.sensor_state).
enum class SensorState : uint8_t { NotConfigured, Ready, NotFound, Timeout, Error };

// "not_configured", "ready", "not_found", "timeout", "error" — os mesmos nomes da plataforma.
const char *sensorStateName(SensorState state);

// Verificação de presença: o driver lê o registrador de identificação do seu modelo.
struct ProbeResult {
  bool ack = false;       // algum dispositivo respondeu no endereço do sensor
  bool idRead = false;    // o registrador de identificação foi lido
  bool matches = false;   // a identificação confere com o modelo do driver
  uint16_t modelId = 0;   // valor lido (ex.: 0xEE, 0xEACC)
};

// Uma amostra de distância como o driver a entregou, sem correção.
struct SensorSample {
  enum class Kind : uint8_t { Valid, Invalid, Timeout };
  Kind kind = Kind::Invalid;
  uint16_t mm = 0;
  const char *status = "None";  // texto estável (literal) do status da medição
  float signalMcps = -1;        // < 0: não disponível neste sensor
  float ambientMcps = -1;
};

// Interface comum dos drivers de distância. A aplicação principal só conhece esta interface:
// inicialização, presença, leitura, erro/timeout e diagnóstico, sem os detalhes de cada biblioteca.
class DistanceSensor {
 public:
  virtual ~DistanceSensor() {}

  virtual SensorModel model() const = 0;

  // Presença: confere se há um dispositivo no endereço I²C (0x29 para os dois sensores) e se a
  // identificação lida do registrador do sensor é a deste modelo (VL53L0X: 0xEE; VL53L1X: 0xEACC).
  // Não configura o sensor.
  virtual ProbeResult probe() = 0;

  // Configura e inicia a medição contínua. false = o sensor não respondeu à configuração.
  virtual bool begin() = 0;

  // Para a medição (antes de trocar de driver ou de reiniciar o sensor).
  virtual void end() = 0;

  // Uma amostra (bloqueia até o fim da medição ou até o timeout).
  virtual SensorSample sample() = 0;

  // Maior distância documentada pelo fabricante no modo usado (mm). Acima disso, a amostra é descartada.
  virtual uint16_t documentedMaxMm() const = 0;

  // Diagnóstico: modo de distância, ROI ("" se o sensor não tem ROI), orçamento de tempo
  // por amostra e tamanho do registrador de identificação (1 ou 2 bytes).
  virtual const char *distanceMode() const = 0;
  virtual const char *roi() const = 0;
  virtual uint16_t timingBudgetMs() const = 0;
  virtual uint8_t idBytes() const = 0;
};
