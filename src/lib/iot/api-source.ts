import type { CollectorDataSource, SimulationRequest } from "./data-source";
import type { CollectorSnapshot, ConnectionState, DispenseCommand, DispenseProgress } from "./types";

/*
 * Fonte de dados do app: conversa SOMENTE com a API da plataforma.
 * Leitura por polling adaptativo (1 s parado, 400 ms durante uma liberação,
 * pausa com a aba oculta). Nos Dias 6–7 pode ser trocada por Supabase Realtime
 * mantendo a mesma interface.
 */

const IDLE_POLL_MS = 1000;
const ACTIVE_POLL_MS = 400;
const RETRY_POLL_MS = 3000;
const POST_ATTEMPTS = 3;
const TERMINAL = new Set<DispenseProgress["status"]>(["COMPLETED", "FAILED", "CANCELLED"]);

class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function createApiSource(baseUrl = "") {
  const listeners = new Set<() => void>();
  let connection: ConnectionState = "connecting";
  let codes: readonly string[] = [];
  const snapshots = new Map<string, CollectorSnapshot>();
  const snapshotJson = new Map<string, string>();
  const progress = new Map<string, DispenseProgress>();
  const commandCollector = new Map<string, string>();
  /** Comandos cujo envio falhou por rede: continuamos verificando se chegaram ao servidor. */
  const unconfirmed = new Set<string>();
  const posting = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let polling = false;

  const emit = () => {
    for (const listener of listeners) listener();
  };

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(baseUrl + path, {
      cache: "no-store",
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) throw new ApiError(response.status, body.error ?? `HTTP ${response.status}`);
    return body as T;
  }

  const hasActiveCommand = () => [...progress.values()].some((item) => !TERMINAL.has(item.status));

  function schedule(delayMs: number) {
    if (timer) clearTimeout(timer);
    timer = running ? setTimeout(() => void poll(), delayMs) : null;
  }

  async function refreshCommand(commandId: string) {
    const code = commandCollector.get(commandId);
    if (!code || posting.has(commandId)) return false;
    try {
      const next = await request<DispenseProgress>(`/api/collectors/${encodeURIComponent(code)}/commands/${commandId}`);
      unconfirmed.delete(commandId);
      if (JSON.stringify(next) === JSON.stringify(progress.get(commandId))) return false;
      progress.set(commandId, next);
      return true;
    } catch (error) {
      // 404 para um envio que falhou: o comando nunca chegou — a falha de conexão é definitiva.
      if (error instanceof ApiError && error.status === 404) {
        unconfirmed.delete(commandId);
        return false;
      }
      throw error;
    }
  }

  async function poll() {
    if (polling) return;
    polling = true;
    let changed = false;
    try {
      if (codes.length === 0) {
        const { collectors } = await request<{ collectors: { code: string }[] }>("/api/collectors");
        codes = collectors.map((collector) => collector.code);
        changed = true;
      }
      for (const code of codes) {
        const snapshot = await request<CollectorSnapshot>(`/api/collectors/${encodeURIComponent(code)}`);
        const json = JSON.stringify(snapshot);
        if (snapshotJson.get(code) !== json) {
          snapshotJson.set(code, json);
          snapshots.set(code, snapshot);
          changed = true;
        }
      }
      for (const [commandId, item] of progress) {
        if (!TERMINAL.has(item.status) || unconfirmed.has(commandId)) {
          changed = (await refreshCommand(commandId)) || changed;
        }
      }
      if (connection !== "online") {
        connection = "online";
        changed = true;
      }
    } catch {
      if (connection !== "error") {
        connection = "error";
        changed = true;
      }
    } finally {
      polling = false;
    }
    if (changed) emit();
    schedule(connection === "error" ? RETRY_POLL_MS : hasActiveCommand() || unconfirmed.size > 0 ? ACTIVE_POLL_MS : IDLE_POLL_MS);
  }

  const source: CollectorDataSource & { start: () => () => void } = {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getConnectionState: () => connection,
    getCollectorCodes: () => codes,
    getSnapshot: (code) => snapshots.get(code) ?? null,
    getProgress: (commandId) => progress.get(commandId) ?? null,

    dispense(command: DispenseCommand) {
      if (progress.has(command.commandId)) return;
      const code = command.collectorCode;
      const queued: DispenseProgress = {
        commandId: command.commandId,
        status: "QUEUED",
        targetLiters: command.targetLiters,
        deliveredLiters: 0,
        startVolumeLiters: null,
        endVolumeLiters: null,
        queuedAt: Date.now(),
        startedAt: null,
        finishedAt: null,
        failure: null,
        cancelRequested: false,
        origin: snapshots.get(code)?.telemetry.origin ?? "simulation",
      };
      progress.set(command.commandId, queued);
      commandCollector.set(command.commandId, code);
      posting.add(command.commandId);
      emit();

      const body = JSON.stringify({
        command_id: command.commandId,
        execution_id: command.executionId,
        mission_id: command.missionId,
        target_liters: command.targetLiters,
      });

      void (async () => {
        for (let attempt = 1; attempt <= POST_ATTEMPTS; attempt++) {
          try {
            // Reenviar é seguro: a plataforma é idempotente por command_id.
            const created = await request<DispenseProgress>(`/api/collectors/${encodeURIComponent(code)}/commands`, {
              method: "POST",
              body,
            });
            progress.set(command.commandId, created);
            break;
          } catch (error) {
            if (error instanceof ApiError || attempt === POST_ATTEMPTS) {
              progress.set(command.commandId, {
                ...queued,
                status: "FAILED",
                failure: "CONNECTION_ERROR",
                finishedAt: Date.now(),
              });
              if (!(error instanceof ApiError)) unconfirmed.add(command.commandId);
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 600 * attempt));
          }
        }
        posting.delete(command.commandId);
        emit();
        schedule(ACTIVE_POLL_MS);
      })();
    },

    cancel(commandId: string) {
      const item = progress.get(commandId);
      const code = commandCollector.get(commandId);
      if (!item || !code || TERMINAL.has(item.status) || item.cancelRequested) return;
      progress.set(commandId, { ...item, cancelRequested: true });
      emit();
      void request<DispenseProgress>(`/api/collectors/${encodeURIComponent(code)}/commands/${commandId}/cancel`, {
        method: "POST",
      })
        .then((next) => progress.set(commandId, next))
        .catch(() => undefined) // o próximo polling mostra o estado real
        .finally(() => {
          emit();
          schedule(ACTIVE_POLL_MS);
        });
    },

    async updateSimulation(collectorCode: string, simulation: SimulationRequest) {
      try {
        await request(`/api/collectors/${encodeURIComponent(collectorCode)}/simulation`, {
          method: "POST",
          body: JSON.stringify(simulation),
        });
        schedule(0);
        return { ok: true };
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : "Falha ao atualizar a simulação." };
      }
    },

    /** Inicia o polling. Retorna a função de parada. */
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
  };

  return source;
}
