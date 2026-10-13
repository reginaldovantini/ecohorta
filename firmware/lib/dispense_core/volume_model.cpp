#include "volume_model.h"

float volumeFromDistance(const VolumeModel &model, float distanceMm) {
  if (!model.valid()) return 0;
  const float heightMm = model.zeroDistanceMm - distanceMm;
  const float raw = model.constantLitersPerMm * heightMm;
  if (raw < 0) return 0;
  if (raw > model.capacityLiters) return model.capacityLiters;
  return raw;
}
