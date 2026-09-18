// EcoHorta Inteligente — firmware do captador EC-001, ETAPA 1 (validação física)
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

#include "config.h"
#include "secrets.h"
#include "sensor_config_store.h"
#include "sensor_manager.h"
#include "vl53l0x_driver.h"
#include "vl53l1x_driver.h"

// Os dois drivers existem; o gerenciador usa só o do sensor configurado na plataforma.
static VL53L0XDriver vl53l0x(Wire, SENSOR_TIMING_BUDGET_MS);
static VL53L1XDriver vl53l1x(Wire, SENSOR_TIMING_BUDGET_MS, SENSOR_ROI_WIDTH, SENSOR_ROI_HEIGHT);
static DistanceSensor *const DRIVERS[] = {&vl53l0x, &vl53l1x};
static SensorManager sensors(DRIVERS, sizeof(DRIVERS) / sizeof(DRIVERS[0]));
static StoredHardwareConfig hardware;

static WiFiClientSecure client;  // reaproveitado: evita um novo handshake TLS a cada leitura
static uint64_t seq = 0;
static uint32_t nextPollMs = DEFAULT_POLL_MS;
static bool stateLogged = false;
static SensorState loggedState = SensorState::NotConfigured;

static uint64_t uptimeMs() { return esp_timer_get_time() / 1000ULL; }
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

static void ensureWifi() {
  if (WiFi.status() == WL_CONNECTED) return;
  Serial.printf("[wifi] conectando a %s...\n", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  uint32_t started = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - started < 15000) delay(250);
  if (WiFi.status() == WL_CONNECTED) Serial.printf("[wifi] conectado, IP %s, RSSI %d\n", WiFi.localIP().toString().c_str(), WiFi.RSSI());
  else Serial.println("[wifi] falhou; nova tentativa no próximo ciclo");
}

static void sendTelemetry() {
  const ReadOptions options = {SAMPLES_PER_READING, MIN_VALID_MM, MAX_VALID_MM};
  Reading r = sensors.read(options, clockMs);
  logSensorState();  // um timeout em todas as amostras muda o estado durante a leitura
  bool valid = r.valid();
  // Etapa 1 nunca informa READY/ONLINE: sem válvula integrada, o app mantém as missões indisponíveis.
  const char *status = valid ? "MAINTENANCE" : "ERROR";
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
  doc["valve"] = "unknown";  // etapa 1: válvula não integrada
  doc["status"] = status;
  doc["fw_version"] = FW_VERSION;
  doc["command_report"] = nullptr;

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
    if (!reply["command"].isNull()) Serial.println("[api] comando recebido e IGNORADO (etapa 1: válvula não integrada)");
  }
}

void setup() {
  Serial.begin(115200);
  delay(1500);
  Serial.printf("\nEcoHorta %s | %s -> %s\n", FW_VERSION, DEVICE_ID, COLLECTOR_CODE);
  Serial.printf("[i2c] SDA=GPIO%d SCL=GPIO%d %lu kHz\n", PIN_I2C_SDA, PIN_I2C_SCL, (unsigned long)(I2C_CLOCK_HZ / 1000));
  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
  Wire.setClock(I2C_CLOCK_HZ);
  if (strlen(API_ROOT_CA) > 0) client.setCACert(API_ROOT_CA);
  else client.setInsecure();  // somente bancada — ver secrets.example.h

  hardware = loadHardwareConfig();
  if (hardware.model != SensorModel::None) {
    Serial.printf("[config] sensor da plataforma: %s (revisão %lu, da memória)\n", sensorModelName(hardware.model), (unsigned long)hardware.revision);
    sensors.select(hardware.model);
  }
  logSensorState();
  ensureWifi();
}

void loop() {
  uint32_t started = millis();
  ensureWifi();
  sensors.ensureReady();
  logSensorState();
  if (WiFi.status() == WL_CONNECTED) sendTelemetry();
  // O intervalo pedido pelo servidor conta a partir do início do ciclo (leitura + HTTPS incluídos).
  uint32_t elapsed = millis() - started;
  if (elapsed < nextPollMs) delay(nextPollMs - elapsed);
}
