import { describe, expect, it } from "vitest";
import { cameraFailure, CAMERA_FAILURE_MESSAGE, tokenFromScan } from "./qr-reader";

/*
 * O que a câmera devolve não é um captador — é texto. Este módulo decide se
 * aquele texto PARECE um token, e só isso: quem confere de verdade é o
 * servidor. Testar aqui é barato e evita que uma leitura boa seja descartada
 * antes de chegar lá.
 */

const TOKEN = "0efae393694a357a699ec21de5cb1248";

describe("o que a câmera leu", () => {
  it("aceita a URL do adesivo, que é o caso normal", () => {
    expect(tokenFromScan(`https://ecohorta-inteligente.vercel.app/q/${TOKEN}`)).toBe(TOKEN);
  });

  it("aceita o token solto: leitor de terceiros às vezes entrega só isso", () => {
    expect(tokenFromScan(TOKEN)).toBe(TOKEN);
    expect(tokenFromScan(`  ${TOKEN}  `)).toBe(TOKEN);
  });

  it("não se perde com maiúsculas", () => {
    expect(tokenFromScan(`HTTPS://ECOHORTA.APP/Q/${TOKEN.toUpperCase()}`)).toBe(TOKEN);
  });

  it("recusa o que não é token", () => {
    expect(tokenFromScan("https://ecohorta-inteligente.vercel.app/entrar")).toBeNull();
    expect(tokenFromScan("")).toBeNull();
    expect(tokenFromScan("abc")).toBeNull();
    // Hexadecimal, mas curto demais para ser um token.
    expect(tokenFromScan("0efae393694a357a699ec21de5cb12")).toBeNull();
    // E comprido demais: um hash de 40 não contém um token de 32.
    expect(tokenFromScan("0efae393694a357a699ec21de5cb1248aabbccdd")).toBeNull();
  });

  it("aceita a URL com barra no fim", () => {
    expect(tokenFromScan(`https://ecohorta-inteligente.vercel.app/q/${TOKEN}/`)).toBe(TOKEN);
  });

  it("um QR de outra coisa qualquer não vira captador", () => {
    expect(tokenFromScan("WIFI:S:EscolaClarinda;T:WPA;P:senha123;;")).toBeNull();
    expect(tokenFromScan("https://instagram.com/escola")).toBeNull();
  });
});

describe("quando a câmera não abre, a pessoa precisa saber por quê", () => {
  it("recusa de permissão tem nome próprio", () => {
    expect(cameraFailure({ name: "NotAllowedError" })).toBe("denied");
    expect(CAMERA_FAILURE_MESSAGE.denied).toMatch(/autorize/i);
  });

  it("aparelho sem câmera não é culpa de permissão", () => {
    expect(cameraFailure({ name: "NotFoundError" })).toBe("unavailable");
  });

  it("toda recusa tem uma frase que diz o que fazer", () => {
    for (const mensagem of Object.values(CAMERA_FAILURE_MESSAGE)) {
      expect(mensagem.length).toBeGreaterThan(20);
      expect(mensagem.endsWith(".")).toBe(true);
    }
  });
});
