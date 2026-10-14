/*
 * A LEITURA DO QR, NO VOCABULÁRIO DAS DUAS PONTAS.
 *
 * Estes nomes e estas frases são usados pelo servidor, que decide, e pela tela,
 * que explica. Moram aqui, e não junto do serviço, por um motivo prático: o
 * serviço fala com o banco e usa `node:crypto`, e nada disso pode atravessar
 * para o pacote que roda no celular do estudante.
 */

/** Por que uma leitura não autoriza a liberação. */
export type ScanRejection = "not_found" | "other_person" | "other_collector" | "expired" | "already_used";

/**
 * O que a pessoa lê quando a leitura é recusada.
 *
 * Cada frase diz O QUE ACONTECEU, em quatro ou cinco palavras, porque ela
 * aparece numa tela de celular com alguém em pé na frente de um tubo. O que
 * fazer a respeito é a tela que diz, logo abaixo.
 */
export const SCAN_REJECTION_MESSAGE: Record<ScanRejection, string> = {
  not_found: "Leitura não reconhecida",
  other_person: "Esta leitura é de outra pessoa",
  other_collector: "Este QR é de outro captador",
  expired: "A leitura expirou — leia junto ao captador",
  already_used: "Esta leitura já foi usada",
};

/**
 * Quanto tempo uma leitura vale.
 *
 * Curto de propósito: a leitura não é uma senha, é uma PROVA DE PRESENÇA. Se
 * valesse horas, provaria que a pessoa passou pelo captador em algum momento do
 * dia — e a missão deixaria de acontecer no pátio.
 */
export const SCAN_VALIDITY_MS = 5 * 60_000;
