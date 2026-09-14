import { z } from "zod";
import { displayIdentitySchema, type DisplayIdentity } from "@/lib/users/types";

/**
 * Perfil de DEMONSTRAÇÃO, salvo apenas neste navegador.
 * Guarda somente DADOS DE EXIBIÇÃO (apelido, avatar, perfil, turma/função),
 * XP e o histórico das missões. Dados cadastrais nunca ficam no aparelho.
 * Com o login (Dias 6–7), XP e histórico passam a vir do banco.
 */

const executionRecordSchema = z.object({
  executionId: z.string(),
  missionId: z.string(),
  commandId: z.string(),
  collectorCode: z.string(),
  status: z.enum(["COMPLETED", "FAILED", "CANCELLED"]),
  targetLiters: z.number(),
  deliveredLiters: z.number(),
  xpAwarded: z.number().int().nonnegative(),
  startedAt: z.number(),
  finishedAt: z.number(),
  origin: z.enum(["device", "simulation"]),
});

const profileSchema = z.object({
  identity: displayIdentitySchema.nullable().default(null),
  xp: z.number().int().nonnegative(),
  history: z.array(executionRecordSchema),
});

export type ExecutionRecord = z.infer<typeof executionRecordSchema>;
export type DemoProfile = z.infer<typeof profileSchema>;

const STORAGE_KEY = "ecohorta:demo-profile:v1";
const MAX_HISTORY = 100;
const EMPTY_PROFILE: DemoProfile = { identity: null, xp: 0, history: [] };

let state: DemoProfile = EMPTY_PROFILE;
let hydrated = false;
const listeners = new Set<() => void>();

function hydrate() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = profileSchema.safeParse(JSON.parse(raw));
    if (parsed.success) state = parsed.data;
  } catch {
    // Armazenamento indisponível (aba anônima, bloqueio): segue só em memória.
  }
}

function commit(next: DemoProfile) {
  state = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Mantém em memória.
  }
  for (const listener of listeners) listener();
}

export const demoProfileStore = {
  subscribe(listener: () => void) {
    hydrate();
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getSnapshot(): DemoProfile {
    hydrate();
    return state;
  },
  getServerSnapshot(): DemoProfile {
    return EMPTY_PROFILE;
  },
  setIdentity(identity: DisplayIdentity) {
    hydrate();
    commit({ ...state, identity });
  },
  /** Idempotente por `executionId`: a mesma execução nunca soma XP duas vezes. */
  record(entry: ExecutionRecord) {
    hydrate();
    if (state.history.some((record) => record.executionId === entry.executionId)) return;
    commit({
      ...state,
      xp: state.xp + entry.xpAwarded,
      history: [entry, ...state.history].slice(0, MAX_HISTORY),
    });
  },
  /** Zera XP e histórico, mantendo o perfil. */
  resetProgress() {
    commit({ ...state, xp: 0, history: [] });
  },
  /** Remove tudo deste aparelho (troca de usuário). */
  clear() {
    commit(EMPTY_PROFILE);
  },
};

export function summarizeProfile(profile: DemoProfile) {
  let litersReused = 0;
  let missionsCompleted = 0;
  for (const record of profile.history) {
    litersReused += record.deliveredLiters;
    if (record.status === "COMPLETED") missionsCompleted++;
  }
  return { xp: profile.xp, litersReused, missionsCompleted };
}
