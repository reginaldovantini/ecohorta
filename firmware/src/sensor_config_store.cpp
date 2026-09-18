#include "sensor_config_store.h"

#include <Preferences.h>

static const char *NAMESPACE = "ecohorta";
static const char *KEY_SENSOR = "sensor";
static const char *KEY_REVISION = "hw_rev";

StoredHardwareConfig loadHardwareConfig() {
  StoredHardwareConfig config;
  Preferences prefs;
  if (!prefs.begin(NAMESPACE, true)) return config;  // primeira inicialização: nada guardado
  uint8_t model = prefs.getUChar(KEY_SENSOR, 0);
  if (model == (uint8_t)SensorModel::VL53L0X || model == (uint8_t)SensorModel::VL53L1X) {
    config.model = (SensorModel)model;
    config.revision = prefs.getUInt(KEY_REVISION, 0);
  }
  prefs.end();
  return config;
}

void saveHardwareConfig(const StoredHardwareConfig &config) {
  Preferences prefs;
  if (!prefs.begin(NAMESPACE, false)) return;
  prefs.putUChar(KEY_SENSOR, (uint8_t)config.model);
  prefs.putUInt(KEY_REVISION, config.revision);
  prefs.end();
}
