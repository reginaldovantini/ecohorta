"use client";

import { selectedCollectorStore } from "@/lib/collector/selected-collector";
import { cn } from "@/lib/utils/cn";
import { useCollectorCodes, useCollectorSnapshot, usePrimaryCollectorCode } from "./collector-source";

/** Escolha do captador exibido (ex.: EC-001 real × SIM-001 simulação). Só aparece com mais de um. */
export function CollectorSwitcher({ className }: { className?: string }) {
  const codes = useCollectorCodes();
  const current = usePrimaryCollectorCode();
  if (codes.length < 2) return null;

  return (
    <div role="radiogroup" aria-label="Captador" className={cn("-mx-1 flex gap-2 overflow-x-auto px-1 pb-1", className)}>
      {codes.map((code) => (
        <Option key={code} code={code} selected={code === current} />
      ))}
    </div>
  );
}

function Option({ code, selected }: { code: string; selected: boolean }) {
  const snapshot = useCollectorSnapshot(code);
  const origin = snapshot?.telemetry.origin;
  const online = snapshot ? snapshot.telemetry.status !== "OFFLINE" : false;

  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={() => selectedCollectorStore.select(code)}
      className={cn(
        "flex h-9 shrink-0 items-center gap-2 rounded-full px-3 text-xs font-semibold ring-1 ring-inset transition-colors",
        selected ? "bg-white/10 text-mist-50 ring-aqua-400/50" : "bg-white/[0.04] text-mist-300 ring-white/10",
      )}
    >
      <span aria-hidden className={cn("size-2 rounded-full", online ? "bg-leaf-400" : "bg-mist-500")} />
      {code}
      {origin && (
        <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] tracking-wide", origin === "simulation" ? "bg-sim-400/20 text-sim-300" : "bg-leaf-400/15 text-leaf-300")}>
          {origin === "simulation" ? "SIMULAÇÃO" : "REAL"}
        </span>
      )}
      <span className="sr-only">{online ? "conectado" : "sem conexão"}</span>
    </button>
  );
}
