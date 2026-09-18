import { Cpu } from "lucide-react";
import type { DataOrigin } from "@/lib/iot/types";
import { cn } from "@/lib/utils/cn";
import { Chip } from "./chip";
import { SimulationBadge } from "./simulation-badge";

/** Selo dos dados medidos pelo captador físico (ESP32 + sensor). Par do selo SIMULAÇÃO. */
export function RealBadge({ className }: { className?: string }) {
  return (
    <Chip tone="leaf" icon={<Cpu />} className={cn("tracking-wide", className)} aria-label="Dados reais do captador físico">
      REAL
    </Chip>
  );
}

/** REAL ou SIMULAÇÃO, sempre visível onde há dado de captador. */
export function OriginBadge({ origin, className }: { origin: DataOrigin; className?: string }) {
  return origin === "simulation" ? <SimulationBadge className={className} /> : <RealBadge className={className} />;
}
