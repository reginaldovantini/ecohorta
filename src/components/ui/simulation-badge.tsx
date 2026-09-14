import { FlaskConical } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Chip } from "./chip";

/**
 * Selo obrigatório sempre que o dado exibido vier do dispositivo virtual.
 * Com `onClick`, abre o painel de controle da simulação.
 */
export function SimulationBadge({ onClick, className }: { onClick?: () => void; className?: string }) {
  const chip = (
    <Chip tone="sim" icon={<FlaskConical />} className={cn("tracking-wide", className)}>
      SIMULAÇÃO
    </Chip>
  );

  if (!onClick) return chip;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Dados simulados. Abrir painel da simulação"
      className="rounded-full active:scale-95 transition-transform"
    >
      {chip}
    </button>
  );
}
