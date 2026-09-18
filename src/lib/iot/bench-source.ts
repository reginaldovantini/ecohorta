import type { BenchView, SensorObservationRecord, ValidationRecord } from "@/lib/collector/bench-view";

/*
 * Fonte de dados da tela de bancada: conversa SOMENTE com a API da plataforma.
 * Consulta a cada 1 s (mantém o dispositivo enviando leituras rápidas e prolonga
 * um ensaio em andamento) e pausa com a aba oculta. O navegador nunca envia
 * distância nem volume calculado: só a condição do ensaio e o volume físico conhecido.
 */

const POLL_MS = 1000;
const RETRY_MS = 3000;

export type BenchActionResult<T = undefined> = { ok: true; value: T } | { ok: false; message: string };

export interface BenchSourceState {
  connection: "connecting" | "online" | "error";
  view: BenchView | null;
  error: string | null;
  busy: boolean;
}

export interface ObservationInput {
  condition: SensorObservationRecord["condition"];
  reference_height_mm: number | null;
  note: string | null;
}

export interface ValidationInput {
  known_volume_liters: number;
  measurement_method: ValidationRecord["measurementMethod"];
  known_mass_kg: number | null;
  note: string | null;
}

const INITIAL: BenchSourceState = { connection: "connecting", view: null, error: null, busy: false };

export function createBenchApiSource(collectorCode: string, { baseUrl = "", onUnauthorized }: { baseUrl?: string; onUnauthorized?: () => void } = {}) {
  const listeners = new Set<() => void>();
  const path = `${baseUrl}/api/admin/collectors/${encodeURIComponent(collectorCode)}/bench`;
  let state = INITIAL;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;

  const commit = (patch: Partial<BenchSourceState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };

  async function call<T>(url: string, init?: RequestInit): Promise<{ ok: true; body: T } | { ok: false; status: number; message: string }> {
    try {
      const response = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
      const body = (await response.json().catch(() => ({}))) as T & { error?: string };
      if (response.status === 401) onUnauthorized?.();
      if (!response.ok) return { ok: false, status: response.status, message: body.error ?? `HTTP ${response.status}` };
      return { ok: true, body };
    } catch {
      return { ok: false, status: 0, message: "Sem conexão com a plataforma." };
    }
  }

  function schedule(delayMs: number) {
    if (timer) clearTimeout(timer);
    timer = running ? setTimeout(() => void poll(), delayMs) : null;
  }

  async function poll() {
    const result = await call<BenchView>(path);
    if (result.ok) commit({ connection: "online", view: result.body, error: null });
    else if (result.status === 0) commit({ connection: "error" });
    else commit({ connection: "online", error: result.message });
    schedule(result.ok ? POLL_MS : RETRY_MS);
  }

  async function mutate<T>(url: string, method: "POST" | "DELETE", body: unknown, pick: (response: T) => BenchView): Promise<BenchActionResult<T>> {
    commit({ busy: true });
    const result = await call<T>(url, { method, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!result.ok) {
      commit({ busy: false });
      return { ok: false, message: result.message };
    }
    commit({ busy: false, view: pick(result.body) });
    return { ok: true, value: result.body };
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getState: () => state,
    getServerState: () => INITIAL,

    start() {
      running = true;
      const onVisibility = () => {
        if (document.hidden) {
          if (timer) clearTimeout(timer);
          timer = null;
        } else {
          schedule(0);
        }
      };
      document.addEventListener("visibilitychange", onVisibility);
      schedule(0);
      return () => {
        running = false;
        if (timer) clearTimeout(timer);
        document.removeEventListener("visibilitychange", onVisibility);
      };
    },

    startBench: () => mutate<BenchView>(path, "POST", undefined, (view) => view),
    endBench: () => mutate<BenchView>(path, "DELETE", undefined, (view) => view),
    observe: (input: ObservationInput) =>
      mutate<{ view: BenchView; observation: SensorObservationRecord }>(`${path}/observations`, "POST", input, (response) => response.view),
    validate: (input: ValidationInput) =>
      mutate<{ view: BenchView; validation: ValidationRecord }>(`${path}/validations`, "POST", input, (response) => response.view),
  };
}

export type BenchSource = ReturnType<typeof createBenchApiSource>;
