"use client";

import { motion, type HTMLMotionProps } from "motion/react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

const variants = {
  primary:
    "bg-linear-to-b from-aqua-300 to-aqua-500 text-abyss-950 shadow-[0_10px_30px_-10px_rgb(46_197_240/0.7),inset_0_1px_0_rgb(255_255_255/0.45)]",
  leaf: "bg-linear-to-b from-leaf-300 to-leaf-500 text-abyss-950 shadow-[0_10px_30px_-10px_rgb(91_227_143/0.6),inset_0_1px_0_rgb(255_255_255/0.45)]",
  alert:
    "bg-linear-to-b from-alert-400 to-alert-500 text-white shadow-[0_10px_30px_-10px_rgb(255_90_105/0.75),inset_0_1px_0_rgb(255_255_255/0.35)]",
  secondary: "bg-white/[0.07] text-mist-50 ring-1 ring-inset ring-white/10 hover:bg-white/10",
  ghost: "text-mist-300 hover:bg-white/[0.06] hover:text-mist-50",
  danger: "bg-alert-400/15 text-alert-400 ring-1 ring-inset ring-alert-400/30",
} as const;

const sizes = {
  sm: "h-9 gap-1.5 rounded-xl px-3 text-sm",
  md: "h-12 gap-2 rounded-control px-5 text-[0.95rem]",
  lg: "h-14 gap-2.5 rounded-control px-6 text-base",
} as const;

export type ButtonVariant = keyof typeof variants;

interface ButtonProps extends Omit<HTMLMotionProps<"button">, "children"> {
  variant?: ButtonVariant;
  size?: keyof typeof sizes;
  icon?: ReactNode;
  children?: ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  icon,
  className,
  children,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <motion.button
      type={type}
      whileTap={{ scale: 0.97 }}
      transition={{ type: "spring", stiffness: 520, damping: 30 }}
      className={cn(
        "inline-flex select-none items-center justify-center font-semibold tracking-tight transition-colors disabled:pointer-events-none disabled:opacity-45",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {icon}
      {children}
    </motion.button>
  );
}
