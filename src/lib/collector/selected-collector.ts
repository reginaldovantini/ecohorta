/*
 * Captador escolhido neste aparelho (ex.: EC-001 real ou SIM-001 de simulação).
 * É só uma preferência de tela: não é autoridade sobre nenhum dado.
 */

const STORAGE_KEY = "ecohorta:selected-collector";
const listeners = new Set<() => void>();
let selected: string | null | undefined;

function read(): string | null {
  if (selected !== undefined) return selected;
  if (typeof window === "undefined") return null;
  try {
    selected = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    selected = null;
  }
  return selected;
}

export const selectedCollectorStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getSnapshot: read,
  getServerSnapshot: (): string | null => null,
  select(code: string) {
    selected = code;
    try {
      window.localStorage.setItem(STORAGE_KEY, code);
    } catch {
      // Sem armazenamento: vale só nesta aba.
    }
    for (const listener of listeners) listener();
  },
};
