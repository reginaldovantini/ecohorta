#pragma once

// Copie para include/secrets.h (ignorado pelo Git) e preencha.
// O token é gerado UMA vez por: npm run admin -- register-device --collector EC-001 --key ESP32-001 ...

#define WIFI_SSID "nome-da-rede"
#define WIFI_PASSWORD "senha-da-rede"

// URL pública da plataforma (HTTPS), sem barra no final.
#define API_BASE_URL "https://seu-projeto.vercel.app"

#define DEVICE_ID "ESP32-001"
#define COLLECTOR_CODE "EC-001"
#define DEVICE_TOKEN "cole-aqui-o-token-gerado"

// Certificado raiz (PEM) da URL da API. Vazio = TLS sem verificação do servidor:
// aceitável só na bancada; antes de instalar na escola, preencher (ver docs/HARDWARE.md §7).
#define API_ROOT_CA ""
