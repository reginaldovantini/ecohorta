// EcoHorta Inteligente — firmware do captador, ETAPA 1
//
// Faz: lê o VL53L1X (mediana), converte distância em volume pela calibração e envia
// POST /api/iot/telemetry por HTTPS no mesmo contrato do dispositivo virtual.
// NÃO faz: controle de válvula. Comandos de liberação recebidos são ignorados e
// expiram no servidor (FAILED / DEVICE_OFFLINE) — nenhuma água é liberada.

#include <Arduino.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <VL53L1X.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <Wire.h>
#include <esp_timer.h>

#include "config.h"
#include "secrets.h"

static VL53L1X sensor;
static bool sensorReady = false;
static uint64_t seq = 0;
static uint32_t nextPollMs = DEFAULT_POLL_MS;

static uint64_t uptimeMs() { return esp_timer_get_time() / 1000ULL; }

static bool initSensor() {
  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
  Wire.setClock(400000);
  sensor.setTimeout(500);
  if (!sensor.init()) return false;
  sensor.setDistanceMode(VL53L1X::Long);
  sensor.setMeasurementTimingBudget(SENSOR_TIMING_BUDGET_MS * 1000UL);
  sensor.startContinuous(SENSOR_TIMING_BUDGET_MS);
  return true;
}

// Mediana de N leituras válidas dentro da faixa física. Retorna -1 se não houver leituras suficientes.
static float readDistanceMm() {
  uint16_t values[SAMPLES_PER_READING];
  uint8_t count = 0;
  for (uint8_t i = 0; i < SAMPLES_PER_READING; i++) {
    uint16_t mm = sensor.read();
    bool valid = !sensor.timeoutOccurred() && sensor.ranging_data.range_status == VL53L1X::RangeValid;
    if (valid && mm >= MIN_VALID_MM && mm <= MAX_VALID_MM) values[count++] = mm;
  }
  if (count < (SAMPLES_PER_READING + 1) / 2) return -1;
  for (uint8_t i = 1; i < count; i++) {
    uint16_t key = values[i];
    int8_t j = i - 1;
    while (j >= 0 && values[j] > key) {
      values[j + 1] = values[j];
      j--;
    }
    values[j + 1] = key;
  }
  return count % 2 ? values[count / 2] : (values[count / 2 - 1] + values[count / 2]) / 2.0f;
}

// Interpolação linear na tabela de calibração (distância crescente → volume decrescente).
static bool distanceToVolume(float mm, float &liters) {
  if (CALIBRATION_COUNT < 2) return false;
  if (mm <= CALIBRATION[0].distanceMm) {
    liters = CALIBRATION[0].volumeLiters;
    return true;
  }
  for (size_t i = 1; i < CALIBRATION_COUNT; i++) {
    const CalibrationPoint &a = CALIBRATION[i - 1];
    const CalibrationPoint &b = CALIBRATION[i];
    if (mm <= b.distanceMm) {
      liters = a.volumeLiters + (mm - a.distanceMm) * (b.volumeLiters - a.volumeLiters) / (b.distanceMm - a.distanceMm);
      return true;
    }
  }
  liters = CALIBRATION[CALIBRATION_COUNT - 1].volumeLiters;
  return true;
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
  float distance = sensorReady ? readDistanceMm() : -1;
  float volume = 0;
  bool calibrated = distance >= 0 && distanceToVolume(distance, volume);
  // Etapa 1 nunca informa READY/ONLINE: sem válvula instalada, o app mantém as missões indisponíveis.
  const char *status = !sensorReady || distance < 0 ? "ERROR" : calibrated ? "MAINTENANCE" : "CALIBRATING";

  JsonDocument doc;
  doc["device_id"] = DEVICE_ID;
  doc["collector_code"] = COLLECTOR_CODE;
  doc["seq"] = ++seq;
  doc["uptime_ms"] = uptimeMs();
  if (distance >= 0) doc["distance_mm"] = distance;
  else doc["distance_mm"] = nullptr;
  doc["volume_liters"] = volume < 0 ? 0 : volume;
  doc["valve"] = "unknown";  // etapa 1: sem válvula
  doc["status"] = status;
  doc["fw_version"] = FW_VERSION;
  doc["command_report"] = nullptr;

  String body;
  serializeJson(doc, body);

  WiFiClientSecure client;
  if (strlen(API_ROOT_CA) > 0) client.setCACert(API_ROOT_CA);
  else client.setInsecure();  // somente bancada — ver secrets.example.h

  HTTPClient http;
  http.setTimeout(HTTP_TIMEOUT_MS);
  if (!http.begin(client, String(API_BASE_URL) + "/api/iot/telemetry")) {
    Serial.println("[api] URL inválida");
    return;
  }
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", String("Bearer ") + DEVICE_TOKEN);
  int code = http.POST(body);
  String response = http.getString();
  http.end();

  Serial.printf("[api] HTTP %d | %s | distancia %.0f mm | volume %.2f L\n", code, status, distance, volume);
  if (code != 200) {
    nextPollMs = DEFAULT_POLL_MS;
    return;
  }

  JsonDocument reply;
  if (deserializeJson(reply, response) == DeserializationError::Ok) {
    uint32_t poll = reply["next_poll_ms"] | DEFAULT_POLL_MS;
    nextPollMs = constrain(poll, MIN_POLL_MS, MAX_POLL_MS);
    if (!reply["command"].isNull()) Serial.println("[api] comando recebido e IGNORADO (etapa 1 sem válvula)");
  }
}

void setup() {
  Serial.begin(115200);
  delay(1500);
  Serial.printf("\nEcoHorta %s | %s -> %s\n", FW_VERSION, DEVICE_ID, COLLECTOR_CODE);
  sensorReady = initSensor();
  Serial.println(sensorReady ? "[sensor] VL53L1X pronto" : "[sensor] VL53L1X NÃO encontrado (verifique I2C e alimentação)");
  ensureWifi();
}

void loop() {
  ensureWifi();
  if (WiFi.status() == WL_CONNECTED) sendTelemetry();
  if (!sensorReady) sensorReady = initSensor();
  delay(nextPollMs);
}
