// A CONEXÃO DO CAPTADOR — por que ela não vem compilada no programa.
//
// A versão antiga trazia WIFI_SSID e WIFI_PASSWORD dentro de secrets.h. Isso
// funciona numa bancada e falha em toda escola real: a plataforma gera o
// programa para download, e a senha do Wi-Fi da escola iria junto, para a pasta
// de downloads, para o e-mail, para o computador da secretaria. Pior: trocar a
// senha da rede exigiria recompilar e regravar a placa, com um cabo, na escola.
//
// Então a placa pergunta. Ao ligar sem rede configurada, ela cria a própria rede
// Wi-Fi (SETUP_AP_SSID) e serve uma página que lista o que há no ar. Quem está
// instalando escolhe a rede da escola e digita a senha — como numa TV nova. A
// senha fica na memória não volátil DESTA placa e em nenhum outro lugar.
//
// O MESMO nome e senha servem para o resgate. Quando a internet da escola cai,
// o captador para de reportar, e a missão daquele dia depende de alguém que está
// no pátio com um celular. O estudante liga o ponto de acesso do celular com o
// nome e a senha que o app mostra — os mesmos desta rede — e a placa entra nele
// sozinha, porque já os conhece. Sem isso, atender um captador offline exigiria
// configurar a placa no sol, pelo celular.
//
// Os dois usos têm o mesmo nome e isso não colide, porque a placa nunca está nos
// dois papéis ao mesmo tempo: para procurar o celular, ela desliga a própria
// rede por alguns segundos (e nunca enquanto alguém está com a página aberta).

#include "wifi_portal.h"

#include <DNSServer.h>
#include <Preferences.h>
#include <WebServer.h>
#include <WiFi.h>

#include "config.h"
#include "secrets.h"

namespace net {
namespace {

enum class Mode { Booting, Connected, Portal, Searching };

Preferences storage;
WebServer server(80);
DNSServer dns;

Mode mode = Mode::Booting;
bool portalUp = false;
String storedNetwork;
String storedPassword;
String lastError;
uint32_t nextAttemptMs = 0;

// Quanto esperar por uma conexão antes de desistir desta tentativa.
constexpr uint32_t CONNECT_TIMEOUT_MS = 15000;
// Com rede configurada mas fora do ar, tenta de novo neste intervalo.
constexpr uint32_t RETRY_INTERVAL_MS = 30000;

void loadCredentials() {
  storage.begin("ecohorta-net", true);
  storedNetwork = storage.getString("ssid", "");
  storedPassword = storage.getString("pass", "");
  storage.end();
}

void saveCredentials(const String &ssid, const String &password) {
  storage.begin("ecohorta-net", false);
  storage.putString("ssid", ssid);
  storage.putString("pass", password);
  storage.end();
  storedNetwork = ssid;
  storedPassword = password;
}

// Tenta uma rede como cliente. Devolve true quando conectou.
bool joinNetwork(const char *ssid, const char *password) {
  if (!ssid || strlen(ssid) == 0) return false;
  Serial.printf("[wifi] conectando a %s...\n", ssid);
  WiFi.begin(ssid, password);
  uint32_t started = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - started < CONNECT_TIMEOUT_MS) delay(250);
  if (WiFi.status() != WL_CONNECTED) {
    Serial.printf("[wifi] não conectou a %s\n", ssid);
    return false;
  }
  Serial.printf("[wifi] conectado a %s, IP %s, RSSI %d\n", ssid, WiFi.localIP().toString().c_str(), WiFi.RSSI());
  mode = Mode::Connected;
  return true;
}

// Barra de sinal, para a pessoa escolher a rede certa sem saber o que é dBm.
const char *signalBars(int rssi) {
  if (rssi >= -60) return "••••";
  if (rssi >= -70) return "•••";
  if (rssi >= -80) return "••";
  return "•";
}

String escapeHtml(const String &text) {
  String out;
  out.reserve(text.length() + 8);
  for (size_t i = 0; i < text.length(); i++) {
    char c = text[i];
    if (c == '&') out += "&amp;";
    else if (c == '<') out += "&lt;";
    else if (c == '>') out += "&gt;";
    else if (c == '"') out += "&quot;";
    else out += c;
  }
  return out;
}

// A página é propositalmente uma só, sem imagem e sem script externo: ela é
// servida pela placa, por um celular, em pé, no corredor da escola.
String portalPage() {
  int found = WiFi.scanNetworks();
  String html;
  html.reserve(3500);
  html += F("<!doctype html><html lang=\"pt-BR\"><head><meta charset=\"utf-8\">"
            "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
            "<title>Captador EcoHorta</title><style>"
            ":root{color-scheme:light dark}"
            "body{margin:0;padding:20px 16px 40px;font:16px/1.5 system-ui,sans-serif;background:#073d2d;color:#fff}"
            "h1{font-size:21px;margin:0 0 4px}p{margin:0 0 16px;opacity:.85;font-size:14px}"
            "ul{list-style:none;margin:0 0 20px;padding:0}"
            "li button{width:100%;display:flex;justify-content:space-between;gap:12px;align-items:center;"
            "background:rgba(255,255,255,.12);color:#fff;border:0;border-radius:12px;padding:14px 16px;margin-bottom:8px;"
            "font-size:16px;text-align:left}"
            "li button[aria-pressed=\"true\"]{background:#fff;color:#073d2d;font-weight:600}"
            "label{display:block;font-size:14px;margin-bottom:6px}"
            "input{width:100%;box-sizing:border-box;padding:14px;border-radius:12px;border:0;font-size:16px;margin-bottom:12px}"
            "button.go{width:100%;padding:16px;border:0;border-radius:12px;background:#f5c543;color:#073d2d;font-size:17px;font-weight:700}"
            ".erro{background:#7d1f1f;padding:12px 14px;border-radius:12px;margin-bottom:16px;font-size:14px}"
            ".aviso{opacity:.7;font-size:13px;margin-top:18px}"
            "</style></head><body><h1>Captador ");
  html += F(COLLECTOR_CODE);
  html += F("</h1><p>Escolha a rede Wi-Fi da escola e digite a senha dela.</p>");
  if (lastError.length() > 0) {
    html += F("<div class=\"erro\">");
    html += escapeHtml(lastError);
    html += F("</div>");
  }
  html += F("<form method=\"POST\" action=\"/salvar\"><ul>");
  for (int i = 0; i < found && i < 16; i++) {
    String ssid = WiFi.SSID(i);
    if (ssid.length() == 0) continue;
    html += F("<li><button type=\"button\" aria-pressed=\"false\" onclick=\"p(this)\"><span>");
    html += escapeHtml(ssid);
    html += F("</span><span>");
    html += signalBars(WiFi.RSSI(i));
    html += F("</span></button></li>");
  }
  WiFi.scanDelete();
  html += F("</ul><label for=\"ssid\">Rede escolhida (ou digite, se não apareceu)</label>"
            "<input id=\"ssid\" name=\"ssid\" autocapitalize=\"none\" autocomplete=\"off\" required>"
            "<label for=\"senha\">Senha da rede</label>"
            "<input id=\"senha\" name=\"senha\" type=\"password\" autocomplete=\"off\">"
            "<button class=\"go\" type=\"submit\">Conectar</button></form>"
            "<p class=\"aviso\">A senha fica guardada somente nesta placa. Ela não vai para a internet "
            "nem aparece no aplicativo.</p>"
            "<script>function p(b){document.querySelectorAll('li button').forEach(function(o){o.setAttribute('aria-pressed','false')});"
            "b.setAttribute('aria-pressed','true');document.getElementById('ssid').value=b.firstChild.textContent;"
            "document.getElementById('senha').focus()}</script></body></html>");
  return html;
}

String savedPage() {
  String html;
  html.reserve(700);
  html += F("<!doctype html><html lang=\"pt-BR\"><head><meta charset=\"utf-8\">"
            "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
            "<title>Conectando</title><style>"
            "body{margin:0;padding:48px 20px;font:17px/1.6 system-ui,sans-serif;background:#073d2d;color:#fff;text-align:center}"
            "strong{display:block;font-size:22px;margin-bottom:12px}p{opacity:.85;font-size:15px}"
            "</style></head><body><strong>Rede guardada</strong>"
            "<p>O captador vai reiniciar e se conectar a <b>");
  html += escapeHtml(storedNetwork);
  html += F("</b>.</p><p>Volte ao aplicativo: a etapa de conexão fica verde sozinha quando a placa falar.</p>"
            "</body></html>");
  return html;
}

void handleRoot() { server.send(200, "text/html; charset=utf-8", portalPage()); }

void handleSave() {
  String ssid = server.arg("ssid");
  ssid.trim();
  if (ssid.length() == 0) {
    lastError = "Escolha uma rede ou digite o nome dela.";
    handleRoot();
    return;
  }
  saveCredentials(ssid, server.arg("senha"));
  lastError = "";
  server.send(200, "text/html; charset=utf-8", savedPage());
  Serial.printf("[portal] rede %s guardada; reiniciando\n", ssid.c_str());
  // Reiniciar é o caminho mais previsível: a placa volta pelo mesmo begin() que
  // já sabe conectar, em vez de um segundo caminho de código para o mesmo fim.
  delay(1500);
  ESP.restart();
}

// Qualquer outro endereço cai na página: é o que faz o celular abrir o portal
// sozinho ao entrar na rede do captador.
void handleNotFound() {
  server.sendHeader("Location", String("http://") + WiFi.softAPIP().toString(), true);
  server.send(302, "text/plain", "");
}

void startPortal() {
  if (portalUp) return;
  WiFi.mode(WIFI_AP_STA);
  WiFi.softAP(SETUP_AP_SSID, SETUP_AP_PASSWORD);
  dns.setErrorReplyCode(DNSReplyCode::NoError);
  dns.start(53, "*", WiFi.softAPIP());
  server.on("/", handleRoot);
  server.on("/salvar", HTTP_POST, handleSave);
  server.onNotFound(handleNotFound);
  server.begin();
  portalUp = true;
  mode = Mode::Portal;
  Serial.printf("[portal] rede %s aberta — senha %s — abra http://%s\n", SETUP_AP_SSID, SETUP_AP_PASSWORD,
                WiFi.softAPIP().toString().c_str());
}

void stopPortal() {
  if (!portalUp) return;
  server.stop();
  dns.stop();
  WiFi.softAPdisconnect(true);
  WiFi.mode(WIFI_STA);
  portalUp = false;
  Serial.println("[portal] rede do captador encerrada");
}

/*
 * Uma rodada de procura: a rede da escola primeiro, o celular de resgate depois.
 *
 * Enquanto alguém está com a página do portal aberta, nada disso acontece — tirar
 * a rede do ar no meio da configuração seria a pior hora possível.
 */
bool searchNetworks() {
  if (portalUp && WiFi.softAPgetStationNum() > 0) return false;
  bool reopen = portalUp;
  stopPortal();
  mode = Mode::Searching;

  bool connected = joinNetwork(storedNetwork.c_str(), storedPassword.c_str());
  // O celular de alguém no pátio: mesmo nome e senha da rede do captador.
  if (!connected) connected = joinNetwork(SETUP_AP_SSID, SETUP_AP_PASSWORD);
  if (!connected) {
    if (reopen || storedNetwork.length() == 0) startPortal();
    nextAttemptMs = millis() + RETRY_INTERVAL_MS;
  }
  return connected;
}

}  // namespace

void begin() {
  loadCredentials();
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  if (storedNetwork.length() == 0) {
    Serial.println("[wifi] nenhuma rede configurada nesta placa");
    startPortal();
    return;
  }
  if (!joinNetwork(storedNetwork.c_str(), storedPassword.c_str())) {
    // Pode ser a internet da escola fora do ar, não configuração errada: abre o
    // portal (para corrigir) e segue tentando a rede guardada e o resgate.
    if (!joinNetwork(SETUP_AP_SSID, SETUP_AP_PASSWORD)) startPortal();
    nextAttemptMs = millis() + RETRY_INTERVAL_MS;
  }
}

void loop() {
  if (portalUp) {
    dns.processNextRequest();
    server.handleClient();
  }
  if (WiFi.status() == WL_CONNECTED) {
    if (portalUp && WiFi.softAPgetStationNum() == 0) stopPortal();
    mode = Mode::Connected;
    return;
  }
  if (millis() >= nextAttemptMs) searchNetworks();
}

bool online() { return WiFi.status() == WL_CONNECTED; }

const char *storedSsid() { return storedNetwork.c_str(); }

const char *modeName() {
  switch (mode) {
    case Mode::Connected:
      return "connected";
    case Mode::Portal:
      return "portal";
    case Mode::Searching:
      return "searching";
    default:
      return "booting";
  }
}

}  // namespace net
