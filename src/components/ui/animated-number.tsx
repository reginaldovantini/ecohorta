"use client";

import { motion, useSpring, useTransform } from "motion/react";
import { useEffect } from "react";
import { cn } from "@/lib/utils/cn";

interface AnimatedNumberProps {
  value: number;
  format: (value: number) => string;
  className?: string;
}

/** Número que "rola" até o novo valor — volume, XP, percentuais. */
export function AnimatedNumber({ value, format, className }: AnimatedNumberProps) {
  const spring = useSpring(value, { stiffness: 110, damping: 22 });
  const text = useTransform(spring, format);

  useEffect(() => {
    spring.set(value);
  }, [spring, value]);

  return <motion.span className={cn("tabular-nums", className)}>{text}</motion.span>;
}
