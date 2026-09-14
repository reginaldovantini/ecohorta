"use client";

import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
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

/** Captador principal do usuário. No MVP, o primeiro da escola; depois, o escaneado pelo QR. */
export function usePrimaryCollectorCode(): string | null {
  const source = useCollectorSource();
  const codes = useSyncExternalStore(source.subscribe, source.getCollectorCodes, () => NO_CODES);
  return codes[0] ?? null;
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
