"use client";

import { FlaskConical } from "lucide-react";
import { useSimulationPanel } from "@/components/simulation/simulation-panel-context";
import { cn } from "@/lib/utils/cn";
import { Chip } from "./chip";

/**
 * Selo obrigatório sempre que o dado exibido vier do dispositivo virtual.
 * Dentro da simulação, abre o painel de controle ao ser tocado.
 */
export function SimulationBadge({ onClick, className }: { onClick?: () => void; className?: string }) {
  const panel = useSimulationPanel();
  const handleClick = onClick ?? panel?.open;

  const chip = (
    <Chip tone="sim" icon={<FlaskConical />} className={cn("tracking-wide", className)}>
      SIMULAÇÃO
    </Chip>
  );

  if (!handleClick) return chip;

  return (
    <button
      type="button"
      onClick={handleClick}
      data-testid="simulation-badge"
      aria-label="Dados simulados. Abrir painel da simulação"
      className="shrink-0 rounded-full transition-transform active:scale-95"
    >
      {chip}
    </button>
  );
}
