/*
 * ONDE AS FOTOS DO MURAL FICAM.
 *
 * Um bucket PRIVADO: a imagem chega ao aplicativo por URL assinada, com prazo,
 * e nunca por um endereço público que qualquer pessoa com o link abre. São
 * fotos de menores vistas por outras escolas — um bucket público seria um
 * álbum aberto na internet.
 *
 * Os limites moram aqui, num lugar só, porque três partes os usam: o bucket
 * (que os aplica no servidor do Storage), a rota (que recusa antes de subir) e
 * a tela (que avisa antes de a pessoa esperar o envio).
 */

export const WALL_BUCKET = "missoes";

/** 6 MB: uma foto de celular comprimida cabe com folga, e um vídeo não entra. */
export const WALL_MAX_BYTES = 6 * 1024 * 1024;

export const WALL_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export const isWallMimeType = (value: string): boolean => (WALL_MIME_TYPES as readonly string[]).includes(value);

/** Quanto tempo uma URL assinada vale. Curto: o mural é consultado, não arquivado. */
export const WALL_SIGNED_URL_TTL_SECONDS = 60 * 60;

/**
 * Caminho da foto no bucket.
 *
 * Organizado por escola, e nomeado pela EXECUÇÃO: uma missão tem uma foto, e o
 * caminho carrega essa regra. Reenviar a mesma missão sobrescreve o arquivo em
 * vez de deixar lixo órfão.
 */
export function wallImagePath(schoolId: string, executionId: string, mimeType: string): string {
  const extensao = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
  return `escola/${schoolId}/${executionId}.${extensao}`;
}
