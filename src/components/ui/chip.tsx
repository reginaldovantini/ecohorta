import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

const tones = {
  neutral: "bg-white/[0.06] text-mist-300 ring-white/10",
  aqua: "bg-aqua-400/12 text-aqua-300 ring-aqua-400/25",
  leaf: "bg-leaf-400/12 text-leaf-300 ring-leaf-400/25",
  sun: "bg-sun-400/12 text-sun-300 ring-sun-400/25",
  ember: "bg-ember-400/12 text-ember-400 ring-ember-400/30",
  alert: "bg-alert-400/15 text-alert-400 ring-alert-400/35",
  sim: "bg-sim-400/15 text-sim-300 ring-sim-400/35",
} as const;

export type ChipTone = keyof typeof tones;

interface ChipProps extends ComponentPropsWithoutRef<"span"> {
  tone?: ChipTone;
  icon?: ReactNode;
}

export function Chip({ tone = "neutral", icon, className, children, ...props }: ChipProps) {
  return (
    <span
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-xs font-semibold ring-1 ring-inset [&_svg]:size-3.5",
        tones[tone],
        className,
      )}
      {...props}
    >
      {icon}
      {children}
    </span>
  );
}
