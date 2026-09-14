"use client";

import { motion } from "motion/react";
import { useId } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * Regador sob a saída do captador. O nível interno acompanha o volume
 * MEDIDO pelo sensor (liberado ÷ alvo), não o tempo de válvula aberta.
 */
export function WateringCan({ fill, flowing, className }: { fill: number; flowing: boolean; className?: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const level = Math.min(1, Math.max(0, fill));

  return (
    <svg viewBox="0 0 120 96" aria-hidden className={cn("h-full w-auto overflow-visible", className)}>
      <defs>
        <clipPath id={`can-${uid}`}>
          <path d="M36 42 H84 Q88 42 88 46 V84 Q88 90 82 90 H38 Q32 90 32 84 V46 Q32 42 36 42 Z" />
        </clipPath>
        <linearGradient id={`can-water-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7fdcf7" />
          <stop offset="1" stopColor="#0a82bd" />
        </linearGradient>
      </defs>

      {flowing && (
        <path
          d="M60 0 V44"
          stroke="var(--color-aqua-300)"
          strokeWidth="4.5"
          strokeLinecap="round"
          strokeDasharray="7 5"
          style={{ animation: "flow-dash 0.45s linear infinite" }}
        />
      )}

      <path d="M46 42 C46 24 74 24 74 42" stroke="var(--color-abyss-500)" strokeWidth="6" fill="none" strokeLinecap="round" />
      <path d="M32 56 L12 36" stroke="var(--color-abyss-500)" strokeWidth="7" strokeLinecap="round" />
      <ellipse cx="10" cy="34" rx="6" ry="4" transform="rotate(-45 10 34)" fill="var(--color-abyss-600)" />

      <path
        d="M36 42 H84 Q88 42 88 46 V84 Q88 90 82 90 H38 Q32 90 32 84 V46 Q32 42 36 42 Z"
        fill="var(--color-abyss-800)"
        stroke="var(--color-abyss-500)"
        strokeWidth="2"
      />
      <g clipPath={`url(#can-${uid})`}>
        <motion.rect
          x="32"
          y="42"
          width="56"
          height="48"
          fill={`url(#can-water-${uid})`}
          style={{ originY: 1 }}
          initial={false}
          animate={{ scaleY: level }}
          transition={{ type: "spring", stiffness: 70, damping: 18 }}
        />
      </g>
      <rect x="38" y="48" width="4" height="34" rx="2" fill="#ffffff" opacity="0.12" />
    </svg>
  );
}
