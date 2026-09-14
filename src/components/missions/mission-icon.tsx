import { Carrot, Flower2, Leaf, Sprout, type LucideIcon } from "lucide-react";
import type { MissionIcon as MissionIconName } from "@/lib/missions/catalog";
import { cn } from "@/lib/utils/cn";

const icons: Record<MissionIconName, LucideIcon> = {
  flower: Flower2,
  sprout: Carrot,
  seedling: Sprout,
  herbs: Leaf,
};

const sizes = {
  sm: { box: "size-10 rounded-xl", icon: "size-5" },
  md: { box: "size-14 rounded-2xl", icon: "size-7" },
} as const;

export function MissionIcon({
  icon,
  dimmed = false,
  size = "md",
}: {
  icon: MissionIconName;
  dimmed?: boolean;
  size?: keyof typeof sizes;
}) {
  const Icon = icons[icon];
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center ring-1 ring-inset",
        sizes[size].box,
        dimmed
          ? "bg-white/[0.04] text-mist-500 ring-white/[0.06]"
          : "bg-linear-to-br from-leaf-400/30 to-aqua-500/20 text-leaf-300 ring-leaf-400/30",
      )}
    >
      <Icon className={sizes[size].icon} strokeWidth={1.75} aria-hidden />
    </span>
  );
}
