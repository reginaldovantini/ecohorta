import type { CollectorSetupView, FirmwarePackage } from "@/lib/server/collector-setup-service";
import type { SetupStepId } from "@/lib/collector/setup-journey";

/*
 * Fonte de dados da tela de construção do captador.
 *
 * Consulta periódica por um motivo concreto: a etapa de conexão não é marcada
 * por ninguém — ela acende quando o ESP32 fala. Quem está instalando está com a
 * placa na mão e o celular na outra, e não vai pensar em atualizar a página.
 * A tela precisa mudar sozinha no segundo em que a placa conectar.
 *
 * O intervalo é folgado (5 s): não há nada aqui que mude em tempo real, e a
 * consulta pausa com a aba oculta.
 */

const POLL_MS = 5000;
const RETRY_MS = 8000;

export type SetupActionResult = { ok: true } | { ok: false; message: string };

export interface SetupSourceState {
  connection: "connecting" | "online" | "error";
  view: CollectorSetupView | null;
  /** Recusa da API ao carregar (sem permissão, captador inexistente). */
  error: string | null;
  busy: boolean;
  /**
   * O pacote do firmware gerado nesta sessão. Fica só aqui, na memória da aba:
   * o token em claro não é guardado em lugar nenhum.
   */
  firmware: FirmwarePackage | null;
  /** Recusa da geração do firmware (ex.: já existe placa enviando dados). */
  firmwareWarning: string | null;
}

export interface SetupSource {
  subscribe(listener: () => void): () => void;
  getState(): SetupSourceState;
  getServerState(): SetupSourceState;
  /** Inicia a consulta periódica. Devolve a função de parada. */
  start(): () => void;
  markStep(step: SetupStepId, done: boolean): Promise<SetupActionResult>;
  issueFirmware(confirmReplacement: boolean): Promise<SetupActionResult>;
  dismissFirmwareWarning(): void;
}

const INITIAL: SetupSourceState = {
  connection: "connecting",
  view: null,
  error: null,
  busy: false,
  firmware: null,
  firmwareWarning: null,
};

export function createSetupApiSource(
  collectorCode: string,
  { baseUrl = "", onUnauthorized }: { baseUrl?: string; onUnauthorized?: () => void } = {},
): SetupSource {
  const listeners = new Set<() => void>();
  const base = `${baseUrl}/api/admin/collectors/${encodeURIComponent(collectorCode)}`;
  let state = INITIAL;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;

  const commit = (patch: Partial<SetupSourceState>) => {
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
    const result = await call<CollectorSetupView>(`${base}/setup`);
    if (result.ok) commit({ connection: "online", view: result.body, error: null });
    else if (result.status === 0) commit({ connection: "error" });
    else commit({ connection: "online", error: result.message });
    schedule(result.ok ? POLL_MS : RETRY_MS);
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

    async markStep(step, done) {
      commit({ busy: true });
      const result = await call<CollectorSetupView>(`${base}/setup`, { method: "POST", body: JSON.stringify({ step, done }) });
      commit(result.ok ? { busy: false, view: result.body } : { busy: false });
      return result.ok ? { ok: true } : { ok: false, message: result.message };
    },

    /**
     * Gera o programa da placa. Recusa com 409 quando já existe placa enviando
     * dados: a tela mostra o aviso e só então oferece "gerar mesmo assim".
     */
    async issueFirmware(confirmReplacement) {
      commit({ busy: true, firmwareWarning: null });
      const result = await call<FirmwarePackage>(`${base}/firmware`, {
        method: "POST",
        body: JSON.stringify({ confirmReplacement }),
      });
      if (!result.ok) {
        commit({ busy: false, firmwareWarning: result.message });
        return { ok: false, message: result.message };
      }
      commit({ busy: false, firmware: result.body });
      schedule(0);
      return { ok: true };
    },

    dismissFirmwareWarning() {
      commit({ firmwareWarning: null });
    },
  };
}
