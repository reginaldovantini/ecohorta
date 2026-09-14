import { Carrot, Droplets, FlaskConical, Flower2, Gauge, Leaf, Sparkles, Sprout, type LucideIcon } from "lucide-react";
import { findAvatar, type AvatarGlyph } from "@/lib/users/avatars";
import { cn } from "@/lib/utils/cn";

const GLYPHS: Record<AvatarGlyph, LucideIcon> = {
  droplets: Droplets,
  sprout: Sprout,
  leaf: Leaf,
  flower: Flower2,
  carrot: Carrot,
  flask: FlaskConical,
  gauge: Gauge,
  sparkles: Sparkles,
};

const SIZES = {
  sm: "size-9 rounded-xl [&>svg]:size-5",
  md: "size-12 rounded-2xl [&>svg]:size-6",
  lg: "size-20 rounded-[1.6rem] [&>svg]:size-10",
} as const;

/** Emblema ilustrado do usuário: gradiente, anel e brilho — sem fotos. */
export function Avatar({
  avatarId,
  size = "md",
  className,
}: {
  avatarId: string;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const avatar = findAvatar(avatarId);
  const Icon = GLYPHS[avatar.glyph];
  return (
    <span
      role="img"
      aria-label={`Avatar ${avatar.label}`}
      className={cn(
        "relative grid shrink-0 place-items-center overflow-hidden text-white ring-1 ring-inset ring-white/30 shadow-[0_10px_24px_-10px_rgb(0_0_0/0.7)]",
        SIZES[size],
        className,
      )}
      style={{ backgroundImage: `linear-gradient(145deg, ${avatar.from}, ${avatar.to})` }}
    >
      <span aria-hidden className="absolute -right-[20%] -top-[30%] size-[80%] rounded-full bg-white/30 blur-md" />
      <span aria-hidden className="absolute inset-[14%] rounded-full border border-white/25" />
      <Icon className="relative drop-shadow-[0_2px_3px_rgb(0_0_0/0.3)]" strokeWidth={2.1} aria-hidden />
    </span>
  );
}
