import type { ExecutionRecord } from "@/lib/missions/history";
import type { AvatarId } from "@/lib/users/avatars";
import type { DisplayIdentity, OnboardingInput, UserRole } from "@/lib/users/types";

/**
 * Perfil do usuário autenticado, sempre vindo da API (/api/me).
 * Identidade, XP e histórico são guardados e calculados no servidor;
 * o navegador apenas exibe. Nada de progresso fica no aparelho.
 */

export type ProfileStatus = "loading" | "signed-out" | "ready" | "error";

export interface ProfileState {
  status: ProfileStatus;
  profileId: string | null;
  role: UserRole | null;
  schoolName: string | null;
  /** Nulo até o primeiro acesso (apelido e avatar ainda não escolhidos). */
  identity: DisplayIdentity | null;
  /**
   * A área administrativa aparece? Quem decide é o servidor.
   *
   * Isto não é segurança — as rotas recusam por conta própria —, é para não
   * oferecer a quem não pode uma porta que vai bater na cara.
   */
  canAdminister: boolean;
  platformAdmin: boolean;
  xp: number;
  history: readonly ExecutionRecord[];
}

interface MeBody {
  profileId: string;
  role: UserRole;
  schoolName: string;
  identity: DisplayIdentity | null;
  canAdminister?: boolean;
  platformAdmin?: boolean;
  xp: number;
  history: ExecutionRecord[];
}

type ActionResult = { ok: true } | { ok: false; message: string };

const INITIAL: ProfileState = {
  status: "loading",
  profileId: null,
  role: null,
  schoolName: null,
  identity: null,
  canAdminister: false,
  platformAdmin: false,
  xp: 0,
  history: [],
};
const SIGNED_OUT: ProfileState = { ...INITIAL, status: "signed-out" };

let state = INITIAL;
let inflight: Promise<ProfileState> | null = null;
const listeners = new Set<() => void>();

function commit(next: ProfileState) {
  state = next;
  for (const listener of listeners) listener();
}

const fromBody = (body: MeBody): ProfileState => ({
  status: "ready",
  profileId: body.profileId,
  role: body.role,
  schoolName: body.schoolName,
  identity: body.identity,
  canAdminister: body.canAdminister === true,
  platformAdmin: body.platformAdmin === true,
  xp: body.xp,
  history: body.history,
});

async function errorMessage(response: Response, fallback: string) {
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  return body.error ?? fallback;
}

async function load(): Promise<ProfileState> {
  try {
    const response = await fetch("/api/me", { cache: "no-store" });
    if (response.status === 401 || response.status === 403) commit(SIGNED_OUT);
    else if (response.ok) commit(fromBody((await response.json()) as MeBody));
    else if (state.status === "loading") commit({ ...state, status: "error" });
  } catch {
    // Sem conexão: mantém o que já foi carregado.
    if (state.status === "loading") commit({ ...state, status: "error" });
  }
  return state;
}

export const profileStore = {
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getSnapshot: () => state,
  getServerSnapshot: () => INITIAL,

  /** Recarrega do servidor. Chamadas simultâneas compartilham a mesma requisição. */
  refresh(): Promise<ProfileState> {
    inflight ??= load().finally(() => {
      inflight = null;
    });
    return inflight;
  },

  /**
   * Começa o login com Google.
   *
   * O servidor monta a URL de autorização — o navegador nunca vê o segredo do
   * cliente — e esta função manda o navegador para lá. Não há retorno de
   * sucesso: a página sai do ar. Só volta aqui quando dá errado.
   */
  async startGoogleSignIn(): Promise<ActionResult> {
    try {
      const response = await fetch("/api/auth/google", { method: "POST" });
      if (!response.ok) return { ok: false, message: await errorMessage(response, "Entrada pelo Google indisponível.") };
      const { url } = (await response.json()) as { url: string };
      window.location.assign(url);
      return { ok: true };
    } catch {
      return { ok: false, message: "Sem conexão. Tente novamente." };
    }
  },

  /** Login por e-mail e senha — contas de administração. A sessão fica em cookie httpOnly. */
  async signIn(path: "/api/auth/login", credentials: Record<string, string>): Promise<ActionResult> {
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(credentials),
      });
      if (!response.ok) return { ok: false, message: await errorMessage(response, "Não foi possível entrar.") };
    } catch {
      return { ok: false, message: "Sem conexão. Tente novamente." };
    }
    // Uma leitura iniciada antes do login ainda diria "sem sessão".
    await inflight;
    await profileStore.refresh();
    return state.status === "ready" ? { ok: true } : { ok: false, message: "Não foi possível carregar o perfil." };
  },

  /**
   * Primeiro acesso completo: nome, sexo, nascimento, função, ano/série e avatar.
   *
   * A escola NÃO entra aqui — ela vem da primeira leitura do QR de um captador.
   */
  async completeOnboarding(input: OnboardingInput): Promise<ActionResult> {
    try {
      const response = await fetch("/api/me", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (response.status === 401) commit(SIGNED_OUT);
      if (!response.ok) return { ok: false, message: await errorMessage(response, "Não foi possível concluir o cadastro.") };
      commit(fromBody((await response.json()) as MeBody));
      return { ok: true };
    } catch {
      return { ok: false, message: "Sem conexão. Tente novamente." };
    }
  },

  /** Depois do primeiro acesso: trocar apelido e avatar. */
  async saveIdentity(input: { nickname: string; avatarId: AvatarId }): Promise<ActionResult> {
    try {
      const response = await fetch("/api/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (response.status === 401) commit(SIGNED_OUT);
      if (!response.ok) return { ok: false, message: await errorMessage(response, "Não foi possível salvar.") };
      commit(fromBody((await response.json()) as MeBody));
      return { ok: true };
    } catch {
      return { ok: false, message: "Sem conexão. Tente novamente." };
    }
  },

  async signOut() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    commit(SIGNED_OUT);
  },

  /** A API recusou a sessão (expirada ou encerrada em outro lugar). */
  markSignedOut() {
    if (state.status !== "signed-out") commit(SIGNED_OUT);
  },
};

export function summarizeProfile(profile: Pick<ProfileState, "xp" | "history">) {
  let litersReused = 0;
  let missionsCompleted = 0;
  for (const record of profile.history) {
    litersReused += record.deliveredLiters;
    if (record.status === "COMPLETED") missionsCompleted++;
  }
  return { xp: profile.xp, litersReused, missionsCompleted };
}
