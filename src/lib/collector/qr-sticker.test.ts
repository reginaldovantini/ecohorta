import { describe, expect, it } from "vitest";
import qrcode from "qrcode-generator";
import { buildStickerPdf, STICKER, stickerSize } from "./qr-sticker";

const MM = 72 / 25.4;
const URL = "https://ecohorta.vercel.app/q/0efae393694a357a699ec21de5cb1248";

const sticker = (url = URL) =>
  buildStickerPdf({ url, code: "EC-001", location: "Horta dos fundos", schoolName: "EE Prof.ª Clarinda Mendes de Aquino" });

/** O PDF é latin-1, então dá para lê-lo como texto e inspecionar o conteúdo. */
const asText = (bytes: Uint8Array) => Buffer.from(bytes).toString("latin1");

/**
 * Bloco onde os módulos do QR são desenhados — entre o preenchimento preto e o
 * `f Q` que o fecha. Sem recortar, a caixa branca do QR (também quadrada) entraria
 * na conta e falsearia a medida.
 */
function moduleBlock(texto: string) {
  const inicio = texto.indexOf("q 0 0 0 rg");
  return texto.slice(inicio, texto.indexOf("f Q", inicio));
}

/** Lados dos módulos: só os retângulos quadrados do bloco preto. */
function moduleSides(texto: string): number[] {
  const lados: number[] = [];
  for (const match of moduleBlock(texto).matchAll(/ ([\d.]+) ([\d.]+) re/g)) {
    const [largura, altura] = [Number(match[1]), Number(match[2])];
    if (largura === altura) lados.push(largura);
  }
  return lados;
}

describe("tamanho exigido", () => {
  it("o símbolo do QR tem exatamente 3 cm de lado", () => {
    expect(STICKER.qrMm).toBe(30);
  });

  it("o adesivo nasce da geometria, sem número mágico", () => {
    const { widthMm, heightMm, qrBoxMm } = stickerSize();
    expect(qrBoxMm).toBe(STICKER.qrMm + 2 * STICKER.quietMm);
    expect(widthMm).toBe(qrBoxMm + 2 * STICKER.paddingMm);
    expect(heightMm).toBe(STICKER.paddingMm * 2 + qrBoxMm + STICKER.textBlockMm);
  });

  it("os módulos ocupam 30 mm no papel, qualquer que seja a versão do QR", () => {
    const texto = asText(sticker());
    const qr = qrcode(0, "Q");
    qr.addData(URL);
    qr.make();
    const modules = qr.getModuleCount();

    // Todos os módulos são desenhados com o mesmo lado; 30 mm divididos por eles.
    const esperado = (30 * MM) / modules;
    const lados = moduleSides(texto);
    expect(lados.length).toBeGreaterThan(100);
    for (const lado of new Set(lados)) expect(lado).toBeCloseTo(esperado, 2);
  });

  it("a página é A4, para imprimir em qualquer lugar", () => {
    expect(asText(sticker())).toMatch(/MediaBox \[0 0 595\.276 841\.89\]/);
  });
});

describe("fidelidade do QR", () => {
  it("desenha um retângulo para cada módulo escuro, nem um a mais", () => {
    const qr = qrcode(0, "Q");
    qr.addData(URL);
    qr.make();
    const modules = qr.getModuleCount();
    let escuros = 0;
    for (let row = 0; row < modules; row++) {
      for (let col = 0; col < modules; col++) if (qr.isDark(row, col)) escuros++;
    }

    expect([...moduleBlock(asText(sticker())).matchAll(/ re/g)]).toHaveLength(escuros);
  });

  it("cada captador gera um desenho diferente: o token é o que muda", () => {
    const a = asText(sticker("https://ecohorta.vercel.app/q/" + "a".repeat(32)));
    const b = asText(sticker("https://ecohorta.vercel.app/q/" + "b".repeat(32)));
    expect(a).not.toBe(b);
  });

  it("usa correção de erro alta: o adesivo vai sujar e riscar", () => {
    // Com correção Q o mesmo conteúdo exige mais módulos que com L.
    const comQ = qrcode(0, "Q");
    comQ.addData(URL);
    comQ.make();
    const comL = qrcode(0, "L");
    comL.addData(URL);
    comL.make();
    expect(comQ.getModuleCount()).toBeGreaterThan(comL.getModuleCount());

    const lados = moduleSides(asText(sticker()));
    // E o adesivo desenha a matriz do Q, não a do L.
    expect(lados[0]).toBeCloseTo((30 * MM) / comQ.getModuleCount(), 2);
  });
});

describe("estrutura do arquivo", () => {
  it("é um PDF válido, com início e fim no lugar", () => {
    const texto = asText(sticker());
    expect(texto.startsWith("%PDF-1.7")).toBe(true);
    expect(texto.trimEnd().endsWith("%%EOF")).toBe(true);
  });

  it("a tabela de referência aponta para os objetos certos", () => {
    const texto = asText(sticker());
    const inicio = texto.indexOf("xref\n0 ");
    // Linha 0 é "xref", linha 1 é "0 N" e linha 2 é a entrada livre: os objetos vêm depois.
    const entradas = texto.slice(inicio).split("\n").slice(3).filter((linha) => linha.endsWith(" n "));
    expect(entradas).toHaveLength(8);
    for (const [index, linha] of entradas.entries()) {
      const posicao = Number(linha.slice(0, 10));
      expect(texto.slice(posicao, posicao + 20)).toMatch(new RegExp(`^${index + 1} 0 obj`));
    }
  });

  it("o /Length do fluxo bate com o fluxo", () => {
    const texto = asText(sticker());
    const declarado = Number(/<< \/Length (\d+) >>/.exec(texto)![1]);
    const corpo = texto.slice(texto.indexOf("stream\n") + 7, texto.indexOf("\nendstream"));
    expect(corpo.length).toBe(declarado);
  });
});

describe("texto com acento", () => {
  it("vai em WinAnsi, e não em UTF-8: senão MISSÃO e sustentável quebram", () => {
    const texto = asText(sticker());
    // Ã = 0xC3 = \303 em octal; á = 0xE1 = \341.
    expect(texto).toContain("MISS\\303O");
    expect(texto).toContain("sustent\\341vel!");
    // O par de bytes do UTF-8 não pode aparecer.
    expect(texto).not.toContain("MISSÃO");
  });

  it("as fontes são as padrão do PDF: nada para embutir na gráfica", () => {
    const texto = asText(sticker());
    expect(texto).toContain("/BaseFont /Helvetica-Bold");
    expect(texto).toContain("/BaseFont /Helvetica");
    expect(texto).toContain("/Encoding /WinAnsiEncoding");
  });
});

describe("o que o adesivo diz", () => {
  it("traz as duas mensagens do modelo", () => {
    const texto = asText(sticker());
    expect(texto).toContain("(LEIA E INICIE) Tj");
    expect(texto).toContain("(Juntos por uma) Tj");
  });

  it("identifica o captador FORA da área colável, para quem vai colar", () => {
    const texto = asText(sticker());
    expect(texto).toContain("EC-001 \\267 Horta dos fundos");
    expect(texto).toContain("TAMANHO REAL");
  });

  it("não imprime o token em lugar nenhum legível: ele existe só dentro do QR", () => {
    const token = "0efae393694a357a699ec21de5cb1248";
    const texto = asText(sticker());
    // O token não aparece como texto desenhável (entre parênteses, operador Tj).
    const desenhados = [...texto.matchAll(/\(([^)]*)\) Tj/g)].map((m) => m[1]).join(" ");
    expect(desenhados).not.toContain(token);
  });
});
