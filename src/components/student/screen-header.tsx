import type { ReactNode } from "react";
import { SimulationBadge } from "@/components/ui/simulation-badge";

interface ScreenHeaderProps {
  eyebrow: string;
  title: string;
  subtitle?: ReactNode;
  isSimulation: boolean;
}

export function ScreenHeader({ eyebrow, title, subtitle, isSimulation }: ScreenHeaderProps) {
  return (
    <header className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="mt-0.5 font-display text-[1.75rem] font-bold leading-tight tracking-tight text-mist-50">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-mist-400">{subtitle}</p>}
      </div>
      {isSimulation && <SimulationBadge className="mt-1" />}
    </header>
  );
}
