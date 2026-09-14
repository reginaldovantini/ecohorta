import { cn } from "@/lib/utils/cn";

const SIZES = {
  sm: "size-8 rounded-xl text-xs",
  md: "size-12 rounded-2xl text-lg",
  lg: "size-20 rounded-3xl text-3xl",
} as const;

export function LevelBadge({ level, size = "md", className }: { level: number; size?: keyof typeof SIZES; className?: string }) {
  return (
    <span
      className={cn(
        "relative grid shrink-0 place-items-center bg-linear-to-br from-sun-300 via-sun-400 to-sun-500 font-display font-bold text-abyss-950 shadow-[0_8px_24px_-8px_rgb(245_197_66/0.6),inset_0_1px_0_rgb(255_255_255/0.5)]",
        SIZES[size],
        className,
      )}
      aria-label={`Nível ${level}`}
    >
      {String(level).padStart(2, "0")}
    </span>
  );
}
