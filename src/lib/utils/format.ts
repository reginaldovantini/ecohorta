const decimalFormatters = new Map<number, Intl.NumberFormat>();

function decimalFormatter(digits: number) {
  let formatter = decimalFormatters.get(digits);
  if (!formatter) {
    formatter = new Intl.NumberFormat("pt-BR", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    decimalFormatters.set(digits, formatter);
  }
  return formatter;
}

/** 7.4213 → "7,42" */
export function formatDecimal(value: number, digits = 2) {
  return decimalFormatter(digits).format(value);
}

/** 7.4213 → "7,42 L" */
export function formatLiters(value: number, digits = 2) {
  return `${formatDecimal(value, digits)} L`;
}

/** 0.614 → "61%" */
export function formatPercent(ratio: number) {
  return `${Math.round(ratio * 100)}%`;
}

/** Diferença entre dois instantes (ms) → "agora", "há 8 s", "há 3 min", "há 2 h". */
export function formatRelativeTime(from: number, now: number) {
  const seconds = Math.max(0, Math.round((now - from) / 1000));
  if (seconds < 3) return "agora";
  if (seconds < 60) return `há ${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `há ${minutes} min`;
  return `há ${Math.round(minutes / 60)} h`;
}

/** 95_000 ms → "1 min 35 s" */
export function formatDuration(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes === 0) return `${seconds} s`;
  return seconds === 0 ? `${minutes} min` : `${minutes} min ${seconds} s`;
}
