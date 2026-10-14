// EcoHorta Inteligente — firmware do captador: medição, telemetria e liberação por válvula
//
// Faz:
//   1. usa o sensor de distância CONFIGURADO NA PLATAFORMA (VL53L0X ou VL53L1X), recebido na
//      resposta de cada telemetria e guardado na memória não volátil (NVS);
//   2. verifica a presença do sensor (registrador de identificação) e o inicia pelo driver certo;
//   3. a cada ciclo lê N amostras, valida cada uma e calcula a mediana;
//   4. envia a DISTÂNCIA (mm), o sensor em uso, a revisão de hardware e o diagnóstico por HTTPS
//      (POST /api/iot/telemetry), no mesmo contrato do dispositivo virtual;
//   5. reaproveita a conexão HTTPS e obedece ao intervalo (next_poll_ms) definido pelo servidor.
// O volume em litros é calculado no servidor pela calibração do captador. O firmware não guarda calibração.
// NÃO faz: controle de válvula. Comandos de liberação recebidos são ignorados e
// expiram no servidor (FAILED / DEVICE_OFFLINE). Trocar o sensor só troca o driver de medição.

#include <Arduino.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <Wire.h>
#include <esp_timer.h>

#include "ca_bundle.h"
#include "config.h"
#include "dispenser.h"
#include "secrets.h"
#include "sensor_config_store.h"
#include "sensor_manager.h"
#include "valve.h"
#include "vl53l0x_driver.h"
#include "vl53l1x_driver.h"
#include "wifi_portal.h"

// Os dois drivers existem; o gerenciador usa só o do sensor configurado na plataforma.
static VL53L0XDriver vl53l0x(Wire, SENSOR_TIMING_BUDGET_MS);
static VL53L1XDriver vl53l1x(Wire, SENSOR_TIMING_BUDGET_MS, SENSOR_ROI_WIDTH, SENSOR_ROI_HEIGHT);
static DistanceSensor *const DRIVERS[] = {&vl53l0x, &vl53l1x};
static SensorManager sensors(DRIVERS, sizeof(DRIVERS) / sizeof(DRIVERS[0]));
static StoredHardwareConfig hardware;
static Dispenser dispenser;
static uint32_t lastDispenseTickMs = 0;

static WiFiClientSecure client;  // reaproveitado: evita um novo handshake TLS a cada leitura
static uint64_t seq = 0;
static uint32_t nextPollMs = DEFAULT_POLL_MS;
static bool stateLogged = false;
static SensorState loggedState = SensorState::NotConfigured;

static uint64_t uptimeMs() { return esp_timer_get_time() / 1000ULL; }

/*
 * O RELÓGIO, SEM O QUAL O HTTPS NÃO ACONTECE.
 *
 * O ESP32 não tem bateria de relógio: ao ligar, para ele é 1970. E um
 * certificado emitido em 2026 "ainda não é válido" em 1970 — a verificação
 * falha, a telemetria não sai, e o captador fica mudo sem dizer por quê.
 *
 * Então a placa busca a hora por NTP antes do primeiro envio. Três servidores,
 * porque um deles pode estar bloqueado na rede da escola; e sem travar o laço,
 * porque o portal de configuração é servido por esta mesma placa.
 */
static bool relogioPronto = false;
static bool sntpIniciado = false;
static uint32_t proximoAvisoRelogioMs = 0;

/** 1º de janeiro de 2025: qualquer data antes disso é o relógio de fábrica. */
static const time_t HORA_MINIMA = 1735689600;

static bool relogioConferido() {
  if (relogioPronto) return true;
  if (!sntpIniciado) {
    // configTime dispara o SNTP em segundo plano: não espera resposta aqui.
    configTime(0, 0, "pool.ntp.org", "time.google.com", "time.cloudflare.com");
    sntpIniciado = true;
    Serial.println("[relogio] buscando a hora por NTP (necessaria para o HTTPS)");
  }
  if (time(nullptr) >= HORA_MINIMA) {
    relogioPronto = true;
    Serial.println("[relogio] hora obtida; a telemetria pode comecar");
    return true;
  }
  if (millis() >= proximoAvisoRelogioMs) {
    proximoAvisoRelogioMs = millis() + 15000;
    Serial.println("[relogio] ainda sem hora. Se nao passar disto, a rede bloqueia NTP (UDP 123) - avise o professor");
  }
  return false;
}
static uint32_t clockMs() { return millis(); }

// Uma linha no monitor serial a cada mudança de estado do sensor.
static void logSensorState() {
  SensorState state = sensors.state();
  if (stateLogged && state == loggedState) return;
  stateLogged = true;
  loggedState = state;
  const char *name = sensorModelName(sensors.model());
  char id[8];
  sensors.modelIdHex(id, sizeof(id));
  switch (state) {
    case SensorState::Ready:
      Serial.printf("[sensor] %s pronto (id %s)\n", name, id);
      break;
    case SensorState::NotConfigured:
      Serial.println("[sensor] aguardando a configuração da plataforma (sensor de distância)");
      break;
    case SensorState::NotFound:
      if (sensors.lastProbe().ack) {
        Serial.printf("[sensor] o dispositivo no endereço 0x29 NÃO se identificou como %s (id lido %s): confira se o sensor instalado é o configurado\n",
                      name, id[0] ? id : "—");
      } else {
        Serial.printf("[sensor] %s NÃO encontrado: nenhum dispositivo respondeu no endereço 0x29 (verifique VCC, GND, SDA=GPIO%d e SCL=GPIO%d)\n",
                      name, PIN_I2C_SDA, PIN_I2C_SCL);
      }
      break;
    case SensorState::Timeout:
      Serial.printf("[sensor] %s parou de responder (timeout); nova tentativa no próximo ciclo\n", name);
      break;
    case SensorState::Error:
      Serial.printf("[sensor] %s identificado, mas falhou ao iniciar\n", name);
      break;
  }
}

// Configuração vinda da plataforma: troca o driver se o sensor mudou e guarda na NVS.
static void applyHardwareConfig(const char *sensorName, uint32_t revision) {
  SensorModel model = parseSensorModel(sensorName);
  if (model == SensorModel::None) {
    Serial.printf("[config] sensor desconhecido recebido da plataforma: %s (ignorado)\n", sensorName ? sensorName : "—");
    return;
  }
  if (model != hardware.model) {
    Serial.printf("[config] sensor da plataforma: %s (revisão %lu) — trocando o driver\n", sensorName, (unsigned long)revision);
    sensors.select(model);
    logSensorState();
  }
  if (model != hardware.model || revision != hardware.revision) {
    hardware.model = model;
    hardware.revision = revision;
    saveHardwareConfig(hardware);
  }
}

// Calibração vinda da plataforma: é ela que permite à placa fechar a válvula no
// volume certo. Guardada na NVS para sobreviver a uma queda de energia.
static void applyCalibration(JsonVariantConst calibration) {
  if (calibration.isNull()) {
    if (hardware.hasVolume()) {
      Serial.println("[config] calibracao removida na plataforma: a placa nao libera agua ate recalibrar");
      hardware.volume = VolumeModel();
      hardware.calibrationId[0] = 0;
      saveHardwareConfig(hardware);
      dispenser.setModel(hardware.volume);
    }
    return;
  }

  const char *id = calibration["id"] | "";
  VolumeModel model;
  model.zeroDistanceMm = calibration["zero_distance_mm"] | 0.0f;
  model.maximumDistanceMm = calibration["maximum_distance_mm"] | 0.0f;
  model.constantLitersPerMm = calibration["constant_liters_per_mm"] | 0.0f;
  model.capacityLiters = calibration["capacity_liters"] | 0.0f;
  if (!model.valid()) return;
  if (strcmp(id, hardware.calibrationId) == 0) return;

  hardware.volume = model;
  strncpy(hardware.calibrationId, id, sizeof(hardware.calibrationId) - 1);
  hardware.calibrationId[sizeof(hardware.calibrationId) - 1] = 0;
  saveHardwareConfig(hardware);
  dispenser.setModel(model);
  Serial.printf("[config] calibracao %s: zero %.0f mm, k %.5f L/mm, capacidade %.2f L\n", id, model.zeroDistanceMm,
                model.constantLitersPerMm, model.capacityLiters);
}

// Comando da plataforma. Só chega aqui o que a máquina de liberação aceita — e é
// ela, não esta função, que decide abrir.
static void applyCommand(JsonVariantConst command, float distanceMm, bool distanceValid) {
  const char *action = command["action"] | "";
  const char *id = command["command_id"] | "";
  if (strcmp(action, "cancel") == 0) {
    dispenser.cancel(id);
    return;
  }
  if (strcmp(action, "dispense") != 0) return;
  if (dispenser.busy() || dispenser.isCurrent(id)) return;  // já em andamento, ou já respondido

  const float alvo = command["target_liters"] | 0.0f;
  const uint32_t maximo = command["max_duration_ms"] | 0;
  if (alvo <= 0) return;
  Serial.printf("[missao] comando %s: liberar %.2f L (teto %lu ms)\n", id, alvo, (unsigned long)maximo);
  dispenser.start(id, alvo, maximo, distanceMm, distanceValid, uptimeMs());
}

// Malha rápida da liberação: enquanto a válvula está aberta, o sensor é lido a
// cada DISPENSE_TICK_MS. É esta malha que fecha a válvula — nunca o ciclo de
// rede, que pode estar parado esperando uma resposta HTTP.
static void dispenseTick() {
  if (!dispenser.busy()) {
    valve::set(false);
    return;
  }
  if (millis() - lastDispenseTickMs < DISPENSE_TICK_MS) return;
  lastDispenseTickMs = millis();

  const ReadOptions options = {DISPENSE_SAMPLES, MIN_VALID_MM, MAX_VALID_MM};
  Reading r = sensors.read(options, clockMs);
  dispenser.update(r.distanceMm, r.valid(), uptimeMs());
  valve::set(dispenser.valveShouldBeOpen());
}

static void sendTelemetry() {
  const ReadOptions options = {SAMPLES_PER_READING, MIN_VALID_MM, MAX_VALID_MM};
  Reading r = sensors.read(options, clockMs);
  logSensorState();  // um timeout em todas as amostras muda o estado durante a leitura
  bool valid = r.valid();
  /*
   * O status que o aplicativo usa para liberar missão.
   *
   * READY só quando as três condições são verdadeiras ao mesmo tempo: o sensor
   * mede, a placa tem calibração e a válvula não está no meio de outra
   * liberação. Sem calibração o captador MEDE, mas não libera — e dizer READY
   * nessa hora faria a missão de um estudante falhar sem explicação.
   */
  const char *status;
  if (!valid) status = "ERROR";
  else if (dispenser.busy()) status = "DISPENSING";
  else if (!hardware.hasVolume()) status = "MAINTENANCE";
  else status = "READY";
  const char *model = sensorModelName(sensors.model());
  const DistanceSensor *driver = sensors.active();
  char id[8];
  sensors.modelIdHex(id, sizeof(id));

  JsonDocument doc;
  doc["device_id"] = DEVICE_ID;
  doc["collector_code"] = COLLECTOR_CODE;
  doc["seq"] = ++seq;
  doc["uptime_ms"] = uptimeMs();
  if (valid) doc["distance_mm"] = r.distanceMm;
  else doc["distance_mm"] = nullptr;  // sem leitura confiável: o servidor não inventa volume
  if (model) doc["sensor_model"] = model;  // sem configuração ainda: não informa sensor
  if (hardware.revision > 0) doc["hardware_revision"] = hardware.revision;
  else doc["hardware_revision"] = nullptr;
  doc["valve"] = valve::isOpen() ? "open" : "closed";
  doc["status"] = status;
  doc["fw_version"] = FW_VERSION;

  // O relatório da liberação: o que o servidor usa para concluir a missão. Vai
  // em toda telemetria enquanto houver um, inclusive em andamento — assim a tela
  // do estudante acompanha os litros caindo.
  if (dispenser.hasReport()) {
    const DispenseReport &rel = dispenser.report();
    JsonObject report = doc["command_report"].to<JsonObject>();
    report["command_id"] = rel.commandId;
    report["status"] = dispenseStatusName(rel.status);
    report["delivered_liters"] = rel.deliveredLiters;
    report["start_volume_liters"] = rel.startVolumeLiters;
    report["end_volume_liters"] = rel.endVolumeLiters;
    report["start_distance_mm"] = rel.startDistanceMm;
    report["end_distance_mm"] = rel.endDistanceMm;
    const char *falha = dispenseFailureName(rel.failure);
    if (falha) report["failure"] = falha;
    else report["failure"] = nullptr;
    report["started_uptime_ms"] = rel.startedUptimeMs;
    if (rel.terminal()) report["finished_uptime_ms"] = rel.finishedUptimeMs;
    else report["finished_uptime_ms"] = nullptr;
  } else {
    doc["command_report"] = nullptr;
  }

  JsonObject diag = doc["sensor_diagnostics"].to<JsonObject>();
  diag["sensor_state"] = sensorStateName(sensors.state());
  if (id[0]) diag["model_id"] = id;
  else diag["model_id"] = nullptr;
  if (driver) diag["i2c_ack"] = sensors.lastProbe().ack;
  diag["i2c_clock_hz"] = I2C_CLOCK_HZ;
  diag["samples"] = r.samples;
  diag["valid_samples"] = r.validSamples;
  if (r.validSamples > 0) {
    diag["min_mm"] = r.minMm;
    diag["max_mm"] = r.maxMm;
  } else {
    diag["min_mm"] = nullptr;
    diag["max_mm"] = nullptr;
  }
  if (r.signalMcps >= 0) diag["signal_rate_mcps"] = r.signalMcps;
  else diag["signal_rate_mcps"] = nullptr;
  if (r.ambientMcps >= 0) diag["ambient_rate_mcps"] = r.ambientMcps;
  else diag["ambient_rate_mcps"] = nullptr;
  JsonObject counts = diag["status_counts"].to<JsonObject>();
  for (uint8_t i = 0; i < r.statusKinds; i++) counts[r.statuses[i].name] = r.statuses[i].count;
  diag["last_status"] = driver ? r.lastStatus : "SensorNotConfigured";
  diag["read_ms"] = r.readMs;
  if (driver) {
    diag["timing_budget_ms"] = driver->timingBudgetMs();
    diag["distance_mode"] = driver->distanceMode();
    if (driver->roi()[0]) diag["roi"] = driver->roi();
  }
  diag["rssi_dbm"] = WiFi.RSSI();

  String body;
  serializeJson(doc, body);

  HTTPClient http;
  http.setReuse(true);
  http.setTimeout(HTTP_TIMEOUT_MS);
  if (!http.begin(client, String(API_BASE_URL) + "/api/iot/telemetry")) {
    Serial.println("[api] URL inválida");
    return;
  }
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", String("Bearer ") + DEVICE_TOKEN);
  uint32_t httpStarted = millis();
  int code = http.POST(body);
  String response = http.getString();
  http.end();

  // Linha de bancada no monitor serial: dá para acompanhar o sensor sem abrir o app.
  Serial.printf("[leitura] %s | %s | dist %.0f mm | validas %u/%u | faixa %u-%u mm | sinal %.2f | ambiente %.2f | status %s | leitura %lu ms | http %d em %lu ms\n",
                model ? model : "sem sensor", status, r.distanceMm, r.validSamples, r.samples, r.minMm, r.maxMm, r.signalMcps, r.ambientMcps,
                r.lastStatus, (unsigned long)r.readMs, code, (unsigned long)(millis() - httpStarted));
  if (code != 200) {
    nextPollMs = DEFAULT_POLL_MS;
    return;
  }

  JsonDocument reply;
  if (deserializeJson(reply, response) == DeserializationError::Ok) {
    uint32_t poll = reply["next_poll_ms"] | DEFAULT_POLL_MS;
    nextPollMs = constrain(poll, MIN_POLL_MS, MAX_POLL_MS);
    // A plataforma é a fonte da configuração de hardware.
    const char *configured = reply["hardware"]["distance_sensor"];
    uint32_t revision = reply["hardware"]["revision"] | 0;
    if (configured) applyHardwareConfig(configured, revision);
    applyCalibration(reply["hardware"]["calibration"]);

    /*
     * O servidor confirmou o relatório terminal quando parou de mandar o comando.
     * Só então a placa esquece a liberação — se esquecesse antes, um relatório
     * perdido numa falha de rede viraria uma missão eternamente "em andamento".
     */
    if (dispenser.hasReport() && dispenser.report().terminal() && reply["command"].isNull()) {
      Serial.printf("[missao] relatorio de %s confirmado pela plataforma\n", dispenser.report().commandId);
      dispenser.acknowledgeReport();
    }
    if (!reply["command"].isNull()) applyCommand(reply["command"], r.distanceMm, valid);
  }
}

void setup() {
  Serial.begin(115200);
  /*
   * A PRIMEIRA COISA QUE O FIRMWARE FAZ É FECHAR A VÁLVULA.
   *
   * Entre a energia chegar e esta linha rodar, o pino do relé está flutuando — e
   * num módulo acionado por nível baixo um pino flutuante pode energizar a
   * bobina sozinho. Tudo o mais pode esperar um segundo; água saindo sozinha no
   * pátio, não.
   */
  valve::begin();
  delay(1500);
  Serial.printf("\nEcoHorta %s | %s -> %s\n", FW_VERSION, DEVICE_ID, COLLECTOR_CODE);
  Serial.printf("[rede] rede de configuração e resgate: %s\n", SETUP_AP_SSID);
  Serial.printf("[i2c] SDA=GPIO%d SCL=GPIO%d %lu kHz\n", PIN_I2C_SDA, PIN_I2C_SCL, (unsigned long)(I2C_CLOCK_HZ / 1000));
  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
  Wire.setClock(I2C_CLOCK_HZ);
  /*
   * TLS verificado, sempre.
   *
   * Antes, sem uma raiz no secrets.h, a placa aceitava qualquer certificado — e
   * numa rede de escola isso entrega o token do dispositivo a quem estiver
   * escutando. Agora o padrão são as raízes do projeto, e o secrets.h só serve
   * para quem hospeda a plataforma em outro lugar.
   */
  if (strlen(API_ROOT_CA) > 0) {
    client.setCACert(API_ROOT_CA);
    Serial.println("[tls] certificado verificado pela raiz do secrets.h");
  } else {
    client.setCACert(ECOHORTA_CA_BUNDLE);
    Serial.println("[tls] certificado verificado pelas raizes do projeto");
  }

  hardware = loadHardwareConfig();
  if (hardware.model != SensorModel::None) {
    Serial.printf("[config] sensor da plataforma: %s (revisão %lu, da memória)\n", sensorModelName(hardware.model), (unsigned long)hardware.revision);
    sensors.select(hardware.model);
  }

  DispenseConfig liberacao;
  liberacao.valveCloseMs = VALVE_CLOSE_MS;
  liberacao.settleMs = VALVE_SETTLE_MS;
  liberacao.noFlowMs = VALVE_NO_FLOW_MS;
  liberacao.noFlowMinLiters = VALVE_NO_FLOW_MIN_LITERS;
  liberacao.hardMaxMs = VALVE_HARD_MAX_MS;
  liberacao.sensorBlindMs = VALVE_SENSOR_BLIND_MS;
  dispenser.configure(liberacao);
  if (hardware.hasVolume()) {
    dispenser.setModel(hardware.volume);
    Serial.printf("[config] calibracao %s da memoria: k %.5f L/mm, capacidade %.2f L\n", hardware.calibrationId,
                  hardware.volume.constantLitersPerMm, hardware.volume.capacityLiters);
  } else {
    Serial.println("[config] sem calibracao: o captador mede, mas nao libera agua ate ser calibrado");
  }

  logSensorState();
  net::begin();
}

void loop() {
  uint32_t started = millis();
  net::loop();
  sensors.ensureReady();
  logSensorState();
  dispenseTick();
  // Sem hora certa o certificado do servidor é recusado: esperar a hora é mais
  // honesto do que tentar e falhar em silêncio a cada ciclo.
  if (net::online() && relogioConferido()) sendTelemetry();

  /*
   * A espera entre telemetrias, fatiada por dois motivos.
   *
   * O portal de configuração é servido por esta mesma placa, e um delay inteiro
   * deixaria quem está configurando olhando para uma tela travada.
   *
   * E, sobretudo, a malha da liberação roda aqui dentro: é ELA que fecha a
   * válvula, pelo volume que o sensor mede. Se dependesse do ciclo de rede, uma
   * requisição lenta — ou um Wi-Fi que caiu — seria água continuando a sair.
   */
  while (millis() - started < nextPollMs) {
    net::loop();
    dispenseTick();
    delay(10);
  }
}
