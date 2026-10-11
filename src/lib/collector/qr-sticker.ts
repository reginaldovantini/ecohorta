import qrcode from "qrcode-generator";

/*
 * ADESIVO DO CAPTADOR — PDF pronto para a gráfica.
 *
 * O QR colado no tubo é o que prova presença: sem ele não há missão, e é por ele
 * que a pessoa entra na escola do captador. Então ele precisa sair daqui em
 * VETOR e em TAMANHO EXATO — 30 × 30 mm de símbolo, medidos com régua no papel.
 *
 * Por que o PDF é escrito à mão, sem biblioteca:
 *   - tamanho exato em milímetros, sem passar por pixels;
 *   - os módulos do QR viram retângulos vetoriais, que imprimem nítidos em
 *     qualquer resolução;
 *   - as fontes são as 14 padrão do PDF (Helvetica), que não precisam ser
 *     embutidas e existem em qualquer RIP de gráfica.
 * A única dependência é o codificador do QR, que ninguém deve escrever à mão
 * (Reed-Solomon e máscaras erram em silêncio).
 *
 * Correção de erro Q (25%): o adesivo fica num tubo, ao ar livre, perto de água.
 * Vai sujar e riscar, e precisa continuar lendo.
 */

/** 1 mm em pontos PostScript, a unidade do PDF. */
const MM = 72 / 25.4;
const mm = (value: number) => value * MM;

/** Cores amostradas do adesivo de referência. */
const VERDE_CLARO: RGB = [0x11 / 255, 0x73 / 255, 0x58 / 255];
const VERDE_ESCURO: RGB = [0x02 / 255, 0x52 / 255, 0x39 / 255];

type RGB = [number, number, number];

/**
 * Geometria do adesivo, em milímetros. Exportada porque é contrato, não detalhe:
 * o tamanho do QR é exigência de projeto e precisa ser verificável por teste.
 */
export const STICKER = {
  /** Lado do símbolo do QR. Exigência: 3 cm × 3 cm. */
  qrMm: 30,
  /** Zona de silêncio branca ao redor do símbolo; sem ela o leitor não acha o código. */
  quietMm: 3,
  /** Margem verde entre a caixa branca do QR e a borda do adesivo. */
  paddingMm: 4,
  /** Borda branca externa, que dá o recorte do adesivo. */
  borderMm: 1.6,
  /** Cantos arredondados. */
  radiusMm: 4,
  /** Espaço reservado aos textos abaixo do QR. */
  textBlockMm: 26,
} as const;

/** Largura e altura do adesivo, derivadas da geometria acima. */
export const stickerSize = () => {
  const caixaQr = STICKER.qrMm + 2 * STICKER.quietMm;
  const width = caixaQr + 2 * STICKER.paddingMm;
  const height = STICKER.paddingMm + caixaQr + STICKER.textBlockMm + STICKER.paddingMm;
  return { widthMm: width, heightMm: height, qrBoxMm: caixaQr };
};

/** A4 em retrato, onde o adesivo é posicionado em tamanho real. */
const PAGE = { widthMm: 210, heightMm: 297 } as const;

// ---------------------------------------------------------------------
// Escrita do PDF
// ---------------------------------------------------------------------

/**
 * Texto para o PDF em WinAnsi (latin-1), que é como as fontes padrão esperam
 * receber acentuação. "MISSÃO" e "sustentável" quebrariam em UTF-8.
 */
function pdfText(value: string): string {
  let out = "";
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if (character === "(" || character === ")" || character === "\\") out += `\\${character}`;
    else if (code < 128) out += character;
    else if (code <= 255) out += `\\${code.toString(8).padStart(3, "0")}`;
    else out += "?"; // fora do latin-1: não ocorre nos textos deste adesivo
  }
  return out;
}

const ENTER = String.fromCharCode(10);

const num = (value: number) => (Math.round(value * 1000) / 1000).toString();

/** Caminho de um retângulo de cantos arredondados, em pontos. */
function roundedRect(x: number, y: number, w: number, h: number, r: number): string {
  const k = r * 0.5523; // aproximação de quarto de círculo por Bézier
  return [
    `${num(x + r)} ${num(y)} m`,
    `${num(x + w - r)} ${num(y)} l`,
    `${num(x + w - r + k)} ${num(y)} ${num(x + w)} ${num(y + r - k)} ${num(x + w)} ${num(y + r)} c`,
    `${num(x + w)} ${num(y + h - r)} l`,
    `${num(x + w)} ${num(y + h - r + k)} ${num(x + w - r + k)} ${num(y + h)} ${num(x + w - r)} ${num(y + h)} c`,
    `${num(x + r)} ${num(y + h)} l`,
    `${num(x + r - k)} ${num(y + h)} ${num(x)} ${num(y + h - r + k)} ${num(x)} ${num(y + h - r)} c`,
    `${num(x)} ${num(y + r)} l`,
    `${num(x)} ${num(y + r - k)} ${num(x + r - k)} ${num(y)} ${num(x + r)} ${num(y)} c`,
    "h",
  ].join("\n");
}

/**
 * Folhinha branca ao lado da última mensagem, como no adesivo de referência.
 * Duas curvas simétricas entre as duas pontas, na diagonal, mais a nervura.
 */
function leaf(cx: number, cy: number, size: number): string {
  const s = size / 2;
  // Pontas da folha, na diagonal de baixo-esquerda para cima-direita.
  const [ax, ay] = [cx - s, cy - s];
  const [bx, by] = [cx + s, cy + s];
  return [
    "q 1 1 1 rg",
    `${num(ax)} ${num(ay)} m`,
    // Barriga de cima
    `${num(cx - s * 1.15)} ${num(cy + s * 0.45)} ${num(cx - s * 0.2)} ${num(cy + s * 1.15)} ${num(bx)} ${num(by)} c`,
    // Barriga de baixo, de volta à primeira ponta
    `${num(cx + s * 1.15)} ${num(cy - s * 0.45)} ${num(cx + s * 0.2)} ${num(cy - s * 1.15)} ${num(ax)} ${num(ay)} c`,
    "f Q",
    // Nervura central, no verde do fundo
    `q 0.02 0.32 0.22 RG ${num(size * 0.09)} w 1 J`,
    `${num(ax + s * 0.25)} ${num(ay + s * 0.25)} m ${num(bx - s * 0.2)} ${num(by - s * 0.2)} l S Q`,
  ].join(ENTER);
}

export interface StickerInput {
  /** Endereço que o QR carrega. É o token, nunca o código legível. */
  url: string;
  /** Identificação impressa FORA do adesivo, como referência de quem cola. */
  code: string;
  location: string;
  schoolName: string;
}

/** Linhas do adesivo, iguais às do modelo. */
const CHAMADA = ["LEIA E INICIE", "SUA MISSÃO"];
const ASSINATURA = ["Juntos por uma", "escola mais", "sustentável!"];

/**
 * Monta o PDF do adesivo: A4 em tamanho real, com marcas de corte e a
 * identificação do captador fora da área colável.
 *
 * A4 e não o tamanho do adesivo porque o arquivo serve às duas pontas: a gráfica
 * corta pelas marcas, e quem imprime na escola consegue usar o papel que tem —
 * desde que imprima em 100%, o que está escrito na própria folha.
 */
export function buildStickerPdf(input: StickerInput): Uint8Array {
  const qr = qrcode(0, "Q");
  qr.addData(input.url);
  qr.make();
  const modules = qr.getModuleCount();

  const { widthMm, heightMm, qrBoxMm } = stickerSize();
  const pageW = mm(PAGE.widthMm);
  const pageH = mm(PAGE.heightMm);
  const w = mm(widthMm);
  const h = mm(heightMm);
  // Adesivo centrado na horizontal, na parte de cima da folha.
  const x0 = (pageW - w) / 2;
  const y0 = pageH - mm(45) - h;

  const content: string[] = [];

  // ---- Fundo verde com gradiente, recortado no retângulo arredondado ----
  content.push("q");
  content.push(roundedRect(x0, y0, w, h, mm(STICKER.radiusMm)));
  content.push("W n");
  content.push("/S1 sh");
  content.push("Q");

  // ---- Borda branca externa ----
  content.push("q 1 1 1 RG");
  content.push(`${num(mm(STICKER.borderMm))} w`);
  const inset = mm(STICKER.borderMm) / 2;
  content.push(roundedRect(x0 + inset, y0 + inset, w - 2 * inset, h - 2 * inset, mm(STICKER.radiusMm) - inset));
  content.push("S Q");

  // ---- Caixa branca do QR (zona de silêncio) ----
  const qrBox = mm(qrBoxMm);
  const qrBoxX = x0 + (w - qrBox) / 2;
  const qrBoxY = y0 + h - mm(STICKER.paddingMm) - qrBox;
  content.push(`q 1 1 1 rg ${num(qrBoxX)} ${num(qrBoxY)} ${num(qrBox)} ${num(qrBox)} re f Q`);

  // ---- Módulos do QR: exatamente 30 × 30 mm ----
  const qrSide = mm(STICKER.qrMm);
  const moduleSize = qrSide / modules;
  const qrX = qrBoxX + mm(STICKER.quietMm);
  const qrY = qrBoxY + mm(STICKER.quietMm);
  content.push("q 0 0 0 rg");
  for (let row = 0; row < modules; row++) {
    for (let col = 0; col < modules; col++) {
      if (!qr.isDark(row, col)) continue;
      const mx = qrX + col * moduleSize;
      // A origem do PDF é embaixo; a linha 0 do QR é em cima.
      const my = qrY + qrSide - (row + 1) * moduleSize;
      content.push(`${num(mx)} ${num(my)} ${num(moduleSize)} ${num(moduleSize)} re`);
    }
  }
  content.push("f Q");

  // ---- Chamada: LEIA E INICIE / SUA MISSÃO ----
  const chamadaSize = mm(4.6);
  let textY = qrBoxY - mm(5.5);
  content.push("q 1 1 1 rg BT /F1 " + num(chamadaSize) + " Tf");
  for (const line of CHAMADA) {
    const width = helveticaBoldWidth(line) * chamadaSize;
    content.push(`1 0 0 1 ${num(x0 + (w - width) / 2)} ${num(textY)} Tm (${pdfText(line)}) Tj`);
    textY -= chamadaSize * 1.15;
  }
  content.push("ET Q");

  // ---- Assinatura com a folhinha ----
  const assinaturaSize = mm(2.9);
  const blocoAltura = ASSINATURA.length * assinaturaSize * 1.25;
  const assinaturaTopo = textY - mm(3);
  const textoX = x0 + w * 0.36;
  content.push(leaf(x0 + w * 0.21, assinaturaTopo - blocoAltura / 2 + assinaturaSize * 0.4, mm(5)));
  content.push("q 1 1 1 rg BT /F2 " + num(assinaturaSize) + " Tf");
  let assinaturaY = assinaturaTopo;
  for (const line of ASSINATURA) {
    content.push(`1 0 0 1 ${num(textoX)} ${num(assinaturaY)} Tm (${pdfText(line)}) Tj`);
    assinaturaY -= assinaturaSize * 1.25;
  }
  content.push("ET Q");

  // ---- Marcas de corte, fora do adesivo ----
  const marca = mm(4);
  const folga = mm(3);
  content.push("q 0.6 0.6 0.6 RG 0.4 w");
  for (const [cx, cy, dx, dy] of [
    [x0 - folga, y0 - folga, -1, -1],
    [x0 + w + folga, y0 - folga, 1, -1],
    [x0 - folga, y0 + h + folga, -1, 1],
    [x0 + w + folga, y0 + h + folga, 1, 1],
  ] as const) {
    content.push(`${num(cx)} ${num(cy)} m ${num(cx + dx * marca)} ${num(cy)} l S`);
    content.push(`${num(cx)} ${num(cy)} m ${num(cx)} ${num(cy + dy * marca)} l S`);
  }
  content.push("Q");

  // ---- Identificação e instrução, fora da área colável ----
  const legenda = [
    `${input.code} · ${input.location}`,
    input.schoolName,
    "",
    `Adesivo ${num(widthMm)} × ${num(heightMm)} mm · QR ${STICKER.qrMm} × ${STICKER.qrMm} mm`,
    "Imprima em TAMANHO REAL (100%), sem ajustar à página.",
    "Confira com uma régua: o QR precisa medir 3 cm de lado.",
    "Cole no tubo, à altura dos olhos, protegido da chuva direta.",
  ];
  const legendaSize = mm(3.2);
  let legendaY = y0 - mm(16);
  content.push("q 0.1 0.1 0.1 rg BT");
  for (const [index, line] of legenda.entries()) {
    if (!line) {
      legendaY -= legendaSize * 0.8;
      continue;
    }
    const fonte = index === 0 ? "/F1" : "/F2";
    content.push(`${fonte} ${num(legendaSize)} Tf`);
    content.push(`1 0 0 1 ${num(x0)} ${num(legendaY)} Tm (${pdfText(line)}) Tj`);
    legendaY -= legendaSize * 1.5;
  }
  content.push("ET Q");

  const stream = content.join("\n");

  // ---- Objetos do PDF ----
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(pageW)} ${num(pageH)}] ` +
      "/Resources << /Font << /F1 5 0 R /F2 6 0 R >> /Shading << /S1 7 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    `<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [${num(x0)} ${num(y0 + h)} ${num(x0 + w)} ${num(y0)}] ` +
      "/Function 8 0 R /Extend [true true] >>",
    `<< /FunctionType 2 /Domain [0 1] /C0 [${VERDE_CLARO.map(num).join(" ")}] /C1 [${VERDE_ESCURO.map(num).join(" ")}] /N 1 >>`,
  ];

  let pdf = "%PDF-1.7\n";
  const offsets: number[] = [];
  for (const [index, body] of objects.entries()) {
    offsets.push(byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  }
  const xrefAt = byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;

  return latin1Bytes(pdf);
}

/** O PDF é latin-1: cada caractere vira um byte. */
function latin1Bytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i++) bytes[i] = value.charCodeAt(i) & 0xff;
  return bytes;
}

const byteLength = (value: string) => value.length;

/**
 * Largura aproximada de um texto em Helvetica-Bold, em múltiplos do corpo.
 * Serve só para centralizar; não precisa da métrica exata da fonte.
 */
function helveticaBoldWidth(text: string): number {
  let total = 0;
  for (const character of text) {
    if (character === " ") total += 0.278;
    else if ("Iiljtfr".includes(character)) total += 0.33;
    else if ("MWmw".includes(character)) total += 0.889;
    else total += 0.611;
  }
  return total;
}
