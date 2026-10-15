import type { WallPost } from "@/lib/server/mission-wall";

/*
 * O MURAL, VISTO DA TELA.
 *
 * Mesmo desenho das outras fontes do projeto: o estado vive aqui, fora do
 * React, e a tela o lê por `useSyncExternalStore`. Curtir é a única coisa que
 * muda na memória antes de o servidor responder — e muda de volta se ele
 * recusar, porque um coração que acende e some sozinho é pior do que um
 * coração que demora meio segundo.
 */

/** O post como a tela recebe: sem o caminho do bucket, com a URL assinada. */
export type WallItem = Omit<WallPost, "imagePath"> & { imageUrl: string | null };

export interface WallState {
  loading: boolean;
  error: string | null;
  posts: WallItem[];
  /** Há mais para carregar abaixo? */
  hasMore: boolean;
  loadingMore: boolean;
}

export type WallResult = { ok: true } | { ok: false; message: string };

export interface WallSource {
  subscribe(listener: () => void): () => void;
  getState(): WallState;
  getServerState(): WallState;
  start(): () => void;
  loadMore(): Promise<void>;
  toggleLike(postId: string): Promise<WallResult>;
  report(postId: string, reason: string): Promise<WallResult>;
}

const PAGE = 20;
const INITIAL: WallState = { loading: true, error: null, posts: [], hasMore: false, loadingMore: false };

export function createWallApiSource({ baseUrl = "" }: { baseUrl?: string } = {}): WallSource {
  const listeners = new Set<() => void>();
  let state = INITIAL;
  let running = false;

  const commit = (patch: Partial<WallState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };

  async function fetchPage(before?: number): Promise<{ ok: true; posts: WallItem[] } | { ok: false; message: string }> {
    try {
      const url = new URL(`${baseUrl}/api/mural`, typeof window === "undefined" ? "http://localhost" : window.location.origin);
      url.searchParams.set("limite", String(PAGE));
      if (before) url.searchParams.set("antes", String(before));
      const response = await fetch(url.pathname + url.search, { cache: "no-store" });
      const body = (await response.json().catch(() => ({}))) as { posts?: WallItem[]; error?: string };
      if (!response.ok) return { ok: false, message: body.error ?? `HTTP ${response.status}` };
      return { ok: true, posts: body.posts ?? [] };
    } catch {
      return { ok: false, message: "Sem conexão com a plataforma." };
    }
  }

  async function load() {
    const result = await fetchPage();
    if (!running) return;
    if (!result.ok) {
      commit({ loading: false, error: result.message });
      return;
    }
    commit({ loading: false, error: null, posts: result.posts, hasMore: result.posts.length === PAGE });
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

    async loadMore() {
      const ultimo = state.posts[state.posts.length - 1];
      if (!ultimo || state.loadingMore || !state.hasMore) return;
      commit({ loadingMore: true });
      const result = await fetchPage(ultimo.createdAt);
      if (!running) return;
      if (!result.ok) {
        commit({ loadingMore: false, error: result.message });
        return;
      }
      commit({
        loadingMore: false,
        posts: [...state.posts, ...result.posts],
        hasMore: result.posts.length === PAGE,
      });
    },

    /**
     * Curtir responde na hora e se desfaz se o servidor recusar.
     *
     * É a única ação otimista do projeto, e tem motivo: um coração que espera a
     * rede parece quebrado. Tudo o mais — água, XP, missão — vem do servidor.
     */
    async toggleLike(postId) {
      const antes = state.posts;
      commit({
        posts: antes.map((post) =>
          post.id === postId ? { ...post, likedByMe: !post.likedByMe, likes: post.likes + (post.likedByMe ? -1 : 1) } : post,
        ),
      });
      try {
        const response = await fetch(`${baseUrl}/api/mural/${postId}/like`, { method: "PUT" });
        const body = (await response.json().catch(() => ({}))) as { likes?: number; likedByMe?: boolean; error?: string };
        if (!response.ok) {
          commit({ posts: antes });
          return { ok: false, message: body.error ?? "Não foi possível curtir." };
        }
        commit({
          posts: state.posts.map((post) =>
            post.id === postId ? { ...post, likes: body.likes ?? post.likes, likedByMe: body.likedByMe ?? post.likedByMe } : post,
          ),
        });
        return { ok: true };
      } catch {
        commit({ posts: antes });
        return { ok: false, message: "Sem conexão." };
      }
    },

    /** Denunciar some com a publicação da tela, porque some do mural de todos. */
    async report(postId, reason) {
      try {
        const response = await fetch(`${baseUrl}/api/mural/${postId}/report`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason }),
        });
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        if (!response.ok) return { ok: false, message: body.error ?? "Não foi possível denunciar." };
        commit({ posts: state.posts.filter((post) => post.id !== postId) });
        return { ok: true };
      } catch {
        return { ok: false, message: "Sem conexão." };
      }
    },
  };
}
