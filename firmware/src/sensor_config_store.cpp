#include "sensor_config_store.h"

#include <Preferences.h>

static const char *NAMESPACE = "ecohorta";
static const char *KEY_SENSOR = "sensor";
static const char *KEY_REVISION = "hw_rev";
static const char *KEY_CAL_ID = "cal_id";
static const char *KEY_CAL_ZERO = "cal_zero";
static const char *KEY_CAL_MAX = "cal_max";
static const char *KEY_CAL_K = "cal_k";
static const char *KEY_CAL_CAP = "cal_cap";

StoredHardwareConfig loadHardwareConfig() {
  StoredHardwareConfig config;
  Preferences prefs;
  if (!prefs.begin(NAMESPACE, true)) return config;  // primeira inicialização: nada guardado
  uint8_t model = prefs.getUChar(KEY_SENSOR, 0);
  if (model == (uint8_t)SensorModel::VL53L0X || model == (uint8_t)SensorModel::VL53L1X) {
    config.model = (SensorModel)model;
    config.revision = prefs.getUInt(KEY_REVISION, 0);
  }
  prefs.getString(KEY_CAL_ID, config.calibrationId, sizeof(config.calibrationId));
  config.volume.zeroDistanceMm = prefs.getFloat(KEY_CAL_ZERO, 0);
  config.volume.maximumDistanceMm = prefs.getFloat(KEY_CAL_MAX, 0);
  config.volume.constantLitersPerMm = prefs.getFloat(KEY_CAL_K, 0);
  config.volume.capacityLiters = prefs.getFloat(KEY_CAL_CAP, 0);
  prefs.end();
  return config;
}

void saveHardwareConfig(const StoredHardwareConfig &config) {
  Preferences prefs;
  if (!prefs.begin(NAMESPACE, false)) return;
  prefs.putUChar(KEY_SENSOR, (uint8_t)config.model);
  prefs.putUInt(KEY_REVISION, config.revision);
  prefs.putString(KEY_CAL_ID, config.calibrationId);
  prefs.putFloat(KEY_CAL_ZERO, config.volume.zeroDistanceMm);
  prefs.putFloat(KEY_CAL_MAX, config.volume.maximumDistanceMm);
  prefs.putFloat(KEY_CAL_K, config.volume.constantLitersPerMm);
  prefs.putFloat(KEY_CAL_CAP, config.volume.capacityLiters);
  prefs.end();
}
