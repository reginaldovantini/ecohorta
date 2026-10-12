import { describe, expect, it } from "vitest";
import {
  detectPlatform,
  installGuide,
  installPath,
  isInAppBrowser,
  STAGE_LEVEL,
  type InstallContext,
} from "./platform";

const UA = {
  androidChrome:
    "Mozilla/5.0 (Linux; Android 13; SM-A135M) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
  iphoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1",
  ipadOS:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1",
  windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  instagram:
    "Mozilla/5.0 (Linux; Android 13; SM-A135M) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 Instagram 302.0.0.23.113",
  facebook:
    "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 [FBAN/EMA;FBAV/120.0]",
} as const;

const contexto = (patch: Partial<InstallContext> = {}): InstallContext => ({
  userAgent: UA.androidChrome,
  standalone: false,
  promptAvailable: false,
  ...patch,
});

describe("de que aparelho estamos falando", () => {
  it.each([
    [UA.androidChrome, "android"],
    [UA.iphoneSafari, "ios"],
    [UA.windows, "desktop"],
  ])("reconhece a plataforma", (ua, esperado) => {
    expect(detectPlatform(ua)).toBe(esperado);
  });

  it("o iPad moderno se disfarça de Mac — e é pego pelo 'Mobile'", () => {
    expect(detectPlatform(UA.ipadOS)).toBe("ios");
  });
});

describe("navegador embutido em aplicativo", () => {
  it.each([UA.instagram, UA.facebook])("reconhece o navegador reduzido", (ua) => {
    expect(isInAppBrowser(ua)).toBe(true);
  });

  it("não confunde o Chrome de verdade com um embutido", () => {
    expect(isInAppBrowser(UA.androidChrome)).toBe(false);
    expect(isInAppBrowser(UA.iphoneSafari)).toBe(false);
  });

  it("dentro do Instagram, o caminho é reabrir no navegador", () => {
    // Mesmo que o navegador tenha oferecido instalar: ali não vai funcionar.
    expect(installPath(contexto({ userAgent: UA.instagram, promptAvailable: true }))).toBe("in-app-browser");
  });
});

describe("qual caminho mostrar", () => {
  it("com a oferta do navegador em mãos, é um botão só", () => {
    expect(installPath(contexto({ promptAvailable: true }))).toBe("prompt");
  });

  it("no iPhone é sempre o passo a passo: não existe API de instalação", () => {
    expect(installPath(contexto({ userAgent: UA.iphoneSafari }))).toBe("ios-share");
    // Nem com promptAvailable, que no iOS nunca acontece de verdade.
    expect(installPath(contexto({ userAgent: UA.iphoneSafari, promptAvailable: false }))).toBe("ios-share");
  });

  it("no computador, manda para o celular", () => {
    expect(installPath(contexto({ userAgent: UA.windows }))).toBe("desktop");
  });

  it("rodando pelo ícone instalado, não oferece instalar de novo", () => {
    expect(installPath(contexto({ standalone: true, promptAvailable: true }))).toBe("installed");
    expect(installPath(contexto({ userAgent: UA.iphoneSafari, standalone: true }))).toBe("installed");
  });

  it("Android sem oferta do navegador cai no passo a passo do menu", () => {
    expect(installPath(contexto())).toBe("ios-share");
  });
});

describe("as instruções", () => {
  it("todo caminho tem título e pelo menos um passo", () => {
    for (const path of ["prompt", "ios-share", "desktop", "in-app-browser", "installed"] as const) {
      const guia = installGuide(path, "android");
      expect(guia.title.length).toBeGreaterThan(3);
      expect(guia.steps.length).toBeGreaterThan(0);
      for (const passo of guia.steps) expect(passo.endsWith(".")).toBe(true);
    }
  });

  it("no iPhone, avisa que só funciona pelo Safari", () => {
    expect(installGuide("ios-share", "ios").note).toMatch(/Safari/);
    expect(installGuide("ios-share", "ios").steps.join(" ")).toMatch(/Compartilhar/);
  });

  it("no navegador embutido, explica por que não dá", () => {
    expect(installGuide("in-app-browser", "android").note).toMatch(/WhatsApp|Instagram/);
  });
});

describe("o nível do tubo marca etapa, não download", () => {
  it("sobe a cada etapa real e termina cheio", () => {
    expect(STAGE_LEVEL.checking).toBeLessThan(STAGE_LEVEL.ready);
    expect(STAGE_LEVEL.ready).toBeLessThan(STAGE_LEVEL.prompting);
    expect(STAGE_LEVEL.prompting).toBeLessThan(STAGE_LEVEL.installed);
    expect(STAGE_LEVEL.installed).toBe(1);
  });

  it("nunca começa em zero: a primeira etapa já aconteceu ao abrir a página", () => {
    expect(STAGE_LEVEL.checking).toBeGreaterThan(0);
  });
});
