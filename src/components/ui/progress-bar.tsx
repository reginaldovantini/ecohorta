"use client";

import { motion } from "motion/react";
import { cn } from "@/lib/utils/cn";

const fills = {
  aqua: "from-aqua-600 via-aqua-400 to-aqua-200",
  leaf: "from-leaf-600 via-leaf-400 to-leaf-300",
  sun: "from-sun-500 via-sun-400 to-sun-300",
} as const;

interface ProgressBarProps {
  /** 0 a 1 */
  value: number;
  tone?: keyof typeof fills;
  label: string;
  className?: string;
}

export function ProgressBar({ value, tone = "aqua", label, className }: ProgressBarProps) {
  const clamped = Math.min(1, Math.max(0, value));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped * 100)}
      className={cn("relative h-2.5 overflow-hidden rounded-full bg-white/[0.07]", className)}
    >
      {/* translateX em vez de width: animação na GPU, sem distorcer as pontas */}
      <motion.div
        className={cn("absolute inset-0 rounded-full bg-linear-to-r", fills[tone])}
        initial={false}
        animate={{ x: `${(clamped - 1) * 100}%` }}
        transition={{ type: "spring", stiffness: 80, damping: 20 }}
      />
    </div>
  );
}
