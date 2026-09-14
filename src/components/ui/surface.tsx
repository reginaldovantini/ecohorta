import type { ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/utils/cn";

const tones = {
  default: "bg-abyss-800/80 border-white/[0.06]",
  raised: "bg-abyss-700/80 border-white/[0.08]",
  aqua: "bg-linear-to-br from-aqua-800/50 to-abyss-800/90 border-aqua-400/20",
  leaf: "bg-linear-to-br from-leaf-600/25 to-abyss-800/90 border-leaf-400/20",
  ember: "bg-linear-to-br from-ember-500/20 to-abyss-800/90 border-ember-400/25",
  alert: "bg-linear-to-br from-alert-500/25 to-abyss-800/90 border-alert-400/30",
  sim: "bg-linear-to-br from-sim-500/15 to-abyss-800/90 border-sim-400/25",
} as const;

export type SurfaceTone = keyof typeof tones;

interface SurfaceProps extends ComponentPropsWithoutRef<"div"> {
  tone?: SurfaceTone;
}

/** Painel base do design system: cards, blocos de métrica, alertas. */
export function Surface({ tone = "default", className, ...props }: SurfaceProps) {
  return (
    <div
      className={cn(
        "rounded-card border shadow-[inset_0_1px_0_rgb(255_255_255/0.04),0_20px_40px_-24px_rgb(0_0_0/0.6)]",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}
