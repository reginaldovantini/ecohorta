import { pdfText, textWidth } from "./qr-sticker";

/*
 * MANUAIS IMPRIMÍVEIS, GERADOS PELA PLATAFORMA.
 *
 * Quem monta um captador não fica na frente do telefone: fica embaixo do tubo,
 * com a mão molhada, ou na frente de um computador gravando uma placa. Nessas
 * duas horas um papel vale mais do que uma tela — e um papel que já traz as
 * medidas DAQUELE tubo vale mais do que um manual genérico.
 *
 * Por isso os manuais não são arquivos guardados numa pasta: são gerados na
 * hora, com o código do captador, a rede dele e o sensor que ele usa. Um
 * arquivo na pasta desatualiza em silêncio; este nunca desatualiza, porque não
 * existe antes de alguém pedir.
 *
 * O escritor de PDF é pequeno de propósito. Uma biblioteca de PDF resolveria
 * mais casos, mas este projeto precisa de texto, listas e caixas — e de um
 * arquivo que abra em qualquer celular de escola pública, inclusive nos que não
 * têm fonte nenhuma instalada. As quatorze fontes padrão do PDF resolvem isso
 * sem embutir nada.
 */

const MM = 72 / 25.4;
const mm = (value: number) => value * MM;
const num = (value: number) => (Math.round(value * 1000) / 1000).toString();

const PAGE = { width: mm(210), height: mm(297) } as const;
const MARGIN = { left: mm(18), right: mm(18), top: mm(20), bottom: mm(20) } as const;
const CONTENT_WIDTH = PAGE.width - MARGIN.left - MARGIN.right;

const SIZE = {
  title: mm(6.4),
  subtitle: mm(3.2),
  heading: mm(4.4),
  body: mm(3.4),
  small: mm(2.9),
  mono: mm(3.1),
} as const;

const LINE = 1.5;

/** Tinta preta no papel barato lê melhor do que cinza. O cinza fica para o acessório. */
const INK = { body: "0.12 0.12 0.12", soft: "0.42 0.42 0.42", accent: "0.05 0.42 0.26" } as const;
const FILL = { box: "0.94 0.96 0.95", warn: "0.99 0.95 0.86" } as const;

export type DocBlock =
  | { kind: "text"; text: string }
  | { kind: "bullets"; items: string[] }
  | { kind: "steps"; items: DocStep[] }
  | { kind: "fields"; items: readonly (readonly [string, string])[] }
  | { kind: "note"; title: string; text: string };

export interface DocStep {
  title: string;
  lines: string[];
  /** Comando ou trecho a digitar. Sai em fonte de largura fixa, dentro de uma caixa. */
  copy?: string;
  /** O erro comum desta etapa. Travar sozinho é o que faz a pessoa desistir. */
  whenItFails?: string;
}

export interface DocSection {
  heading: string;
  blocks: DocBlock[];
}

export interface DocumentInput {
  title: string;
  subtitle: string;
  /** Linha de rodapé, repetida em todas as páginas ao lado do número. */
  footer: string;
  sections: DocSection[];
}

type Op =
  | { op: "text"; x: number; y: number; size: number; font: "F1" | "F2" | "F3"; color: string; text: string }
  | { op: "rect"; x: number; y: number; w: number; h: number; color: string }
  | { op: "line"; x: number; y: number; w: number; color: string };

const larguraTexto = (text: string, size: number, font: "F1" | "F2" | "F3") =>
  font === "F3" ? text.length * 0.6 * size : textWidth(text, { bold: font === "F1" }) * size;

/** Quebra o texto na largura disponível. Palavra que não cabe sozinha vai inteira e estoura. */
function quebrar(text: string, width: number, size: number, font: "F1" | "F2" | "F3"): string[] {
  const palavras = text.split(/\s+/).filter(Boolean);
  if (palavras.length === 0) return [""];
  const linhas: string[] = [];
  let atual = "";
  for (const palavra of palavras) {
    const tentativa = atual ? `${atual} ${palavra}` : palavra;
    if (larguraTexto(tentativa, size, font) <= width || !atual) atual = tentativa;
    else {
      linhas.push(atual);
      atual = palavra;
    }
  }
  if (atual) linhas.push(atual);
  return linhas;
}

/**
 * Monta o documento, quebrando páginas conforme o texto acaba o espaço.
 *
 * A altura é medida enquanto escreve, e não calculada antes: um bloco que não
 * cabe desce inteiro para a próxima página em vez de ficar partido ao meio —
 * um passo de montagem cortado entre duas folhas é um passo que alguém pula.
 */
export function buildDocumentPdf(input: DocumentInput): Uint8Array {
  const paginas: Op[][] = [];
  let pagina: Op[] = [];
  let y = 0;

  const novaPagina = () => {
    if (pagina.length > 0) paginas.push(pagina);
    pagina = [];
    y = PAGE.height - MARGIN.top;
  };
  const cabe = (altura: number) => y - altura >= MARGIN.bottom;
  const garantir = (altura: number) => {
    if (!cabe(altura)) novaPagina();
  };

  const escrever = (
    text: string,
    {
      x = MARGIN.left,
      size = SIZE.body,
      font = "F2",
      color = INK.body as string,
      width = CONTENT_WIDTH,
    }: { x?: number; size?: number; font?: "F1" | "F2" | "F3"; color?: string; width?: number } = {},
  ) => {
    for (const linha of quebrar(text, width, size, font)) {
      garantir(size * LINE);
      y -= size * LINE;
      pagina.push({ op: "text", x, y, size, font, color, text: linha });
    }
  };

  novaPagina();

  // ---- Capa do documento, no topo da primeira página ----
  y -= SIZE.title * 0.2;
  escrever(input.title, { size: SIZE.title, font: "F1", color: INK.body });
  y -= mm(1);
  escrever(input.subtitle, { size: SIZE.subtitle, color: INK.soft });
  y -= mm(4);

  for (const section of input.sections) {
    garantir(SIZE.heading * 3);
    y -= mm(4);
    pagina.push({ op: "line", x: MARGIN.left, y: y + mm(2), w: CONTENT_WIDTH, color: "0.82 0.86 0.84" });
    escrever(section.heading, { size: SIZE.heading, font: "F1", color: INK.accent });
    y -= mm(1.5);

    for (const block of section.blocks) {
      switch (block.kind) {
        case "text":
          escrever(block.text);
          y -= mm(2);
          break;

        case "bullets":
          for (const item of block.items) {
            const recuo = mm(5);
            garantir(SIZE.body * LINE);
            const linhas = quebrar(item, CONTENT_WIDTH - recuo, SIZE.body, "F2");
            y -= SIZE.body * LINE;
            pagina.push({ op: "text", x: MARGIN.left + mm(1), y, size: SIZE.body, font: "F2", color: INK.accent, text: "•" });
            pagina.push({ op: "text", x: MARGIN.left + recuo, y, size: SIZE.body, font: "F2", color: INK.body, text: linhas[0]! });
            for (const linha of linhas.slice(1)) {
              garantir(SIZE.body * LINE);
              y -= SIZE.body * LINE;
              pagina.push({ op: "text", x: MARGIN.left + recuo, y, size: SIZE.body, font: "F2", color: INK.body, text: linha });
            }
            y -= mm(1);
          }
          y -= mm(1.5);
          break;

        case "steps":
          for (const [index, step] of block.items.entries()) {
            // Um passo inteiro ou nenhum: título órfão no pé da página é pior
            // do que meia página em branco.
            garantir(SIZE.body * LINE * 3);
            y -= mm(2);
            escrever(`${index + 1}. ${step.title}`, { size: SIZE.body, font: "F1" });
            for (const linha of step.lines) escrever(linha, { x: MARGIN.left + mm(5), width: CONTENT_WIDTH - mm(5) });
            if (step.copy) {
              const altura = SIZE.mono * LINE + mm(3);
              garantir(altura);
              y -= altura;
              pagina.push({ op: "rect", x: MARGIN.left + mm(5), y, w: CONTENT_WIDTH - mm(5), h: altura, color: FILL.box });
              pagina.push({
                op: "text",
                x: MARGIN.left + mm(7),
                y: y + mm(1.8),
                size: SIZE.mono,
                font: "F3",
                color: INK.body,
                text: step.copy,
              });
              y -= mm(1);
            }
            if (step.whenItFails) {
              escrever(`Se não funcionar: ${step.whenItFails}`, {
                x: MARGIN.left + mm(5),
                width: CONTENT_WIDTH - mm(5),
                size: SIZE.small,
                color: INK.soft,
              });
            }
            y -= mm(1);
          }
          y -= mm(1);
          break;

        case "fields": {
          const rotulo = mm(52);
          for (const [label, value] of block.items) {
            const linhas = quebrar(value, CONTENT_WIDTH - rotulo, SIZE.body, "F2");
            garantir(SIZE.body * LINE * linhas.length);
            y -= SIZE.body * LINE;
            pagina.push({ op: "text", x: MARGIN.left, y, size: SIZE.body, font: "F1", color: INK.body, text: label });
            pagina.push({ op: "text", x: MARGIN.left + rotulo, y, size: SIZE.body, font: "F2", color: INK.body, text: linhas[0]! });
            for (const linha of linhas.slice(1)) {
              garantir(SIZE.body * LINE);
              y -= SIZE.body * LINE;
              pagina.push({ op: "text", x: MARGIN.left + rotulo, y, size: SIZE.body, font: "F2", color: INK.body, text: linha });
            }
            y -= mm(0.8);
          }
          y -= mm(2);
          break;
        }

        case "note": {
          const corpo = quebrar(block.text, CONTENT_WIDTH - mm(8), SIZE.small, "F2");
          const altura = SIZE.small * LINE * (corpo.length + 1) + mm(5);
          garantir(altura);
          const topo = y;
          y -= altura;
          pagina.push({ op: "rect", x: MARGIN.left, y, w: CONTENT_WIDTH, h: altura, color: FILL.warn });
          let linhaY = topo - mm(3) - SIZE.small;
          pagina.push({ op: "text", x: MARGIN.left + mm(4), y: linhaY, size: SIZE.small, font: "F1", color: INK.body, text: block.title });
          for (const linha of corpo) {
            linhaY -= SIZE.small * LINE;
            pagina.push({ op: "text", x: MARGIN.left + mm(4), y: linhaY, size: SIZE.small, font: "F2", color: INK.body, text: linha });
          }
          y -= mm(2);
          break;
        }
      }
    }
  }
  paginas.push(pagina);

  // ---- Rodapé: a folha solta precisa dizer de onde veio ----
  for (const [index, ops] of paginas.entries()) {
    const rodape = `${input.footer}  ·  ${index + 1}/${paginas.length}`;
    ops.push({
      op: "text",
      x: MARGIN.left,
      y: mm(12),
      size: SIZE.small,
      font: "F2",
      color: INK.soft,
      text: rodape,
    });
  }

  return montarPdf(paginas.map(desenhar));
}

/** Converte as operações de uma página no fluxo de conteúdo do PDF. */
function desenhar(ops: Op[]): string {
  const content: string[] = [];
  for (const item of ops) {
    if (item.op === "rect") {
      content.push(`q ${item.color} rg ${num(item.x)} ${num(item.y)} ${num(item.w)} ${num(item.h)} re f Q`);
    } else if (item.op === "line") {
      content.push(`q ${item.color} RG 0.6 w ${num(item.x)} ${num(item.y)} m ${num(item.x + item.w)} ${num(item.y)} l S Q`);
    } else {
      content.push(
        `q ${item.color} rg BT /${item.font} ${num(item.size)} Tf 1 0 0 1 ${num(item.x)} ${num(item.y)} Tm (${pdfText(item.text)}) Tj ET Q`,
      );
    }
  }
  return content.join("\n");
}

function montarPdf(streams: string[]): Uint8Array {
  const primeiraPagina = 3;
  const primeiroConteudo = primeiraPagina + streams.length;
  const fonte = primeiroConteudo + streams.length;

  const kids = streams.map((_, index) => `${primeiraPagina + index} 0 R`).join(" ");
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${kids}] /Count ${streams.length} >>`,
    ...streams.map(
      (_, index) =>
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(PAGE.width)} ${num(PAGE.height)}] ` +
        `/Resources << /Font << /F1 ${fonte} 0 R /F2 ${fonte + 1} 0 R /F3 ${fonte + 2} 0 R >> >> ` +
        `/Contents ${primeiroConteudo + index} 0 R >>`,
    ),
    ...streams.map((stream) => `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`),
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>",
  ];

  let pdf = "%PDF-1.7\n";
  const offsets: number[] = [];
  for (const [index, body] of objects.entries()) {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  }
  const xrefAt = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;

  const bytes = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 0xff;
  return bytes;
}
