import { describe, expect, it } from "vitest";
import { buildDocumentPdf, type DocumentInput } from "./document-pdf";
import { constructionGuideDocument, firmwareGuideDocument, type GuideContext } from "./setup-guides";

/*
 * O manual é entregue como arquivo, e arquivo quebrado não avisa: ele
 * simplesmente não abre no celular de quem ia montar o captador. Por isso os
 * testes aqui olham a ESTRUTURA do PDF — cabeçalho, tabela de referências,
 * contagem de páginas — e não só o texto.
 */

const texto = (pdf: Uint8Array) => new TextDecoder("latin1").decode(pdf);

const CONTEXTO: GuideContext = {
  collectorCode: "PROTO-007",
  schoolName: "EE Monteiro Lobato",
  location: "Pátio coberto",
  distanceSensor: "VL53L1X",
  nominalDiameterMm: 100,
  nominalUsefulHeightMm: 1500,
  reserveLiters: 0.5,
  hotspotSsid: "EcoHorta-9B1C",
  hotspotPassword: "chuva-de-maio",
};

const simples: DocumentInput = {
  title: "Título",
  subtitle: "Subtítulo",
  footer: "Rodapé",
  sections: [{ heading: "Seção", blocks: [{ kind: "text", text: "Uma frase." }] }],
};

describe("o arquivo abre", () => {
  const pdf = buildDocumentPdf(simples);
  const conteudo = texto(pdf);

  it("tem cabeçalho e fim de arquivo", () => {
    expect(conteudo.startsWith("%PDF-1.7")).toBe(true);
    expect(conteudo.trimEnd().endsWith("%%EOF")).toBe(true);
  });

  it("cada posição da tabela de referências aponta para o objeto que diz apontar", () => {
    const xrefAt = Number(conteudo.slice(conteudo.lastIndexOf("startxref") + 9).trim().split("\n")[0]);
    const linhas = conteudo
      .slice(xrefAt)
      .split("\n")
      .filter((linha) => /^\d{10} \d{5} n\s*$/.test(linha));
    expect(linhas.length).toBeGreaterThan(5);
    for (const [index, linha] of linhas.entries()) {
      const offset = Number(linha.slice(0, 10));
      expect(conteudo.slice(offset, offset + 12)).toContain(`${index + 1} 0 obj`);
    }
  });

  it("o número de páginas declarado é o número de páginas que existe", () => {
    const declarado = Number(/\/Count (\d+)/.exec(conteudo)![1]);
    const paginas = conteudo.match(/\/Type \/Page[^s]/g)!.length;
    expect(paginas).toBe(declarado);
  });
});

describe("texto comprido vira mais páginas", () => {
  it("uma seção longa não é cortada fora da folha", () => {
    const longo: DocumentInput = {
      ...simples,
      sections: [
        {
          heading: "Seção",
          blocks: Array.from({ length: 120 }, (_, index) => ({ kind: "text" as const, text: `Linha número ${index}.` })),
        },
      ],
    };
    expect(Number(/\/Count (\d+)/.exec(texto(buildDocumentPdf(longo)))![1])).toBeGreaterThan(1);
  });
});

describe("pontuação que o PDF escreve com outro número", () => {
  it("o travessão e o marcador de lista não viram interrogação", () => {
    const conteudo = texto(
      buildDocumentPdf({
        ...simples,
        sections: [{ heading: "Seção", blocks: [{ kind: "text", text: "água — limpa" }, { kind: "bullets", items: ["item"] }] }],
      }),
    );
    // \227 é o travessão em WinAnsi; \225 é o marcador. Octal, como o PDF escreve.
    expect(conteudo).toContain("\\227");
    expect(conteudo).toContain("\\225");
    expect(conteudo).not.toContain("?gua");
  });
});

describe("o manual sai com os dados daquele captador", () => {
  it("a construção traz as medidas do tubo da escola", () => {
    const conteudo = texto(buildDocumentPdf(constructionGuideDocument(CONTEXTO)));
    expect(conteudo).toContain("PROTO-007");
    expect(conteudo).toContain("1,50 m");
    expect(conteudo).toContain("VL53L1X");
  });

  it("a gravação traz a rede da placa e os endereços para baixar os programas", () => {
    const conteudo = texto(buildDocumentPdf(firmwareGuideDocument(CONTEXTO)));
    expect(conteudo).toContain("EcoHorta-9B1C");
    expect(conteudo).toContain("chuva-de-maio");
    expect(conteudo).toContain("code.visualstudio.com");
    expect(conteudo).toContain("platformio.org");
  });

  it("o guia impresso não carrega o token do dispositivo", () => {
    // O contexto do guia nem tem onde guardá-lo: é a garantia que vale, porque
    // depende do tipo e não de alguém lembrar. O teste registra a intenção.
    expect(Object.keys(CONTEXTO)).not.toContain("deviceToken");
    expect(texto(buildDocumentPdf(firmwareGuideDocument(CONTEXTO)))).not.toMatch(/token/i);
  });
});
