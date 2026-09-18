#include "sensor_model.h"

#include <string.h>

SensorModel parseSensorModel(const char *name) {
  if (name == nullptr) return SensorModel::None;
  if (strcmp(name, "VL53L0X") == 0) return SensorModel::VL53L0X;
  if (strcmp(name, "VL53L1X") == 0) return SensorModel::VL53L1X;
  return SensorModel::None;
}

const char *sensorModelName(SensorModel model) {
  switch (model) {
    case SensorModel::VL53L0X:
      return "VL53L0X";
    case SensorModel::VL53L1X:
      return "VL53L1X";
    default:
      return nullptr;
  }
}
