import { describe, expect, it } from "vitest";
import { RELEASE_CHECK_IDS } from "./release-checklist";
import { releaseAction, requestRelease, restartScan, scanAccepted, scanRejected, toggleCheck, type ReleaseState } from "./release-flow";

/** Percorre a conferência inteira, marcando item por item. */
const marcarTudo = (state: ReleaseState) => RELEASE_CHECK_IDS.reduce<ReleaseState>((current, id) => toggleCheck(current, id), state);

describe("percurso de aceitar a missão até a água sair", () => {
  it("começa com a câmera aberta, e o botão ainda não abre nada", () => {
    const acao = releaseAction({ stage: "scanning" });
    expect(acao.kind).toBe("camera");
    expect(acao.label).toBe("Procurando o QR");
    expect(acao.enabled).toBe(false);
    expect(acao.opensValve).toBe(false);
    expect(acao.hint).toBeNull(); // a mira animada é a instrução
  });

  it("depois da leitura aceita, o botão vira 'Abrir torneira' — ainda desligado", () => {
    const acao = releaseAction(scanAccepted());
    expect(acao.label).toBe("Abrir torneira");
    expect(acao.kind).toBe("hold");
    expect(acao.enabled).toBe(false);
    expect(acao.hint).toBe("Faltam 3 confirmações");
  });

  it("o botão acorda quando a conferência fecha, e pede para segurar", () => {
    const acao = releaseAction(marcarTudo(scanAccepted()));
    expect(acao.enabled).toBe(true);
    expect(acao.opensValve).toBe(true);
    expect(acao.hint).toBe("Segure para abrir");
  });

  it("vai de aceitar a missão até a válvula aberta", () => {
    let estado: ReleaseState = { stage: "scanning" };
    estado = scanAccepted();
    estado = marcarTudo(estado);
    estado = requestRelease(estado);
    expect(estado.stage).toBe("releasing");
    expect(releaseAction(estado)).toMatchObject({ label: "Liberando água…", enabled: false, opensValve: false });
  });
});

describe("o que impede a válvula de abrir", () => {
  it("segurar o botão não substitui a leitura do QR", () => {
    expect(requestRelease({ stage: "scanning" })).toEqual({ stage: "scanning" });
    expect(requestRelease({ stage: "verifying" })).toEqual({ stage: "verifying" });
  });

  it("segurar o botão não substitui a conferência", () => {
    const meioCaminho = toggleCheck(scanAccepted(), "recipiente");
    expect(requestRelease(meioCaminho)).toEqual(meioCaminho);
  });

  it("desmarcar um item depois de completar desliga o botão de novo", () => {
    const pronto = marcarTudo(scanAccepted());
    expect(releaseAction(pronto).enabled).toBe(true);

    const desmarcado = toggleCheck(pronto, "recipiente");
    expect(releaseAction(desmarcado).enabled).toBe(false);
    expect(requestRelease(desmarcado)).toEqual(desmarcado);
  });

  it("marcar não tem efeito fora da etapa de conferência", () => {
    expect(toggleCheck({ stage: "scanning" }, "recipiente")).toEqual({ stage: "scanning" });
    expect(toggleCheck({ stage: "releasing" }, "recipiente")).toEqual({ stage: "releasing" });
  });
});

describe("leitura recusada pelo servidor", () => {
  it("mostra o motivo que veio do servidor e oferece ler de novo", () => {
    const acao = releaseAction(scanRejected("other_collector"));
    expect(acao.kind).toBe("retry");
    expect(acao.label).toBe("Ler de novo");
    expect(acao.enabled).toBe(true);
    expect(acao.opensValve).toBe(false);
    expect(acao.hint).toBe("Este QR é de outro captador");
  });

  it("explica a foto guardada do QR, em vez de só dizer que falhou", () => {
    expect(releaseAction(scanRejected("expired")).hint).toMatch(/junto ao captador/i);
    expect(releaseAction(scanRejected("already_used")).hint).toMatch(/já foi usada/i);
  });

  it("tentar de novo volta para a câmera, sem conferência marcada", () => {
    const recomeco = restartScan();
    expect(recomeco).toEqual({ stage: "scanning" });
    // E a conferência da tentativa anterior não sobrevive à nova leitura.
    expect(releaseAction(scanAccepted()).hint).toBe("Faltam 3 confirmações");
  });
});

describe("o botão de baixo também é curto", () => {
  const estados: ReleaseState[] = [
    { stage: "scanning" },
    { stage: "verifying" },
    scanRejected("expired"),
    scanAccepted(),
    marcarTudo(scanAccepted()),
    { stage: "releasing" },
  ];

  it("nenhum rótulo passa de três palavras", () => {
    for (const estado of estados) {
      const { label } = releaseAction(estado);
      const palavras = label.trim().split(/\s+/).length;
      expect(palavras, `"${label}" tem ${palavras} palavras`).toBeLessThanOrEqual(3);
    }
  });

  it("a linha de apoio aparece só quando explica o que falta", () => {
    expect(releaseAction({ stage: "scanning" }).hint).toBeNull();
    expect(releaseAction({ stage: "verifying" }).hint).toBeNull();
    expect(releaseAction({ stage: "releasing" }).hint).toBeNull();
    expect(releaseAction(scanAccepted()).hint).not.toBeNull();
  });
});
