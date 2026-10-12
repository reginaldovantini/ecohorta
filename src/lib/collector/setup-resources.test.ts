import { describe, expect, it } from "vitest";
import { allSetupResources, SETUP_DOCUMENTS, setupResources, type SetupDocument } from "./setup-resources";

/** Mesmo cálculo de `allSetupResources`, aplicado a uma lista hipotética. */
const comoSeria = (documents: readonly SetupDocument[]) =>
  documents.map((document) => ({
    href: document.ready ? `/documentos-captador/${document.file}` : null,
    pending: document.ready ? null : "x",
  }));

describe("material de cada etapa", () => {
  it("o manual é da montagem, as artes são da personalização", () => {
    expect(setupResources("montagem").map((item) => item.id)).toEqual(["manual"]);
    expect(setupResources("personalizacao").map((item) => item.id)).toEqual(["artes"]);
  });

  it("etapas sem material não inventam botão", () => {
    for (const etapa of ["cadastro", "firmware", "conexao", "calibracao"] as const) {
      expect(setupResources(etapa)).toEqual([]);
    }
  });
});

describe("enquanto o PDF não existe", () => {
  it("não oferece link que não abre — e diz o que está acontecendo", () => {
    for (const material of allSetupResources().filter((item) => !item.ready)) {
      expect(material.href).toBeNull();
      expect(material.pending).toMatch(/preparação/);
    }
  });

  it("marcar `ready` publica o link daquele arquivo, e só dele", () => {
    const hipotese = comoSeria([
      { ...SETUP_DOCUMENTS[0]!, ready: true },
      { ...SETUP_DOCUMENTS[1]!, ready: false },
    ]);
    expect(hipotese[0]!.href).toBe("/documentos-captador/manual-construcao-captador.pdf");
    expect(hipotese[1]!.href).toBeNull();
  });

  it("todo material pronto abre no caminho público da pasta", () => {
    for (const material of allSetupResources().filter((item) => item.ready)) {
      expect(material.pending).toBeNull();
      expect(material.href).toBe(`/documentos-captador/${material.file}`);
    }
  });
});

describe("todo material se explica antes de ser baixado", () => {
  it("tem título e uma frase sobre o que a pessoa vai encontrar dentro", () => {
    for (const documento of SETUP_DOCUMENTS) {
      expect(documento.title.length).toBeGreaterThan(5);
      expect(documento.description.length).toBeGreaterThan(30);
      expect(documento.file.endsWith(".pdf")).toBe(true);
    }
  });
});
