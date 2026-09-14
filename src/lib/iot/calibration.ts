/**
 * Calibração do captador: pares medidos fisicamente (distância do sensor → volume).
 * Não assumimos geometria ideal (ex.: "DN100 = 100 mm internos"): a tabela
 * vem de enchimentos com volumes conhecidos (ver docs/HARDWARE.md §4).
 */
export interface CalibrationPoint {
  distanceMm: number;
  volumeLiters: number;
}

/** Cria o conversor distância → volume por interpolação linear entre pontos da tabela. */
export function createVolumeConverter(points: readonly CalibrationPoint[]) {
  if (points.length < 2) throw new Error("A calibração precisa de pelo menos 2 pontos.");
  const sorted = [...points].sort((a, b) => a.distanceMm - b.distanceMm);
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;

  return (distanceMm: number): number => {
    if (distanceMm <= first.distanceMm) return first.volumeLiters;
    if (distanceMm >= last.distanceMm) return last.volumeLiters;
    for (let i = 1; i < sorted.length; i++) {
      const upper = sorted[i]!;
      if (distanceMm <= upper.distanceMm) {
        const lower = sorted[i - 1]!;
        const t = (distanceMm - lower.distanceMm) / (upper.distanceMm - lower.distanceMm);
        return lower.volumeLiters + t * (upper.volumeLiters - lower.volumeLiters);
      }
    }
    return last.volumeLiters;
  };
}

/** Mediana — o mesmo filtro que o firmware aplica às leituras do VL53L1X. */
export function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}
