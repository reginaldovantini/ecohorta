// Testes do núcleo de sensores de distância (lib/distance_core), executados no computador:
//   pio test -d firmware -e native
// Drivers falsos simulam presença, identificação, amostras e timeouts dos dois sensores.

#include <string.h>
#include <unity.h>

#include "sensor_manager.h"

class FakeSensor : public DistanceSensor {
 public:
  FakeSensor(SensorModel model, uint16_t modelId, uint8_t idBytes, uint16_t documentedMax)
      : model_(model), modelId_(modelId), idBytes_(idBytes), documentedMax_(documentedMax) {}

  // Cenário físico
  bool present = true;     // algum dispositivo responde no endereço
  bool identifies = true;  // ... e se identifica como este modelo
  bool beginOk = true;
  uint16_t mm[32] = {};
  SensorSample::Kind kind[32] = {};
  uint8_t scripted = 0;  // amostras roteirizadas; depois delas, timeout

  // Contadores
  int probes = 0;
  int begins = 0;
  int ends = 0;
  uint8_t next = 0;

  void script(const uint16_t *values, const SensorSample::Kind *kinds, uint8_t count) {
    for (uint8_t i = 0; i < count; i++) {
      mm[i] = values[i];
      kind[i] = kinds[i];
    }
    scripted = count;
    next = 0;
  }

  SensorModel model() const override { return model_; }
  ProbeResult probe() override {
    probes++;
    ProbeResult r;
    r.ack = present;
    r.idRead = present;
    r.modelId = present ? (identifies ? modelId_ : 0x0042) : 0;
    r.matches = present && identifies;
    return r;
  }
  bool begin() override {
    begins++;
    return beginOk;
  }
  void end() override { ends++; }
  SensorSample sample() override {
    SensorSample s;
    if (next >= scripted) {
      s.kind = SensorSample::Kind::Timeout;
      s.status = "Timeout";
      return s;
    }
    s.kind = kind[next];
    s.mm = mm[next];
    s.status = s.kind == SensorSample::Kind::Valid ? "RangeValid" : "SigmaFail";
    next++;
    return s;
  }
  uint16_t documentedMaxMm() const override { return documentedMax_; }
  const char *distanceMode() const override { return "long"; }
  const char *roi() const override { return ""; }
  uint16_t timingBudgetMs() const override { return 50; }
  uint8_t idBytes() const override { return idBytes_; }

 private:
  SensorModel model_;
  uint16_t modelId_;
  uint8_t idBytes_;
  uint16_t documentedMax_;
};

static const SensorSample::Kind V = SensorSample::Kind::Valid;
static const SensorSample::Kind I = SensorSample::Kind::Invalid;
static const ReadOptions OPTIONS = {9, 40, 3000};

static uint32_t fakeNow = 0;
static uint32_t fakeClock() { return fakeNow += 50; }

static FakeSensor *l0x;
static FakeSensor *l1x;
static SensorManager *manager;

void setUp() {
  l0x = new FakeSensor(SensorModel::VL53L0X, 0xEE, 1, 2000);
  l1x = new FakeSensor(SensorModel::VL53L1X, 0xEACC, 2, 4000);
  static DistanceSensor *drivers[2];
  drivers[0] = l0x;
  drivers[1] = l1x;
  manager = new SensorManager(drivers, 2);
}

void tearDown() {
  delete manager;
  delete l0x;
  delete l1x;
}

void test_parses_platform_sensor_names() {
  TEST_ASSERT_EQUAL(SensorModel::VL53L0X, parseSensorModel("VL53L0X"));
  TEST_ASSERT_EQUAL(SensorModel::VL53L1X, parseSensorModel("VL53L1X"));
  TEST_ASSERT_EQUAL(SensorModel::None, parseSensorModel("vl53l1x"));
  TEST_ASSERT_EQUAL(SensorModel::None, parseSensorModel(""));
  TEST_ASSERT_EQUAL(SensorModel::None, parseSensorModel(nullptr));
  TEST_ASSERT_EQUAL_STRING("VL53L0X", sensorModelName(SensorModel::VL53L0X));
  TEST_ASSERT_EQUAL_STRING("VL53L1X", sensorModelName(SensorModel::VL53L1X));
  TEST_ASSERT_NULL(sensorModelName(SensorModel::None));
}

void test_without_configuration_nothing_is_read() {
  TEST_ASSERT_EQUAL(SensorState::NotConfigured, manager->ensureReady());
  Reading r = manager->read(OPTIONS, fakeClock);
  TEST_ASSERT_FALSE(r.valid());
  TEST_ASSERT_EQUAL_UINT8(0, r.samples);
  TEST_ASSERT_EQUAL_STRING("not_configured", sensorStateName(manager->state()));
  TEST_ASSERT_FALSE(manager->select(SensorModel::None));
}

void test_vl53l0x_configuration_uses_the_vl53l0x_driver() {
  TEST_ASSERT_TRUE(manager->select(SensorModel::VL53L0X));
  TEST_ASSERT_EQUAL(SensorModel::VL53L0X, manager->model());
  TEST_ASSERT_EQUAL(SensorState::Ready, manager->state());
  TEST_ASSERT_EQUAL(1, l0x->probes);
  TEST_ASSERT_EQUAL(1, l0x->begins);
  TEST_ASSERT_EQUAL(0, l1x->probes);  // o outro driver nunca toca o barramento
  char id[8];
  manager->modelIdHex(id, sizeof(id));
  TEST_ASSERT_EQUAL_STRING("0xEE", id);
}

void test_vl53l1x_configuration_uses_the_vl53l1x_driver() {
  TEST_ASSERT_TRUE(manager->select(SensorModel::VL53L1X));
  TEST_ASSERT_EQUAL(SensorModel::VL53L1X, manager->model());
  TEST_ASSERT_EQUAL(SensorState::Ready, manager->state());
  TEST_ASSERT_EQUAL(0, l0x->probes);
  char id[8];
  manager->modelIdHex(id, sizeof(id));
  TEST_ASSERT_EQUAL_STRING("0xEACC", id);
}

void test_missing_sensor_is_not_found_and_gives_no_distance() {
  l1x->present = false;
  manager->select(SensorModel::VL53L1X);
  TEST_ASSERT_EQUAL(SensorState::NotFound, manager->state());
  TEST_ASSERT_FALSE(manager->lastProbe().ack);
  TEST_ASSERT_EQUAL(0, l1x->begins);
  TEST_ASSERT_FALSE(manager->read(OPTIONS, fakeClock).valid());
  TEST_ASSERT_EQUAL_STRING("not_found", sensorStateName(manager->state()));
}

void test_other_model_on_the_bus_is_not_accepted() {
  l0x->identifies = false;  // responde no endereço, mas não com a identificação do VL53L0X
  manager->select(SensorModel::VL53L0X);
  TEST_ASSERT_EQUAL(SensorState::NotFound, manager->state());
  TEST_ASSERT_TRUE(manager->lastProbe().ack);
  TEST_ASSERT_FALSE(manager->lastProbe().matches);
  TEST_ASSERT_EQUAL(0, l0x->begins);
  char id[8];
  manager->modelIdHex(id, sizeof(id));
  TEST_ASSERT_EQUAL_STRING("0x42", id);
}

void test_begin_failure_is_reported_as_error() {
  l1x->beginOk = false;
  manager->select(SensorModel::VL53L1X);
  TEST_ASSERT_EQUAL(SensorState::Error, manager->state());
  TEST_ASSERT_FALSE(manager->read(OPTIONS, fakeClock).valid());
}

void test_valid_reading_is_the_median_of_valid_samples() {
  const uint16_t values[9] = {1000, 1002, 998, 1001, 999, 1000, 1003, 997, 1500};
  const SensorSample::Kind kinds[9] = {V, V, V, V, V, V, V, V, I};
  l1x->script(values, kinds, 9);
  manager->select(SensorModel::VL53L1X);
  Reading r = manager->read(OPTIONS, fakeClock);
  TEST_ASSERT_TRUE(r.valid());
  TEST_ASSERT_EQUAL_FLOAT(1000.0f, r.distanceMm);
  TEST_ASSERT_EQUAL_UINT8(9, r.samples);
  TEST_ASSERT_EQUAL_UINT8(8, r.validSamples);
  TEST_ASSERT_EQUAL_UINT16(997, r.minMm);
  TEST_ASSERT_EQUAL_UINT16(1003, r.maxMm);
  TEST_ASSERT_EQUAL_UINT8(2, r.statusKinds);  // RangeValid 8, SigmaFail 1
  TEST_ASSERT_EQUAL_STRING("RangeValid", r.statuses[0].name);
  TEST_ASSERT_EQUAL_UINT8(8, r.statuses[0].count);
  TEST_ASSERT_TRUE(r.readMs > 0);
}

void test_reading_without_valid_majority_is_invalid() {
  const uint16_t values[9] = {1000, 0, 0, 1001, 0, 999, 0, 0, 1000};
  const SensorSample::Kind kinds[9] = {V, I, I, V, I, V, I, I, V};
  l1x->script(values, kinds, 9);
  manager->select(SensorModel::VL53L1X);
  Reading r = manager->read(OPTIONS, fakeClock);
  TEST_ASSERT_FALSE(r.valid());  // 4 de 9 válidas: nada é inventado
  TEST_ASSERT_EQUAL_UINT8(4, r.validSamples);
  TEST_ASSERT_EQUAL(SensorState::Ready, manager->state());
}

void test_vl53l0x_discards_beyond_its_documented_range() {
  const uint16_t values[9] = {2400, 2410, 2405, 2400, 2395, 2402, 2398, 2401, 2399};
  const SensorSample::Kind kinds[9] = {V, V, V, V, V, V, V, V, V};
  l0x->script(values, kinds, 9);
  manager->select(SensorModel::VL53L0X);
  Reading r = manager->read(OPTIONS, fakeClock);  // faixa do tubo vai a 3000, mas o VL53L0X só a 2000
  TEST_ASSERT_FALSE(r.valid());
  TEST_ASSERT_EQUAL_UINT8(9, r.outOfRange);
  TEST_ASSERT_EQUAL_STRING("OutOfConfiguredRange", r.statuses[0].name);
}

void test_timeout_marks_the_sensor_and_it_recovers_on_the_next_cycle() {
  manager->select(SensorModel::VL53L1X);  // nenhuma amostra roteirizada: todas em timeout
  Reading r = manager->read(OPTIONS, fakeClock);
  TEST_ASSERT_FALSE(r.valid());
  TEST_ASSERT_EQUAL_UINT8(9, r.timeouts);
  TEST_ASSERT_EQUAL_STRING("Timeout", r.lastStatus);
  TEST_ASSERT_EQUAL(SensorState::Timeout, manager->state());

  const uint16_t values[9] = {800, 801, 799, 800, 802, 798, 800, 801, 799};
  const SensorSample::Kind kinds[9] = {V, V, V, V, V, V, V, V, V};
  l1x->script(values, kinds, 9);
  TEST_ASSERT_EQUAL(SensorState::Ready, manager->ensureReady());
  TEST_ASSERT_EQUAL(1, l1x->ends);    // parou a medição antes de reiniciar
  TEST_ASSERT_EQUAL(2, l1x->probes);  // verificou a presença de novo
  TEST_ASSERT_EQUAL_FLOAT(800.0f, manager->read(OPTIONS, fakeClock).distanceMm);
}

void test_switching_sensor_stops_the_previous_driver() {
  manager->select(SensorModel::VL53L1X);
  TEST_ASSERT_EQUAL(SensorState::Ready, manager->state());
  TEST_ASSERT_TRUE(manager->select(SensorModel::VL53L0X));
  TEST_ASSERT_EQUAL(1, l1x->ends);
  TEST_ASSERT_EQUAL(1, l0x->probes);
  TEST_ASSERT_EQUAL(SensorModel::VL53L0X, manager->model());
  TEST_ASSERT_EQUAL(SensorState::Ready, manager->state());
}

void test_selecting_the_same_sensor_changes_nothing() {
  manager->select(SensorModel::VL53L1X);
  TEST_ASSERT_TRUE(manager->select(SensorModel::VL53L1X));
  TEST_ASSERT_EQUAL(1, l1x->probes);
  TEST_ASSERT_EQUAL(0, l1x->ends);
}

int main(int, char **) {
  UNITY_BEGIN();
  RUN_TEST(test_parses_platform_sensor_names);
  RUN_TEST(test_without_configuration_nothing_is_read);
  RUN_TEST(test_vl53l0x_configuration_uses_the_vl53l0x_driver);
  RUN_TEST(test_vl53l1x_configuration_uses_the_vl53l1x_driver);
  RUN_TEST(test_missing_sensor_is_not_found_and_gives_no_distance);
  RUN_TEST(test_other_model_on_the_bus_is_not_accepted);
  RUN_TEST(test_begin_failure_is_reported_as_error);
  RUN_TEST(test_valid_reading_is_the_median_of_valid_samples);
  RUN_TEST(test_reading_without_valid_majority_is_invalid);
  RUN_TEST(test_vl53l0x_discards_beyond_its_documented_range);
  RUN_TEST(test_timeout_marks_the_sensor_and_it_recovers_on_the_next_cycle);
  RUN_TEST(test_switching_sensor_stops_the_previous_driver);
  RUN_TEST(test_selecting_the_same_sensor_changes_nothing);
  return UNITY_END();
}
