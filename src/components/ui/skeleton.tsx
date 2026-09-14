import { cn } from "@/lib/utils/cn";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "animate-shimmer rounded-xl bg-[linear-gradient(90deg,rgb(255_255_255/0.04)_25%,rgb(255_255_255/0.09)_50%,rgb(255_255_255/0.04)_75%)] bg-size-[200%_100%]",
        className,
      )}
    />
  );
}
