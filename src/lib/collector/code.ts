/**
 * Normaliza o código do captador lido do QR ou digitado: "ec001", "EC001", "ec-1" → "EC-001".
 * Retorna `null` se não houver formato reconhecível.
 */
export function normalizeCollectorCode(input: string): string | null {
  const compact = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const match = /^([A-Z]{1,6})(\d{1,6})$/.exec(compact);
  if (!match) return null;
  return `${match[1]}-${match[2]!.padStart(3, "0")}`;
}
