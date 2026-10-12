import { describe, expect, it } from "vitest";
import qrcode from "qrcode-generator";
import { buildStickerPdf, STICKER, stickerSize, textWidth } from "./qr-sticker";

const MM = 72 / 25.4;
const URL = "https://ecohorta.vercel.app/q/0efae393694a357a699ec21de5cb1248";

const sticker = (url = URL) =>
  buildStickerPdf({ url, code: "ECO-001", location: "Horta dos fundos", schoolName: "EE Prof.ª Clarinda Mendes de Aquino" });

/** O PDF é latin-1, então dá para lê-lo como texto e inspecionar o conteúdo. */
const ENTER = String.fromCharCode(10);
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
  it("o símbolo do QR tem exatamente 5 cm de lado", () => {
    expect(STICKER.qrMm).toBe(50);
  });

  it("a zona de silêncio passa dos 4 módulos que o padrão exige", () => {
    const qr = qrcode(0, "Q");
    qr.addData(URL);
    qr.make();
    const moduloMm = STICKER.qrMm / qr.getModuleCount();
    expect(STICKER.quietMm / moduloMm).toBeGreaterThanOrEqual(4);
  });

  it("a chamada é grande o bastante para ser lida de longe", () => {
    // Letra de 9 mm: o adesivo é uma chamada à ação num pátio, não uma etiqueta.
    expect(STICKER.callSizeMm).toBeGreaterThanOrEqual(8);
  });

  it("a arte final é fechada em 8 × 15 cm", () => {
    const { widthMm, heightMm } = stickerSize();
    expect([widthMm, heightMm]).toEqual([80, 150]);
  });

  it("a caixa do QR tem a mesma folga nos lados e acima", () => {
    const { widthMm, qrBoxMm, qrMarginMm } = stickerSize();
    expect(qrBoxMm).toBe(STICKER.qrMm + 2 * STICKER.quietMm);
    expect(qrMarginMm).toBe((widthMm - qrBoxMm) / 2);
  });

  it("os módulos ocupam 30 mm no papel, qualquer que seja a versão do QR", () => {
    const texto = asText(sticker());
    const qr = qrcode(0, "Q");
    qr.addData(URL);
    qr.make();
    const modules = qr.getModuleCount();

    // Todos os módulos são desenhados com o mesmo lado; 30 mm divididos por eles.
    const esperado = (STICKER.qrMm * MM) / modules;
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
    expect(lados[0]).toBeCloseTo((STICKER.qrMm * MM) / comQ.getModuleCount(), 2);
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
    expect(entradas).toHaveLength(10);
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
    expect(texto).toContain("ECO-001 \\267 Horta dos fundos");
    expect(texto).toContain("EE Prof.");
  });

  it("manda imprimir em material que pode molhar: o tubo fica ao ar livre", () => {
    const texto = asText(sticker());
    expect(texto).toContain("ADESIVO VINIL");
    expect(texto).toContain("pr\\363prio para molhar"); // próprio
    expect(texto).toContain("lamina\\347\\343o"); // laminação
    // E diz o que acontece se ignorarem, em vez de só proibir.
    expect(texto).toContain("encharca e o QR Code para de ser lido");
  });

  it("separa o que a gráfica faz do que a escola faz", () => {
    const texto = asText(sticker());
    const graficaEm = texto.indexOf("PARA A GR");
    const escolaEm = texto.indexOf("NA ESCOLA");
    expect(graficaEm).toBeGreaterThan(0);
    expect(escolaEm).toBeGreaterThan(graficaEm);
    // Tamanho real é instrução de impressão; régua é conferência de quem recebe.
    expect(texto.indexOf("Tamanho real")).toBeLessThan(escolaEm);
    expect(texto.indexOf("Colar no tubo")).toBeGreaterThan(escolaEm);
  });

  it("não imprime o token em lugar nenhum legível: ele existe só dentro do QR", () => {
    const token = "0efae393694a357a699ec21de5cb1248";
    const texto = asText(sticker());
    // O token não aparece como texto desenhável (entre parênteses, operador Tj).
    const desenhados = [...texto.matchAll(/\(([^)]*)\) Tj/g)].map((m) => m[1]).join(" ");
    expect(desenhados).not.toContain(token);
  });
});

describe("o que NÃO está no PDF", () => {
  it("não pede para o usuário medir nada", () => {
    const texto = asText(sticker());
    // A plataforma é que gera o arquivo; ninguém na escola altera o tamanho,
    // então mandar conferir com régua só acrescentaria ruído.
    // Em WinAnsi, "régua" sai como r\351gua: é essa forma que precisa estar ausente.
    expect(texto).not.toContain("r\\351gua");
    expect(texto).not.toContain("Conferir com");
    expect(texto).not.toMatch(/cm de lado/);
  });

  it("diz que o adesivo pertence a UM captador", () => {
    // "não" sai em WinAnsi: ã é \343.
    expect(asText(sticker())).toContain("n\\343o serve em outro tubo");
  });
});

describe("o texto cabe no adesivo", () => {
  const MMpt = 72 / 25.4;

  /** Posições e corpos de cada texto desenhado, lidos do próprio fluxo do PDF. */
  function textos(texto: string) {
    const encontrados: { x: number; size: number; conteudo: string; bold: boolean; branco: boolean }[] = [];
    let size = 0;
    let bold = false;
    // O texto DENTRO do adesivo é branco; a legenda, fora dele, é escura — e ela
    // pode ser mais larga que o adesivo, porque está na folha.
    let branco = false;
    for (const linha of texto.split(ENTER)) {
      const fonte = /\/(F\d) ([\d.]+) Tf/.exec(linha);
      if (fonte) {
        bold = fonte[1] === "F1";
        size = Number(fonte[2]);
      }
      const desenho = /1 0 0 1 ([\d.]+) [\d.]+ Tm \((.*)\) Tj/.exec(linha);
      if (linha.includes("1 1 1 rg")) branco = true;
      else if (/[\d.]+ [\d.]+ [\d.]+ rg/.test(linha)) branco = false;
      if (desenho) encontrados.push({ x: Number(desenho[1]), size, conteudo: desenho[2]!, bold, branco });
    }
    return encontrados;
  }

  /** Texto do PDF de volta a caracteres: \343 vira ã. */
  const semEscape = (valor: string) =>
    valor.replace(new RegExp("\\\\(\\d{3})", "g"), (_, oct: string) => String.fromCharCode(parseInt(oct, 8)));

  it("a tabela de larguras bate com as métricas publicadas da Adobe", () => {
    // Se a tabela estiver errada, o corpo da letra é calculado errado e o texto
    // estoura a borda — foi exatamente o que aconteceu com uma aproximação.
    expect(textWidth("M", { bold: true })).toBeCloseTo(0.833, 3);
    expect(textWidth("I", { bold: true })).toBeCloseTo(0.278, 3);
    expect(textWidth("W", { bold: true })).toBeCloseTo(0.944, 3);
    expect(textWidth("l")).toBeCloseTo(0.222, 3);
    expect(textWidth("m")).toBeCloseTo(0.833, 3);
    // Acentuada mede o mesmo que a base.
    expect(textWidth("Ã", { bold: true })).toBe(textWidth("A", { bold: true }));
    expect(textWidth("á")).toBe(textWidth("a"));
  });

  it("nenhuma linha do adesivo ultrapassa as bordas", () => {
    const x0 = (210 * MMpt - STICKER.widthMm * MMpt) / 2;
    const direita = x0 + STICKER.widthMm * MMpt;
    const doAdesivo = textos(asText(sticker())).filter((item) => item.branco);
    expect(doAdesivo.length).toBeGreaterThanOrEqual(5);

    for (const { x, size, conteudo, bold } of doAdesivo) {
      const largura = textWidth(semEscape(conteudo), { bold }) * size;
      expect(x, `"${conteudo}" começa antes da borda`).toBeGreaterThanOrEqual(x0);
      expect(x + largura, `"${conteudo}" passa da borda direita`).toBeLessThanOrEqual(direita);
    }
  });

  it("a chamada aproveita a largura disponível, em vez de sobrar espaço", () => {
    const util = (STICKER.widthMm - 2 * STICKER.textMarginMm) * MMpt;
    const chamada = textos(asText(sticker())).find((item) => item.conteudo === "LEIA E INICIE")!;
    const largura = textWidth("LEIA E INICIE", { bold: true }) * chamada.size;
    expect(largura).toBeLessThanOrEqual(util);
    expect(largura).toBeGreaterThan(util * 0.85);
  });

  it("a assinatura ficou grande: é chamada, não letra miúda", () => {
    expect(STICKER.signatureSizeMm).toBeGreaterThanOrEqual(6);
  });
});
