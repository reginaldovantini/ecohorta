import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { flashingGuide, secretsHeader, type FirmwareIdentity } from "./firmware-package";

const identidade: FirmwareIdentity = {
  collectorCode: "PROTO-003",
  deviceKey: "ESP32-3F9A2B71",
  deviceToken: "a".repeat(64),
  apiBaseUrl: "https://ecohorta.exemplo",
  hotspotSsid: "EcoHorta-7KQ3",
  hotspotPassword: "horta7kq3mpx",
};

const conteudo = secretsHeader(identidade);
const macros = (text: string) => [...text.matchAll(/^#define\s+(\w+)/gm)].map((match) => match[1]).sort();

describe("secrets.h gerado pela plataforma", () => {
  it("define exatamente o que o firmware espera", () => {
    // O exemplo versionado é o contrato: se o firmware passar a precisar de outra
    // coisa, este teste cai aqui em vez de a placa falhar ao compilar na escola.
    const exemplo = readFileSync(path.join(process.cwd(), "firmware/include/secrets.example.h"), "utf8");
    expect(macros(conteudo)).toEqual(macros(exemplo));
  });

  it("não leva a senha do Wi-Fi da escola", () => {
    // Este arquivo é baixado, salvo na pasta de downloads e às vezes mandado por
    // e-mail. A senha da rede da escola não pode viajar dentro dele.
    expect(conteudo).not.toMatch(/WIFI_SSID|WIFI_PASSWORD/);
  });

  it("traz a identidade daquele captador, e o token em claro uma única vez", () => {
    expect(conteudo).toContain('#define DEVICE_ID "ESP32-3F9A2B71"');
    expect(conteudo).toContain('#define COLLECTOR_CODE "PROTO-003"');
    expect(conteudo).toContain(`#define DEVICE_TOKEN "${identidade.deviceToken}"`);
    expect(conteudo).toContain('#define API_BASE_URL "https://ecohorta.exemplo"');
  });

  it("traz a rede que a placa cria, com a senha que o app mostra ao estudante", () => {
    expect(conteudo).toContain('#define SETUP_AP_SSID "EcoHorta-7KQ3"');
    expect(conteudo).toContain('#define SETUP_AP_PASSWORD "horta7kq3mpx"');
  });

  it("avisa, dentro do arquivo, que ele não se compartilha", () => {
    expect(conteudo).toMatch(/NÃO versione/);
    expect(conteudo).toMatch(/não o compartilhe/);
  });
});

describe("passo a passo da gravação", () => {
  const guia = flashingGuide(identidade);

  it("vai da instalação do programa até a conferência na plataforma", () => {
    expect(guia).toHaveLength(7);
    // A numeração é de quem desenha: tela e PDF numeram sozinhos, e um "1." no
    // título virava "1. 1." no papel.
    for (const passo of guia) expect(passo.title).not.toMatch(/^\d+\./);

    expect(guia.at(-1)!.title).toMatch(/plataforma/i);
  });

  it("todo passo tem instrução, e nenhum presume que a pessoa já programou", () => {
    for (const passo of guia) {
      expect(passo.lines.length).toBeGreaterThan(0);
      // Frase inteira, com ponto — menos quando termina em endereço: um ponto
      // depois de uma URL vai junto quando alguém copia, e a página não abre.
      for (const linha of passo.lines) expect(linha.endsWith(".") || /https?:\/\/\S+$/.test(linha)).toBe(true);
    }
  });

  it("entrega o comando pronto para copiar", () => {
    const gravar = guia.find((passo) => passo.copy);
    expect(gravar!.copy).toBe("pio run -d firmware -e esp32dev -t upload");
  });

  it("os passos onde se trava explicam a saída", () => {
    // Cabo que só carrega, driver USB faltando, porta ocupada, página que não abre
    // sozinha: é onde alguém desiste sozinho em casa.
    const comSocorro = guia.filter((passo) => passo.whenItFails);
    expect(comSocorro.length).toBeGreaterThanOrEqual(4);
    expect(guia.find((passo) => passo.title.includes("Wi-Fi"))!.whenItFails).toContain("192.168.4.1");
  });

  it("diz o nome e a senha da rede do captador, no passo em que se usa", () => {
    const conexao = guia.find((passo) => passo.title.includes("Wi-Fi"))!;
    expect(conexao.lines.join(" ")).toContain("EcoHorta-7KQ3");
    expect(conexao.lines.join(" ")).toContain("horta7kq3mpx");
  });
});
