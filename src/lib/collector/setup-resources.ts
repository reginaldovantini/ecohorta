/*
 * OS MATERIAIS FIXOS DE CADA ETAPA.
 *
 * Aqui ficam só os arquivos que são IGUAIS para todos os captadores. O que é
 * feito sob medida — o adesivo com o QR daquele tubo, o manual de gravação com
 * a identidade daquela placa — a plataforma gera na hora, e por isso não mora
 * nesta lista: nunca falta, nunca desatualiza.
 *
 * O manual de construção e o guia de gravação saíram desta lista: eles passaram
 * a ser gerados com as medidas do captador de cada escola (setup-guides.ts).
 * Ficaram aqui só as artes de personalização, que são as mesmas para todos e
 * ainda vamos produzir.
 *
 * A etapa aparece desde já, com o material marcado como EM PREPARAÇÃO, e a
 * plataforma nunca oferece um link que não abre.
 *
 * A disponibilidade é declarada aqui, em `ready`, e não descoberta lendo a pasta.
 * Ler a pasta parecia mais esperto, mas obriga o build a rastrear o projeto
 * inteiro para dentro do servidor — e, na prática, não muda nada: publicar um PDF
 * em `public/` exige um commit de qualquer jeito. Então são duas linhas no mesmo
 * commit: o arquivo na pasta e `ready: true` aqui (veja o LEIA-ME da pasta).
 */

import type { SetupStepId } from "./setup-journey";

/** Pasta pública dos materiais. */
export const DOCUMENTS_DIR = "public/documentos-captador";

export interface SetupDocument {
  id: string;
  step: SetupStepId;
  title: string;
  /** O que a pessoa encontra dentro do arquivo. */
  description: string;
  /** Nome do arquivo dentro de DOCUMENTS_DIR. */
  file: string;
  /** O arquivo já está publicado na pasta? */
  ready: boolean;
}

export const SETUP_DOCUMENTS: readonly SetupDocument[] = [
  {
    id: "artes",
    step: "identificacao",
    title: "Artes para personalizar (opcional)",
    description: "Faixas, nome da escola e identidade visual do EcoHorta para colar no tubo. O captador funciona sem elas.",
    file: "artes-personalizacao-captador.pdf",
    ready: false,
  },
] as const;

export interface SetupResource extends SetupDocument {
  /** Caminho público, quando o arquivo existe. `null` enquanto não existe. */
  href: string | null;
  /** Mensagem honesta no lugar do botão, enquanto o material não está pronto. */
  pending: string | null;
}

const resource = (document: SetupDocument): SetupResource => ({
  ...document,
  href: document.ready ? `/documentos-captador/${document.file}` : null,
  pending: document.ready ? null : "Em preparação — este material será publicado aqui.",
});

/** Materiais de uma etapa. */
export const setupResources = (step: SetupStepId): SetupResource[] =>
  SETUP_DOCUMENTS.filter((document) => document.step === step).map(resource);

/** Todos os materiais, para a tela mostrar o caminho inteiro de uma vez. */
export const allSetupResources = (): SetupResource[] => SETUP_DOCUMENTS.map(resource);
