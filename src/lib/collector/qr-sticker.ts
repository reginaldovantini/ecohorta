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

/*
 * Degradê do verde, amostrado da referência: profundo nas pontas e mais aberto
 * no meio. Três paradas em vez de duas — com duas o adesivo fica chapado de um
 * lado e escuro do outro; com a clara no meio ele ganha o brilho que destaca a
 * peça no tubo e faz o texto branco saltar.
 */
const rgb = (hex: number): RGB => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
const VERDE_TOPO = rgb(0x0a5d46);
const VERDE_MEIO = rgb(0x0b7d56);
const VERDE_BASE = rgb(0x05543d);

type RGB = [number, number, number];

/**
 * Geometria do adesivo, em milímetros. Exportada porque é contrato, não detalhe:
 * o tamanho do QR é exigência de projeto e precisa ser verificável por teste.
 */
export const STICKER = {
  /**
   * Lado do símbolo do QR: 5 cm × 5 cm.
   *
   * O adesivo não é uma etiqueta de identificação, é uma CHAMADA. Ele fica num
   * tubo no pátio e precisa parar quem passa a dois metros. Um QR pequeno pede
   * que a pessoa chegue perto para descobrir do que se trata; um grande é lido
   * de longe e já convida.
   */
  qrMm: 50,
  /**
   * Zona de silêncio branca ao redor do símbolo.
   *
   * O padrão exige 4 módulos. Aqui sobra um pouco de propósito: o adesivo vai
   * ser fotografado de lado, com pouca luz e por celular antigo, e a folga é o
   * que separa "leu de primeira" de "tenta de novo".
   */
  quietMm: 6,
  /**
   * Arte final: 8 × 15 cm. É medida fechada, e não resultado do conteúdo — a
   * gráfica corta nessa dimensão e o adesivo ocupa a faixa do tubo que se vê de
   * frente. O conteúdo se acomoda dentro dela.
   */
  widthMm: 80,
  heightMm: 150,
  /** Borda branca externa, que dá o recorte do adesivo. */
  borderMm: 3,
  /** Cantos arredondados. */
  radiusMm: 9,
  /** Margem lateral dos textos. Menor que a do QR, para a chamada crescer mais. */
  textMarginMm: 6,
  /** Corpo da chamada. Grande de propósito: é o que se lê de longe. */
  callSizeMm: 12,
  /** Corpo da assinatura, sob a chamada. */
  signatureSizeMm: 7,
  /** Lado da folha ao lado da assinatura. */
  leafMm: 20,
} as const;

/**
 * Medidas do adesivo. A caixa branca do QR fica centrada na largura, e a mesma
 * folga sobra acima dela — com margem igual nos três lados o QR fica visualmente
 * assentado, em vez de parecer empurrado para um canto.
 */
export const stickerSize = () => {
  const caixaQr = STICKER.qrMm + 2 * STICKER.quietMm;
  return {
    widthMm: STICKER.widthMm,
    heightMm: STICKER.heightMm,
    qrBoxMm: caixaQr,
    /** Margem acima e dos lados da caixa do QR. */
    qrMarginMm: (STICKER.widthMm - caixaQr) / 2,
  };
};

/** A4 em retrato, onde o adesivo é posicionado em tamanho real. */
const PAGE = { widthMm: 210, heightMm: 297 } as const;

// ---------------------------------------------------------------------
// Escrita do PDF
// ---------------------------------------------------------------------
/*
 * Pontuação tipográfica que o PDF conhece por outro número.
 *
 * O PDF escreve texto em WinAnsi, e nela o travessão e o marcador de lista
 * moram ACIMA de 255 no Unicode e abaixo dele no WinAnsi. Sem esta tradução um
 * "—" vira "?" no papel — e foi exatamente o que aconteceu na primeira
 * impressão do manual.
 */
const WIN_ANSI: Record<string, number> = {
  "–": 0x96,
  "—": 0x97,
  "‘": 0x91,
  "’": 0x92,
  "“": 0x93,
  "”": 0x94,
  "•": 0x95,
  "…": 0x85,
};

/** Escapa e traduz um texto para a string literal de um PDF em WinAnsi. */
export function pdfText(value: string): string {
  let out = "";
  for (const character of value) {
    const code = character.codePointAt(0)!;
    const winAnsi = WIN_ANSI[character];
    if (character === "(" || character === ")" || character === "\\") out += `\\${character}`;
    else if (winAnsi !== undefined) out += `\\${winAnsi.toString(8).padStart(3, "0")}`;
    else if (code < 128) out += character;
    else if (code <= 255) out += `\\${code.toString(8).padStart(3, "0")}`;
    else out += "?"; // fora do WinAnsi: nenhum texto do projeto chega aqui
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
  // Base (onde entra o pecíolo) embaixo à esquerda, ponta em cima à direita.
  const [bx, by] = [cx - s * 0.72, cy - s * 0.82];
  const [tx, ty] = [cx + s * 0.78, cy + s * 0.88];
  const partes = [
    "q 1 1 1 rg",
    `${num(bx)} ${num(by)} m`,
    // Lado largo: sai da base, abre, e afina até a ponta.
    `${num(bx - s * 0.5)} ${num(by + s * 0.95)} ${num(cx - s * 0.1)} ${num(ty - s * 0.08)} ${num(tx)} ${num(ty)} c`,
    // Lado estreito, de volta à base.
    `${num(cx + s * 0.62)} ${num(cy - s * 0.12)} ${num(cx + s * 0.1)} ${num(by - s * 0.18)} ${num(bx)} ${num(by)} c`,
    "f Q",
  ];

  // Pecíolo e nervuras, no verde do fundo: é o que faz ler como folha, e não como gota.
  const verde = "0.02 0.32 0.22 RG";
  partes.push(`q ${verde} ${num(size * 0.07)} w 1 J 1 j`);
  partes.push(`${num(bx - s * 0.32)} ${num(by - s * 0.3)} m ${num(bx)} ${num(by)} l S`);
  // Nervura central, levemente curva, acompanhando o eixo da folha.
  partes.push(
    `${num(bx + s * 0.08)} ${num(by + s * 0.06)} m ` +
      `${num(cx - s * 0.1)} ${num(cy - s * 0.02)} ${num(cx + s * 0.3)} ${num(cy + s * 0.3)} ${num(tx - s * 0.12)} ${num(ty - s * 0.12)} c S`,
  );
  partes.push("Q");

  // Três nervuras laterais, saindo da central para o lado largo.
  partes.push(`q ${verde} ${num(size * 0.045)} w 1 J`);
  for (const t of [0.3, 0.5, 0.7]) {
    const mx = bx + (tx - bx) * t;
    const my = by + (ty - by) * t;
    partes.push(`${num(mx)} ${num(my)} m ${num(mx - s * 0.34)} ${num(my + s * 0.26)} l S`);
  }
  partes.push("Q");
  return partes.join(ENTER);
}

export interface StickerInput {
  /** Endereço que o QR carrega. É o token, nunca o código legível. */
  url: string;
  /** Identificação impressa FORA do adesivo, como referência de quem cola. */
  code: string;
  location: string;
  schoolName: string;
  /**
   * O captador ainda é protótipo: o código acima é provisório.
   *
   * O adesivo em si não muda — ele carrega só o QR, e o token não se altera
   * quando o captador assume o número da escola. Quem precisa saber disso é
   * quem arquiva a folha e, meses depois, procura o adesivo do ECO-001 e só
   * encontra uma folha com PROTO-001 escrito.
   */
  provisionalCode?: boolean;
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

  const { widthMm, heightMm, qrBoxMm, qrMarginMm } = stickerSize();
  const pageW = mm(PAGE.widthMm);
  const pageH = mm(PAGE.heightMm);
  const w = mm(widthMm);
  const h = mm(heightMm);
  // Adesivo centrado na horizontal, na parte de cima da folha.
  const x0 = (pageW - w) / 2;
  const y0 = pageH - mm(30) - h;

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
  const qrBoxY = y0 + h - mm(qrMarginMm) - qrBox;
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

  /*
   * A chamada ocupa a largura disponível.
   *
   * O corpo é calculado, não fixado: assim a linha mais longa encosta nas
   * margens e o texto cresce até o limite do adesivo. Um número fixo ou
   * sobraria espaço — desperdiçando o que faz a peça ser vista de longe — ou
   * estouraria a borda no dia em que a frase mudar.
   */
  const larguraUtil = w - mm(STICKER.textMarginMm) * 2;
  const maiorChamada = Math.max(...CHAMADA.map(helveticaBoldWidth));
  const chamadaSize = Math.min(mm(STICKER.callSizeMm), larguraUtil / maiorChamada);

  const folhaLado = mm(STICKER.leafMm);
  const maiorAssinatura = Math.max(...ASSINATURA.map(helveticaWidth));
  const assinaturaSize = Math.min(mm(STICKER.signatureSizeMm), (larguraUtil - folhaLado - mm(4)) / maiorAssinatura);

  /*
   * Os dois blocos de texto são centrados no espaço que sobra abaixo do QR, em
   * vez de descerem de distâncias fixas. Com medida fechada de 8 × 15 cm, o
   * espaço livre depende do conteúdo; distância fixa deixaria um vão embaixo no
   * dia em que a frase encurtasse.
   */
  const alturaChamada = CHAMADA.length * chamadaSize * 1.12;
  const alturaAssinatura = Math.max(ASSINATURA.length * assinaturaSize * 1.25, folhaLado);
  const respiro = mm(8);
  const alturaConteudo = alturaChamada + respiro + alturaAssinatura;
  const espacoLivre = qrBoxY - (y0 + mm(STICKER.borderMm) * 2);
  const topoConteudo = qrBoxY - (espacoLivre - alturaConteudo) / 2;

  let textY = topoConteudo - chamadaSize * 0.86; // da linha de base da primeira linha
  content.push("q 1 1 1 rg BT /F1 " + num(chamadaSize) + " Tf");
  for (const line of CHAMADA) {
    const width = helveticaBoldWidth(line) * chamadaSize;
    content.push(`1 0 0 1 ${num(x0 + (w - width) / 2)} ${num(textY)} Tm (${pdfText(line)}) Tj`);
    textY -= chamadaSize * 1.12;
  }
  content.push("ET Q");

  // ---- Assinatura: folha à esquerda, mensagem à direita ----
  const assinaturaTopo = topoConteudo - alturaChamada - respiro - assinaturaSize * 0.86;
  const blocoAltura = ASSINATURA.length * assinaturaSize * 1.25;
  const textoX = x0 + mm(STICKER.textMarginMm) + folhaLado + mm(4);

  content.push(leaf(x0 + mm(STICKER.textMarginMm) + folhaLado / 2, assinaturaTopo - blocoAltura / 2 + assinaturaSize * 0.5, folhaLado));
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
  /*
   * Instruções separadas por quem executa. Quem leva o arquivo à gráfica não é
   * quem cola no tubo, e misturar as duas coisas numa lista só faz cada um ler
   * a metade errada.
   *
   * O material é a instrução que mais importa: o captador fica ao ar livre,
   * recebendo respingo e sol. Papel comum encharca e o QR para de ler em
   * semanas — e um QR que não lê significa missão que não acontece.
   */
  type Linha = { text: string; bold?: boolean; space?: boolean };
  const legenda: Linha[] = [
    { text: `${input.code} · ${input.location}`, bold: true },
    { text: input.schoolName },
    ...(input.provisionalCode
      ? [{ text: "Código provisório: o captador assume o número da escola quando a calibração" }, { text: "for aceita. O adesivo não muda — imprima e cole uma vez só." }]
      : []),
    { text: "", space: true },
    { text: "PARA A GRÁFICA", bold: true },
    { text: "Imprimir em ADESIVO VINIL branco, próprio para molhar." },
    { text: "Com laminação, contra sol e umidade. Papel comum não serve:" },
    { text: "encharca e o QR Code para de ser lido." },
    { text: `Tamanho real (100%), sem ajustar à página. Cortar nas marcas.` },
    { text: "", space: true },
    { text: "NA ESCOLA", bold: true },
    { text: "Colar no tubo, à altura dos olhos, protegido da chuva direta." },
    { text: "O adesivo é único deste captador: não serve em outro tubo." },
    { text: "", space: true },
    { text: `Adesivo ${num(widthMm)} × ${num(heightMm)} mm · QR ${STICKER.qrMm} × ${STICKER.qrMm} mm` },
  ];
  const legendaSize = mm(3.2);
  let legendaY = y0 - mm(14);
  content.push("q 0.1 0.1 0.1 rg BT");
  for (const linha of legenda) {
    if (linha.space) {
      legendaY -= legendaSize * 0.9;
      continue;
    }
    content.push(`${linha.bold ? "/F1" : "/F2"} ${num(legendaSize)} Tf`);
    content.push(`1 0 0 1 ${num(x0)} ${num(legendaY)} Tm (${pdfText(linha.text)}) Tj`);
    legendaY -= legendaSize * 1.45;
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
    // Degradê na vertical: do topo do adesivo até a base.
    `<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [${num(x0)} ${num(y0 + h)} ${num(x0)} ${num(y0)}] ` +
      "/Function 8 0 R /Extend [true true] >>",
    // Costura duas rampas: topo → meio (claro) → base. O corte em 0,52 põe o
    // ponto mais claro logo abaixo do QR, onde fica a chamada.
    "<< /FunctionType 3 /Domain [0 1] /Functions [9 0 R 10 0 R] /Bounds [0.52] /Encode [0 1 0 1] >>",
    `<< /FunctionType 2 /Domain [0 1] /C0 [${VERDE_TOPO.map(num).join(" ")}] /C1 [${VERDE_MEIO.map(num).join(" ")}] /N 1 >>`,
    `<< /FunctionType 2 /Domain [0 1] /C0 [${VERDE_MEIO.map(num).join(" ")}] /C1 [${VERDE_BASE.map(num).join(" ")}] /N 1 >>`,
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

/*
 * MÉTRICAS DAS FONTES PADRÃO.
 *
 * O corpo do texto é calculado a partir da largura disponível, então a medida
 * precisa ser a de verdade. Uma aproximação já estourou a borda do adesivo uma
 * vez: a letra cabia na conta e não cabia no papel.
 *
 * Valores oficiais da Adobe para Helvetica e Helvetica-Bold, em milésimos do
 * corpo. Letra acentuada mede o mesmo que a sem acento.
 */
const LARGURA_BOLD: Record<string, number> = {
  " ": 278, "!": 333, ",": 278, "-": 333, ".": 278, ":": 333, ";": 333, "(": 333, ")": 333,
  A: 722, B: 722, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 556, K: 722, L: 611, M: 833,
  N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  a: 556, b: 611, c: 556, d: 611, e: 556, f: 333, g: 611, h: 611, i: 278, j: 278, k: 556, l: 278, m: 889,
  n: 611, o: 611, p: 611, q: 611, r: 389, s: 556, t: 333, u: 611, v: 556, w: 778, x: 556, y: 556, z: 500,
};
const LARGURA_REGULAR: Record<string, number> = {
  " ": 278, "!": 278, ",": 278, "-": 333, ".": 278, ":": 278, ";": 278, "(": 333, ")": 333,
  A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 500, K: 667, L: 556, M: 833,
  N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222, k: 500, l: 222, m: 833,
  n: 556, o: 556, p: 556, q: 556, r: 333, s: 500, t: 278, u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
};

/** Acentuada tem a largura da base: Ã mede o mesmo que A. */
const semAcento = (character: string) => character.normalize("NFD").replace(/[̀-ͯ]/g, "") || character;

function medir(text: string, tabela: Record<string, number>): number {
  let total = 0;
  for (const character of text) total += (tabela[semAcento(character)] ?? 556) / 1000;
  return total;
}

const helveticaWidth = (text: string) => medir(text, LARGURA_REGULAR);
const helveticaBoldWidth = (text: string) => medir(text, LARGURA_BOLD);

/**
 * Largura de um texto em múltiplos do corpo. Exportada para o layout poder ser
 * verificado com a mesma régua que ele usa para decidir o tamanho da letra.
 */
export const textWidth = (text: string, { bold = false } = {}) => (bold ? helveticaBoldWidth(text) : helveticaWidth(text));
