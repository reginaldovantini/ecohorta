#include "distance_reader.h"

#include <string.h>

void Reading::count(const char *status) {
  for (uint8_t i = 0; i < statusKinds; i++) {
    if (strcmp(statuses[i].name, status) == 0) {
      statuses[i].count++;
      return;
    }
  }
  if (statusKinds < MAX_STATUS_KINDS) statuses[statusKinds++] = {status, 1};
}

static void sortFloats(float *values, uint8_t count) {
  for (uint8_t i = 1; i < count; i++) {
    float key = values[i];
    int j = i - 1;
    while (j >= 0 && values[j] > key) {
      values[j + 1] = values[j];
      j--;
    }
    values[j + 1] = key;
  }
}

float medianOf(float *values, uint8_t count) {
  if (count == 0) return -1;
  sortFloats(values, count);
  return count % 2 ? values[count / 2] : (values[count / 2 - 1] + values[count / 2]) / 2.0f;
}

Reading readDistance(DistanceSensor &sensor, const ReadOptions &options, uint32_t (*clockMs)()) {
  Reading r;
  const uint32_t started = clockMs();
  const uint8_t wanted = options.samples > MAX_SAMPLES_PER_READING ? MAX_SAMPLES_PER_READING : options.samples;
  const uint16_t documented = sensor.documentedMaxMm();
  const uint16_t maxMm = options.maxMm < documented ? options.maxMm : documented;
  float distances[MAX_SAMPLES_PER_READING];
  float signals[MAX_SAMPLES_PER_READING];
  float ambients[MAX_SAMPLES_PER_READING];
  uint8_t withSignal = 0;
  uint8_t withAmbient = 0;

  for (uint8_t i = 0; i < wanted; i++) {
    SensorSample s = sensor.sample();
    r.samples++;
    if (s.kind == SensorSample::Kind::Timeout) {
      r.timeouts++;
      r.lastStatus = "Timeout";
      r.count("Timeout");
      continue;
    }
    r.lastStatus = s.status;
    if (s.kind != SensorSample::Kind::Valid) {
      r.count(s.status);
      continue;
    }
    if (s.mm < options.minMm || s.mm > maxMm) {
      r.outOfRange++;
      r.count("OutOfConfiguredRange");
      continue;
    }
    r.count(s.status);
    distances[r.validSamples] = s.mm;
    if (s.signalMcps >= 0) signals[withSignal++] = s.signalMcps;
    if (s.ambientMcps >= 0) ambients[withAmbient++] = s.ambientMcps;
    r.minMm = r.validSamples == 0 || s.mm < r.minMm ? s.mm : r.minMm;
    r.maxMm = r.validSamples == 0 || s.mm > r.maxMm ? s.mm : r.maxMm;
    r.validSamples++;
  }

  // Mediana só com a maioria das amostras válida; caso contrário a leitura é inválida.
  if (wanted > 0 && r.validSamples >= (wanted + 1) / 2) {
    r.distanceMm = medianOf(distances, r.validSamples);
    if (withSignal > 0) r.signalMcps = medianOf(signals, withSignal);
    if (withAmbient > 0) r.ambientMcps = medianOf(ambients, withAmbient);
  }
  r.readMs = clockMs() - started;
  return r;
}
