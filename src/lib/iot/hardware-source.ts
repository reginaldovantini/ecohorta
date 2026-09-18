import type { DistanceSensorModel } from "@/lib/collector/distance-sensors";
import type { HardwareChangeRecord, HardwareView } from "@/lib/collector/hardware-view";

/*
 * Fonte de dados da tela Ligações: conversa SOMENTE com a API da plataforma.
 * Consulta a cada 3 s (mostra o sensor que o firmware informa) e pausa com a aba oculta.
 * A troca do sensor exige a confirmação explícita do sensor físico instalado.
 */

const POLL_MS = 3000;
const RETRY_MS = 5000;

export type HardwareActionResult<T = undefined> = { ok: true; value: T } | { ok: false; message: string };

export interface HardwareSourceState {
  connection: "connecting" | "online" | "error";
  view: HardwareView | null;
  error: string | null;
  busy: boolean;
}

export interface SensorChangeInput {
  distance_sensor: DistanceSensorModel;
  confirm_physical_match: true;
  note: string | null;
}

const INITIAL: HardwareSourceState = { connection: "connecting", view: null, error: null, busy: false };

export function createHardwareApiSource(collectorCode: string, { baseUrl = "", onUnauthorized }: { baseUrl?: string; onUnauthorized?: () => void } = {}) {
  const listeners = new Set<() => void>();
  const path = `${baseUrl}/api/admin/collectors/${encodeURIComponent(collectorCode)}/hardware`;
  let state = INITIAL;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;

  const commit = (patch: Partial<HardwareSourceState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };

  async function call<T>(init?: RequestInit): Promise<{ ok: true; body: T } | { ok: false; status: number; message: string }> {
    try {
      const response = await fetch(path, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
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
    const result = await call<HardwareView>();
    if (result.ok) commit({ connection: "online", view: result.body, error: null });
    else if (result.status === 0) commit({ connection: "error" });
    else commit({ connection: "online", error: result.message });
    schedule(result.ok ? POLL_MS : RETRY_MS);
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

    async changeSensor(input: SensorChangeInput): Promise<HardwareActionResult<HardwareChangeRecord>> {
      commit({ busy: true });
      const result = await call<{ view: HardwareView; change: HardwareChangeRecord }>({ method: "PUT", body: JSON.stringify(input) });
      if (!result.ok) {
        commit({ busy: false });
        return { ok: false, message: result.message };
      }
      commit({ busy: false, view: result.body.view });
      return { ok: true, value: result.body.change };
    },
  };
}

export type HardwareSource = ReturnType<typeof createHardwareApiSource>;
