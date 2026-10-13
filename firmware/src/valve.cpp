#include "valve.h"

#include <Arduino.h>

#include "config.h"

namespace valve {
namespace {
bool open_ = false;

// Nível que ENERGIZA a bobina do relé. Módulo acionado por nível baixo: LOW.
inline int nivelAcionado() { return VALVE_RELAY_ACTIVE_LOW ? LOW : HIGH; }
inline int nivelSolto() { return VALVE_RELAY_ACTIVE_LOW ? HIGH : LOW; }
}  // namespace

void begin() {
  // A ordem importa: escrever o nível ANTES de declarar o pino como saída evita
  // um pulso no relé no instante em que ele vira saída.
  digitalWrite(PIN_VALVE_RELAY, nivelSolto());
  pinMode(PIN_VALVE_RELAY, OUTPUT);
  digitalWrite(PIN_VALVE_RELAY, nivelSolto());
  open_ = false;
  Serial.printf("[valvula] rele no GPIO%d, aciona em nivel %s (confira na bancada antes de encher o tubo)\n",
                PIN_VALVE_RELAY, VALVE_RELAY_ACTIVE_LOW ? "BAIXO" : "ALTO");
}

void set(bool open) {
  if (open == open_) return;
  open_ = open;
  digitalWrite(PIN_VALVE_RELAY, open ? nivelAcionado() : nivelSolto());
  Serial.printf("[valvula] %s\n", open ? "ABRIU" : "FECHOU");
}

bool isOpen() { return open_; }

}  // namespace valve
