import { describe, expect, it } from "vitest";
import {
  canRelease,
  missingChecks,
  RELEASE_CHECK_IDS,
  releaseBlockedReason,
  releaseChecklist,
} from "./release-checklist";

const CONTEXTO = { liters: 3, location: "Horta dos fundos" };
const TUDO = [...RELEASE_CHECK_IDS];

const palavras = (texto: string) => texto.trim().split(/\s+/).length;

describe("os três selos", () => {
  it("cabem em três palavras: ninguém lê parágrafo antes de abrir uma torneira", () => {
    for (const item of releaseChecklist(CONTEXTO)) {
      expect(palavras(item.label), `"${item.label}" tem ${palavras(item.label)} palavras`).toBeLessThanOrEqual(3);
    }
  });

  it("são três, e cada um tem o próprio ícone", () => {
    const itens = releaseChecklist(CONTEXTO);
    expect(itens).toHaveLength(3);
    expect(itens.map((item) => item.icon)).toEqual(["container", "volume", "presence"]);
  });

  it("o selo do volume acompanha a missão", () => {
    expect(releaseChecklist(CONTEXTO).find((item) => item.id === "capacidade")!.label).toBe("Cabe 3,0 L");
    expect(releaseChecklist({ ...CONTEXTO, liters: 1.5 }).find((item) => item.id === "capacidade")!.label).toBe("Cabe 1,5 L");
  });

  it("a frase inteira existe fora da tela, para leitor de tela e para quem quiser ver", () => {
    const itens = releaseChecklist(CONTEXTO);
    expect(itens.find((item) => item.id === "recipiente")!.description).toContain("Horta dos fundos");
    for (const item of itens) expect(item.description.length).toBeGreaterThan(item.label.length);
  });
});

describe("liberação da válvula", () => {
  it("não libera sem a leitura do QR, mesmo com os três selos acesos", () => {
    expect(canRelease({ checked: TUDO, scanValidated: false })).toBe(false);
    expect(releaseBlockedReason({ checked: TUDO, scanValidated: false })).toBe("Leia o QR do captador");
  });

  it("não libera com o QR lido e a conferência pela metade", () => {
    expect(canRelease({ checked: ["recipiente"], scanValidated: true })).toBe(false);
    expect(missingChecks({ checked: ["recipiente"], scanValidated: true })).toEqual(["capacidade", "acompanhar"]);
  });

  it("libera só com as duas coisas: presença provada e preparo confirmado", () => {
    expect(canRelease({ checked: TUDO, scanValidated: true })).toBe(true);
    expect(releaseBlockedReason({ checked: TUDO, scanValidated: true })).toBeNull();
  });

  it("conta o que falta, no singular e no plural", () => {
    expect(releaseBlockedReason({ checked: ["recipiente", "capacidade"], scanValidated: true })).toBe("Falta 1 confirmação");
    expect(releaseBlockedReason({ checked: [], scanValidated: true })).toBe("Faltam 3 confirmações");
  });

  it("ignora confirmação desconhecida vinda do navegador", () => {
    expect(canRelease({ checked: [...TUDO, "inventado"], scanValidated: true })).toBe(true);
    expect(canRelease({ checked: ["inventado", "outro"], scanValidated: true })).toBe(false);
  });
});
