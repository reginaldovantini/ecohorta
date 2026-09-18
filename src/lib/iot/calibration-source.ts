import type { CalibrationCompletion, CalibrationView } from "@/lib/collector/calibration-view";
import type { CalibrationStepId } from "@/lib/collector/volume-calibration";

/*
 * Fonte de dados da tela de calibração: conversa SOMENTE com a API da plataforma.
 * Consulta a cada 1 s (a mesma consulta mantém o dispositivo no modo de leituras
 * rápidas) e pausa com a aba oculta. Nenhuma distância ou volume sai do navegador:
 * as ações só pedem "registrar a leitura estável desta etapa".
 */

const POLL_MS = 1000;
const RETRY_MS = 3000;

export type CalibrationActionResult = { ok: true } | { ok: false; message: string };

export interface CalibrationSourceState {
  connection: "connecting" | "online" | "error";
  view: CalibrationView | null;
  /** Recusa da API ao carregar (ex.: sem permissão, captador inexistente). */
  error: string | null;
  busy: boolean;
  /** Resultado da última conclusão (ativada ou recusada). */
  lastCompletion: Omit<CalibrationCompletion, "view"> | null;
}

export interface CalibrationSource {
  subscribe(listener: () => void): () => void;
  getState(): CalibrationSourceState;
  getServerState(): CalibrationSourceState;
  /** Inicia a consulta periódica. Retorna a função de parada. */
  start(): () => void;
  startSession(): Promise<CalibrationActionResult>;
  registerPoint(step: CalibrationStepId): Promise<CalibrationActionResult>;
  complete(): Promise<CalibrationActionResult>;
  cancel(): Promise<CalibrationActionResult>;
}

const INITIAL: CalibrationSourceState = { connection: "connecting", view: null, error: null, busy: false, lastCompletion: null };

export function createCalibrationApiSource(
  collectorCode: string,
  { baseUrl = "", onUnauthorized }: { baseUrl?: string; onUnauthorized?: () => void } = {},
): CalibrationSource {
  const listeners = new Set<() => void>();
  const path = `${baseUrl}/api/admin/collectors/${encodeURIComponent(collectorCode)}/calibration`;
  let state = INITIAL;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;

  const commit = (patch: Partial<CalibrationSourceState>) => {
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
    const result = await call<CalibrationView>(path);
    if (result.ok) commit({ connection: "online", view: result.body, error: null });
    else if (result.status === 0) commit({ connection: "error" });
    else commit({ connection: "online", error: result.message });
    schedule(result.ok ? POLL_MS : RETRY_MS);
  }

  async function mutate(url: string, method: "POST" | "DELETE", body?: unknown): Promise<CalibrationActionResult> {
    commit({ busy: true });
    const result = await call<CalibrationView | CalibrationCompletion>(url, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!result.ok) {
      commit({ busy: false });
      return { ok: false, message: result.message };
    }
    if ("fit" in result.body) {
      const { view, ...completion } = result.body;
      commit({ busy: false, view, lastCompletion: completion });
    } else {
      commit({ busy: false, view: result.body });
    }
    return { ok: true };
  }

  return {
    subscribe(listener) {
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

    startSession: () => {
      commit({ lastCompletion: null });
      return mutate(`${path}/session`, "POST");
    },
    registerPoint: (step) => mutate(`${path}/session/points`, "POST", { step }),
    complete: () => mutate(`${path}/session/complete`, "POST"),
    cancel: () => mutate(`${path}/session`, "DELETE"),
  };
}
