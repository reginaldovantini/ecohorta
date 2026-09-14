import type { WaterTotals } from "@/lib/iot/types";

/** Água que pode ser liberada agora: volume medido − reserva mínima − volume já reservado. */
export function availableLiters(volumeLiters: number, reserveLiters: number, reservedLiters = 0) {
  return Math.max(0, volumeLiters - reserveLiters - reservedLiters);
}

/** Taxa de aproveitamento = reutilizado ÷ captado. `null` enquanto nada foi captado. */
export function reuseRate({ capturedLiters, reusedLiters }: WaterTotals) {
  if (capturedLiters <= 0) return null;
  return Math.min(1, reusedLiters / capturedLiters);
}
