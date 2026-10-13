import type { AdminGrant } from "@/lib/server/admin-grants";
import type { PartnershipRequest } from "@/lib/server/partnership-service";

/*
 * Fonte de dados da mesa de controle da plataforma.
 *
 * Mesmo desenho das outras telas administrativas: o estado vive aqui, fora do
 * React, e os componentes o leem por `useSyncExternalStore`. Assim a tela não
 * guarda cópia do que o servidor disse, e cada ação recarrega a verdade em vez
 * de remendar a lista na memória — numa tela que distribui poder, uma lista
 * desatualizada é pior do que uma lista que demora.
 */

export interface PlatformSchool {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  /** Matriculados na unidade: o denominador do alcance do projeto. */
  enrolledStudents: number | null;
  activeCollectors: number;
  prototypes: number;
}

export interface PlatformState {
  loading: boolean;
  /** Recusa ao carregar ou ao agir, já em português, vinda do servidor. */
  error: string | null;
  busy: boolean;
  schools: PlatformSchool[];
  grants: AdminGrant[];
  /** Candidaturas de escolas que querem construir um captador. */
  requests: PartnershipRequest[];
}

export type PlatformResult = { ok: true } | { ok: false; message: string };

export interface PlatformSource {
  subscribe(listener: () => void): () => void;
  getState(): PlatformState;
  getServerState(): PlatformState;
  /** Carrega escolas e autorizações. Devolve a função de parada. */
  start(): () => void;
  createSchool(input: { name: string; city: string; state: string }): Promise<PlatformResult>;
  updateSchool(id: string, input: { name: string; city: string; state: string; enrolledStudents: number | null }): Promise<PlatformResult>;
  grant(input: { email: string; schoolId: string }): Promise<PlatformResult>;
  revoke(email: string): Promise<PlatformResult>;
  /** Aprovar cria a escola e autoriza o e-mail de uma vez. */
  answerRequest(id: string, decision: "approve" | "decline"): Promise<PlatformResult>;
}

const INITIAL: PlatformState = { loading: true, error: null, busy: false, schools: [], grants: [], requests: [] };

export function createPlatformApiSource({ baseUrl = "" }: { baseUrl?: string } = {}): PlatformSource {
  const listeners = new Set<() => void>();
  let state = INITIAL;
  let running = false;

  const commit = (patch: Partial<PlatformState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };

  async function call<T>(url: string, init?: RequestInit): Promise<{ ok: true; body: T } | { ok: false; message: string }> {
    try {
      const response = await fetch(`${baseUrl}${url}`, {
        cache: "no-store",
        ...init,
        headers: { "Content-Type": "application/json", ...init?.headers },
      });
      const body = (await response.json().catch(() => ({}))) as T & { error?: string };
      if (!response.ok) return { ok: false, message: body.error ?? `HTTP ${response.status}` };
      return { ok: true, body };
    } catch {
      return { ok: false, message: "Sem conexão com a plataforma." };
    }
  }

  async function load() {
    const [escolas, autorizacoes, pedidos] = await Promise.all([
      call<{ schools: PlatformSchool[] }>("/api/admin/schools"),
      call<{ grants: AdminGrant[] }>("/api/admin/grants"),
      call<{ requests: PartnershipRequest[] }>("/api/admin/partnerships"),
    ]);
    if (!running) return;
    const falha = [escolas, autorizacoes, pedidos].find((r) => !r.ok);
    if (falha && !falha.ok) {
      commit({ loading: false, error: falha.message });
      return;
    }
    if (!escolas.ok || !autorizacoes.ok || !pedidos.ok) return;
    commit({
      loading: false,
      error: null,
      schools: escolas.body.schools,
      grants: autorizacoes.body.grants,
      requests: pedidos.body.requests,
    });
  }

  /** Age e relê: a lista volta do servidor, nunca é remendada aqui. */
  async function mutate(url: string, init: RequestInit): Promise<PlatformResult> {
    commit({ busy: true, error: null });
    const result = await call<unknown>(url, init);
    if (!result.ok) {
      commit({ busy: false, error: result.message });
      return { ok: false, message: result.message };
    }
    await load();
    commit({ busy: false });
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
      void load();
      return () => {
        running = false;
      };
    },

    createSchool: (input) => mutate("/api/admin/schools", { method: "POST", body: JSON.stringify(input) }),
    updateSchool: (id, input) => mutate(`/api/admin/schools/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
    grant: (input) => mutate("/api/admin/grants", { method: "POST", body: JSON.stringify(input) }),
    revoke: (email) => mutate(`/api/admin/grants/${encodeURIComponent(email)}`, { method: "DELETE" }),
    answerRequest: (id, decision) =>
      mutate(`/api/admin/partnerships/${id}`, { method: "PATCH", body: JSON.stringify({ decision }) }),
  };
}
