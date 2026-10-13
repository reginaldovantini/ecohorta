#pragma once

#include <stdbool.h>

// O RELÉ DA VÁLVULA.
//
// Uma camada fina, de propósito: ela não decide nada. Quem decide é o Dispenser
// (lib/dispense_core), que roda sem placa e é testado no computador. Aqui só
// mora o que depende de hardware — e a regra de ouro, que é fechar primeiro.

namespace valve {

// Deixa o pino em estado FECHADO antes de qualquer outra coisa do firmware.
// Chamado no início do setup(): entre ligar a placa e esta linha, o pino está
// flutuando, e um pino flutuante num módulo acionado por nível baixo pode
// energizar a bobina sozinho.
void begin();

// Abre ou fecha. Idempotente.
void set(bool open);

bool isOpen();

}  // namespace valve
