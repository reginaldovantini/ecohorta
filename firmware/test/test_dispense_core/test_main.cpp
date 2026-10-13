// Testes do núcleo de liberação (lib/dispense_core), executados no computador:
//   pio test -d firmware -e windows_test
//
// Esta é a regra que molha o chão de uma escola. Ela precisa ser provada sem
// placa, sem água e sem internet — e cada teste aqui corresponde a uma coisa que
// pode dar errado embaixo do tubo, com um estudante esperando.

#include <string.h>
#include <unity.h>

#include "dispenser.h"

// Calibração de um tubo DN100 com 1,5 m úteis: zero a 1600 mm do sensor e
// 0,00785 L por mm de coluna (área de ~78,5 cm²).
static VolumeModel modelo() {
  VolumeModel m;
  m.zeroDistanceMm = 1600;
  m.maximumDistanceMm = 100;
  m.constantLitersPerMm = 0.00785f;
  m.capacityLiters = 11.78f;
  return m;
}

/** Distância do sensor para um volume. Inversa da conta da placa. */
static float distanciaPara(float litros) {
  const VolumeModel m = modelo();
  return m.zeroDistanceMm - litros / m.constantLitersPerMm;
}

static Dispenser novo() {
  Dispenser d;
  DispenseConfig c;
  c.valveCloseMs = 1000;
  c.settleMs = 3000;
  c.noFlowMs = 8000;
  c.noFlowMinLiters = 0.05f;
  c.hardMaxMs = 60000;
  c.sensorBlindMs = 6000;
  d.configure(c);
  d.setModel(modelo());
  return d;
}

/**
 * Avança o tempo deixando a água descer.
 *
 * A válvula esférica motorizada NÃO fecha no instante do comando: o motor leva
 * cerca de um segundo para girar o curso inteiro, e a água continua saindo nesse
 * tempo. O simulador precisa ter esse atraso, porque é exatamente ele que a
 * antecipação do fechamento existe para compensar — sem isso o teste provaria
 * uma física que não é a do pátio.
 */
static uint64_t escoar(Dispenser &d, uint64_t agora, uint32_t ateMs, float &volume, float vazaoLitrosPorSegundo) {
  const uint32_t passo = 200;
  const uint32_t cursoDaValvulaMs = 1000;  // o mesmo valveCloseMs configurado
  bool fechando = false;
  uint64_t comandadaFechadaEm = 0;

  for (uint32_t t = 0; t < ateMs; t += passo) {
    bool saindo;
    if (d.valveShouldBeOpen()) {
      fechando = false;
      saindo = true;
    } else {
      if (!fechando) {
        fechando = true;
        comandadaFechadaEm = agora;
      }
      saindo = agora - comandadaFechadaEm < cursoDaValvulaMs;
    }
    if (saindo) {
      volume -= vazaoLitrosPorSegundo * (passo / 1000.0f);
      if (volume < 0) volume = 0;
    }
    agora += passo;
    d.update(distanciaPara(volume), true, agora);
  }
  return agora;
}

void test_libera_pelo_volume_medido(void) {
  Dispenser d = novo();
  float volume = 8.0f;
  TEST_ASSERT_TRUE(d.start("cmd-1", 2.0f, 60000, distanciaPara(volume), true, 1000));
  TEST_ASSERT_TRUE(d.valveShouldBeOpen());

  uint64_t agora = escoar(d, 1000, 30000, volume, 0.5f);
  TEST_ASSERT_FALSE(d.valveShouldBeOpen());
  TEST_ASSERT_EQUAL(DispenseStatus::Completed, d.status());

  const DispenseReport &r = d.report();
  TEST_ASSERT_EQUAL_STRING("cmd-1", r.commandId);
  // Entregou o pedido, com a folga da antecipação de fechamento.
  TEST_ASSERT_FLOAT_WITHIN(0.25f, 2.0f, r.deliveredLiters);
  TEST_ASSERT_TRUE(r.startVolumeLiters > r.endVolumeLiters);
  TEST_ASSERT_EQUAL(DispenseFailure::None, r.failure);
  TEST_ASSERT_TRUE(agora > 0);
}

void test_nao_entrega_muito_mais_do_que_o_pedido(void) {
  // A válvula leva tempo para fechar. Sem antecipação, a água que sai nesse
  // intervalo é água que o estudante não pediu — e some do tubo da escola.
  Dispenser d = novo();
  float volume = 10.0f;
  d.start("cmd-2", 1.0f, 60000, distanciaPara(volume), true, 0);
  escoar(d, 0, 40000, volume, 1.0f);
  TEST_ASSERT_TRUE(d.report().deliveredLiters < 1.35f);
}

void test_agua_que_nao_desce_vira_no_flow(void) {
  Dispenser d = novo();
  const float parado = distanciaPara(6.0f);
  d.start("cmd-3", 2.0f, 60000, parado, true, 0);
  TEST_ASSERT_TRUE(d.valveShouldBeOpen());

  for (uint64_t t = 200; t <= 9000; t += 200) d.update(parado, true, t);

  TEST_ASSERT_FALSE(d.valveShouldBeOpen());
  TEST_ASSERT_EQUAL(DispenseStatus::Failed, d.status());
  TEST_ASSERT_EQUAL(DispenseFailure::NoFlow, d.report().failure);
}

void test_teto_de_tempo_fecha_mesmo_com_agua_saindo(void) {
  Dispenser d = novo();
  float volume = 11.0f;
  // Pedido grande e vazão lenta: só o tempo máximo encerra.
  d.start("cmd-4", 10.0f, 15000, distanciaPara(volume), true, 0);
  escoar(d, 0, 20000, volume, 0.05f);
  TEST_ASSERT_FALSE(d.valveShouldBeOpen());
  TEST_ASSERT_EQUAL(DispenseFailure::Timeout, d.report().failure);
}

void test_sensor_mudo_fecha_a_valvula(void) {
  Dispenser d = novo();
  d.start("cmd-5", 2.0f, 60000, distanciaPara(5.0f), true, 0);
  for (uint64_t t = 200; t <= 7000; t += 200) d.update(0, false, t);
  TEST_ASSERT_FALSE(d.valveShouldBeOpen());
  TEST_ASSERT_EQUAL(DispenseFailure::SensorError, d.report().failure);
}

void test_sem_calibracao_nao_abre(void) {
  Dispenser d;
  d.configure(DispenseConfig());
  TEST_ASSERT_FALSE(d.start("cmd-6", 1.0f, 60000, 900, true, 0));
  TEST_ASSERT_FALSE(d.valveShouldBeOpen());
  TEST_ASSERT_EQUAL(DispenseStatus::Failed, d.status());
  TEST_ASSERT_EQUAL(DispenseFailure::SensorError, d.report().failure);
}

void test_agua_insuficiente_nao_abre(void) {
  Dispenser d = novo();
  TEST_ASSERT_FALSE(d.start("cmd-7", 5.0f, 60000, distanciaPara(1.0f), true, 0));
  TEST_ASSERT_FALSE(d.valveShouldBeOpen());
  TEST_ASSERT_EQUAL(DispenseFailure::InsufficientWater, d.report().failure);
}

void test_cancelar_fecha_e_mede_o_que_saiu(void) {
  Dispenser d = novo();
  float volume = 9.0f;
  d.start("cmd-8", 3.0f, 60000, distanciaPara(volume), true, 0);
  uint64_t agora = escoar(d, 0, 2000, volume, 0.5f);
  d.cancel("cmd-8");
  escoar(d, agora, 20000, volume, 0.5f);

  TEST_ASSERT_FALSE(d.valveShouldBeOpen());
  TEST_ASSERT_EQUAL(DispenseStatus::Cancelled, d.status());
  TEST_ASSERT_TRUE(d.report().deliveredLiters > 0);
  TEST_ASSERT_TRUE(d.report().deliveredLiters < 3.0f);
}

void test_cancelamento_de_outro_comando_nao_interrompe(void) {
  Dispenser d = novo();
  float volume = 9.0f;
  d.start("cmd-9", 2.0f, 60000, distanciaPara(volume), true, 0);
  d.cancel("outro-comando");
  escoar(d, 0, 1000, volume, 0.5f);
  TEST_ASSERT_TRUE(d.valveShouldBeOpen());
}

void test_mede_so_depois_da_agua_assentar(void) {
  // Entre fechar e medir existe um tempo parado. Medir no balanço da superfície
  // é medir errado, e esse erro vira litros a mais ou a menos na missão.
  Dispenser d = novo();
  float volume = 8.0f;
  d.start("cmd-10", 1.0f, 60000, distanciaPara(volume), true, 0);
  uint64_t agora = escoar(d, 0, 2000, volume, 0.5f);
  TEST_ASSERT_EQUAL(DispenseStatus::Measuring, d.status());
  TEST_ASSERT_FALSE(d.valveShouldBeOpen());

  d.update(distanciaPara(volume), true, agora + 1000);
  TEST_ASSERT_EQUAL(DispenseStatus::Measuring, d.status());
  d.update(distanciaPara(volume), true, agora + 4000);
  TEST_ASSERT_EQUAL(DispenseStatus::Completed, d.status());
}

void test_comando_repetido_nao_reabre_a_valvula(void) {
  // O relatório terminal viaja na próxima telemetria. Se o servidor repetir o
  // comando antes de recebê-lo, a válvula não pode abrir de novo.
  Dispenser d = novo();
  float volume = 8.0f;
  d.start("cmd-11", 1.0f, 60000, distanciaPara(volume), true, 0);
  escoar(d, 0, 20000, volume, 0.5f);
  TEST_ASSERT_EQUAL(DispenseStatus::Completed, d.status());

  TEST_ASSERT_FALSE(d.start("cmd-11", 1.0f, 60000, distanciaPara(volume), true, 30000));
  TEST_ASSERT_FALSE(d.valveShouldBeOpen());
  TEST_ASSERT_EQUAL(DispenseStatus::Completed, d.status());
}

void test_relatorio_confirmado_libera_a_proxima_missao(void) {
  Dispenser d = novo();
  float volume = 8.0f;
  d.start("cmd-12", 1.0f, 60000, distanciaPara(volume), true, 0);
  escoar(d, 0, 20000, volume, 0.5f);
  TEST_ASSERT_TRUE(d.hasReport());

  d.acknowledgeReport();
  TEST_ASSERT_FALSE(d.hasReport());
  TEST_ASSERT_FALSE(d.busy());
  TEST_ASSERT_TRUE(d.start("cmd-13", 1.0f, 60000, distanciaPara(volume), true, 30000));
}

void test_volume_fica_entre_zero_e_a_capacidade(void) {
  const VolumeModel m = modelo();
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 0.0f, volumeFromDistance(m, 1700));  // abaixo do zero
  TEST_ASSERT_FLOAT_WITHIN(0.01f, m.capacityLiters, volumeFromDistance(m, 50));  // acima do máximo
  TEST_ASSERT_FLOAT_WITHIN(0.05f, 3.925f, volumeFromDistance(m, 1100));
}

void setUp(void) {}
void tearDown(void) {}

int main(int, char **) {
  UNITY_BEGIN();
  RUN_TEST(test_libera_pelo_volume_medido);
  RUN_TEST(test_nao_entrega_muito_mais_do_que_o_pedido);
  RUN_TEST(test_agua_que_nao_desce_vira_no_flow);
  RUN_TEST(test_teto_de_tempo_fecha_mesmo_com_agua_saindo);
  RUN_TEST(test_sensor_mudo_fecha_a_valvula);
  RUN_TEST(test_sem_calibracao_nao_abre);
  RUN_TEST(test_agua_insuficiente_nao_abre);
  RUN_TEST(test_cancelar_fecha_e_mede_o_que_saiu);
  RUN_TEST(test_cancelamento_de_outro_comando_nao_interrompe);
  RUN_TEST(test_mede_so_depois_da_agua_assentar);
  RUN_TEST(test_comando_repetido_nao_reabre_a_valvula);
  RUN_TEST(test_relatorio_confirmado_libera_a_proxima_missao);
  RUN_TEST(test_volume_fica_entre_zero_e_a_capacidade);
  return UNITY_END();
}
