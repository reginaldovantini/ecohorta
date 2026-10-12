#pragma once

#include <Arduino.h>

// Conexão do captador — ver wifi_portal.cpp para o porquê de cada modo.
namespace net {

// Lê as credenciais guardadas na placa e conecta. Sem credenciais (ou sem
// conseguir), abre a rede do próprio captador para alguém informar a rede.
void begin();

// Chamar a cada ciclo: atende o portal, reconecta e tenta o resgate por celular.
void loop();

bool online();

// Nome da rede guardada na placa ("" quando nunca foi configurada).
const char *storedSsid();

// Modo atual, para o monitor serial e a telemetria.
const char *modeName();

}  // namespace net
