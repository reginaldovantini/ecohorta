"use client";

import { motion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

interface HoldToConfirmProps {
  label: string;
  holdingLabel: string;
  icon?: ReactNode;
  durationMs?: number;
  disabled?: boolean;
  onConfirm: () => void;
}

/**
 * Confirmação por toque longo: a ação abre uma válvula real,
 * então um toque acidental não pode liberar água.
 * Pelo teclado (Enter/Espaço), confirma diretamente.
 */
export function HoldToConfirm({
  label,
  holdingLabel,
  icon,
  durationMs = 1200,
  disabled = false,
  onConfirm,
}: HoldToConfirmProps) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const cancel = () => {
    window.clearTimeout(timer.current);
    setHolding(false);
  };

  const begin = () => {
    if (disabled) return;
    setHolding(true);
    timer.current = window.setTimeout(() => {
      setHolding(false);
      navigator.vibrate?.(35);
      onConfirm();
    }, durationMs);
  };

  return (
    <button
      type="button"
      disabled={disabled}
      data-testid="hold-to-confirm"
      onPointerDown={begin}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onContextMenu={(event) => event.preventDefault()}
      onClick={(event) => {
        if (event.detail === 0) onConfirm();
      }}
      className={cn(
        "relative h-14 w-full touch-none select-none overflow-hidden rounded-control bg-aqua-600/40 font-semibold text-mist-50 ring-1 ring-inset ring-aqua-300/40 transition-transform disabled:opacity-45",
        holding && "scale-[0.98]",
      )}
    >
      <motion.span
        aria-hidden
        className="absolute inset-0 origin-left bg-linear-to-r from-aqua-400 to-aqua-300"
        initial={false}
        animate={{ scaleX: holding ? 1 : 0 }}
        transition={holding ? { duration: durationMs / 1000, ease: "linear" } : { duration: 0.25, ease: "easeOut" }}
      />
      <span className={cn("relative flex items-center justify-center gap-2 transition-colors", holding && "text-abyss-950")}>
        {icon}
        {holding ? holdingLabel : label}
      </span>
    </button>
  );
}
