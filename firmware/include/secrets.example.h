#pragma once

// =====================================================================
// Exemplo. O arquivo real (include/secrets.h, ignorado pelo Git) é GERADO
// PELA PLATAFORMA, um por captador:
//   Administração → Captadores → o captador → etapa "Programa do ESP32".
//
// A rede Wi-Fi da escola NÃO está aqui de propósito. Ao ligar, a placa cria a
// própria rede (SETUP_AP_SSID) e pergunta a rede do lugar a quem está na frente
// dela; a senha fica na memória da placa, nunca num arquivo (wifi_portal.cpp).
// =====================================================================

// URL pública da plataforma (HTTPS), sem barra no final.
#define API_BASE_URL "https://seu-projeto.vercel.app"

#define DEVICE_ID "ESP32-3F9A2B71"
#define COLLECTOR_CODE "PROTO-001"
#define DEVICE_TOKEN "cole-aqui-o-token-gerado"

// Rede do captador, com dois usos (o aplicativo mostra estes valores):
//   1. a placa cria esta rede para ser configurada;
//   2. um estudante liga o ponto de acesso do celular com ESTE nome e ESTA senha
//      para atender o captador quando a internet da escola está fora do ar.
#define SETUP_AP_SSID "EcoHorta-7KQ3"
#define SETUP_AP_PASSWORD "horta7kq3mpx"

// Certificado raiz (PEM) da URL da API. Vazio = TLS sem verificação do servidor:
// aceitável só na bancada; antes de instalar na escola, preencher (ver docs/HARDWARE.md §7).
static const char API_ROOT_CA[] = "";
