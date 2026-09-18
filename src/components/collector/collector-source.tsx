"use client";

import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import { selectedCollectorStore } from "@/lib/collector/selected-collector";
import type { CollectorDataSource } from "@/lib/iot/data-source";

const CollectorSourceContext = createContext<CollectorDataSource | null>(null);
const NO_CODES: readonly string[] = [];

export function CollectorSourceProvider({ source, children }: { source: CollectorDataSource; children: ReactNode }) {
  return <CollectorSourceContext value={source}>{children}</CollectorSourceContext>;
}

export function useCollectorSource() {
  const source = useContext(CollectorSourceContext);
  if (!source) throw new Error("useCollectorSource precisa estar dentro de <CollectorSourceProvider>.");
  return source;
}

export function useConnectionState() {
  const source = useCollectorSource();
  return useSyncExternalStore(source.subscribe, source.getConnectionState, () => "connecting" as const);
}

/** Todos os captadores da escola (referência estável enquanto a lista não mudar). */
export function useCollectorCodes(): readonly string[] {
  const source = useCollectorSource();
  return useSyncExternalStore(source.subscribe, source.getCollectorCodes, () => NO_CODES);
}

/**
 * Captador principal do usuário: o escolhido neste aparelho (seletor) ou, sem escolha,
 * o primeiro da escola. Depois poderá ser o escaneado pelo QR.
 */
export function usePrimaryCollectorCode(): string | null {
  const codes = useCollectorCodes();
  const chosen = useSyncExternalStore(
    selectedCollectorStore.subscribe,
    selectedCollectorStore.getSnapshot,
    selectedCollectorStore.getServerSnapshot,
  );
  return chosen && codes.includes(chosen) ? chosen : (codes[0] ?? null);
}

export function useCollectorSnapshot(collectorCode: string | null) {
  const source = useCollectorSource();
  return useSyncExternalStore(
    source.subscribe,
    () => (collectorCode ? source.getSnapshot(collectorCode) : null),
    () => null,
  );
}

export function useDispenseProgress(commandId: string | null) {
  const source = useCollectorSource();
  return useSyncExternalStore(
    source.subscribe,
    () => (commandId ? source.getProgress(commandId) : null),
    () => null,
  );
}
