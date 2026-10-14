import jsQR from "jsqr";

/*
 * LER O QR COM A CÂMERA DO CELULAR.
 *
 * Dois caminhos, e o motivo de existirem dois é o parque de aparelhos de uma
 * escola pública:
 *
 *   1. `BarcodeDetector` — nativo, rápido, quase sem custo de bateria. Existe no
 *      Chrome do Android, que é a maioria dos celulares da escola.
 *   2. `jsQR` — decodifica em JavaScript a partir dos pixels do vídeo. Mais
 *      pesado, mas funciona no iPhone e em Android antigo, onde o primeiro não
 *      existe. Sem ele, metade da turma ficaria sem fazer missão.
 *
 * O módulo não sabe o que é um captador: ele devolve texto lido. Quem decide se
 * aquele texto é um QR da EcoHorta é o servidor, e é assim que tem de ser — um
 * token conferido no celular é um token conferido pelo celular de quem quiser.
 */

/**
 * O token de um captador: exatamente 32 caracteres hexadecimais, isolados.
 *
 * Os limites nas duas pontas importam — sem eles, um texto com 40 caracteres
 * hexadecimais (o hash de um commit, por exemplo) entregaria um "token" de 32
 * que não é de ninguém.
 */
const TOKEN = /(?<![0-9a-f])([0-9a-f]{32})(?![0-9a-f])/i;

/**
 * Extrai o token do captador de um texto lido.
 *
 * Aceita a URL inteira do adesivo e também o token solto, porque um leitor de
 * QR de terceiros às vezes entrega só o caminho — e porque, no pátio, a pessoa
 * que digita um código à mão digita o código, não a URL.
 */
export function tokenFromScan(text: string): string | null {
  const alvo = TOKEN.exec(text.trim());
  return alvo ? alvo[1]!.toLowerCase() : null;
}

export type CameraFailure = "denied" | "unavailable" | "insecure";

export const CAMERA_FAILURE_MESSAGE: Record<CameraFailure, string> = {
  denied: "A câmera não foi liberada. Autorize nas configurações do navegador e tente de novo.",
  unavailable: "Não encontramos uma câmera neste aparelho.",
  insecure: "A câmera só funciona em endereço seguro (https).",
};

/** Classifica a recusa da câmera no vocabulário de quem está no pátio. */
export function cameraFailure(error: unknown): CameraFailure {
  if (typeof window !== "undefined" && !window.isSecureContext) return "insecure";
  const name = (error as { name?: string } | null)?.name;
  if (name === "NotAllowedError" || name === "SecurityError") return "denied";
  return "unavailable";
}

interface Detector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}

/** O detector nativo, quando o navegador tem um que lê QR. */
export async function nativeDetector(): Promise<Detector | null> {
  const api = (globalThis as { BarcodeDetector?: { new (options: { formats: string[] }): Detector; getSupportedFormats?(): Promise<string[]> } })
    .BarcodeDetector;
  if (!api) return null;
  try {
    const formatos = await api.getSupportedFormats?.();
    if (formatos && !formatos.includes("qr_code")) return null;
    return new api({ formats: ["qr_code"] });
  } catch {
    return null;
  }
}

/**
 * Procura um QR num quadro do vídeo.
 *
 * Devolve o texto lido, ou `null` quando aquele quadro não tinha nada — o que é
 * o caso da enorme maioria deles. A câmera treme, o sol bate no vinil, e a
 * leitura acontece quando acontece.
 */
export async function readFrame(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  detector: Detector | null,
): Promise<string | null> {
  if (video.readyState < 2 || video.videoWidth === 0) return null;

  if (detector) {
    try {
      const encontrados = await detector.detect(video);
      const primeiro = encontrados[0]?.rawValue;
      if (primeiro) return primeiro;
      return null;
    } catch {
      // Detector nativo que falha no meio do caminho: segue pelo jsQR.
    }
  }

  // Reduz o quadro antes de decodificar: a 1280 px a decodificação em
  // JavaScript não acompanha a câmera, e no celular antigo a tela trava.
  const escala = Math.min(1, 480 / Math.max(video.videoWidth, video.videoHeight));
  const largura = Math.round(video.videoWidth * escala);
  const altura = Math.round(video.videoHeight * escala);
  canvas.width = largura;
  canvas.height = altura;
  const contexto = canvas.getContext("2d", { willReadFrequently: true });
  if (!contexto) return null;
  contexto.drawImage(video, 0, 0, largura, altura);
  const pixels = contexto.getImageData(0, 0, largura, altura);
  const lido = jsQR(pixels.data, largura, altura, { inversionAttempts: "dontInvert" });
  return lido?.data ?? null;
}
