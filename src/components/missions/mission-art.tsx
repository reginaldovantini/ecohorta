import { useId } from "react";
import type { MissionArtKind } from "@/lib/missions/catalog";
import { cn } from "@/lib/utils/cn";

/** Gota d'água centrada em (x, y). */
const drop = (x: number, y: number, size = 1) =>
  `M${x} ${y - 5 * size} c${2.5 * size} ${3.4 * size} ${3.6 * size} ${5 * size} ${3.6 * size} ${6.6 * size} a${3.6 * size} ${3.6 * size} 0 0 1 ${-7.2 * size} 0 c0 ${-1.6 * size} ${1.1 * size} ${-3.2 * size} ${3.6 * size} ${-6.6 * size}z`;

const PALETTE = {
  normal: { top: "#1b5244", bottom: "#0a221c", glow: "#5be38f" },
  rescue: { top: "#5a1c28", bottom: "#1c0a10", glow: "#ff5a69" },
};

/** Ilustrações próprias das missões (SVG leve, sem imagens externas). */
export function MissionArt({ art, dimmed = false, className }: { art: MissionArtKind; dimmed?: boolean; className?: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const colors = art === "rescue" ? PALETTE.rescue : PALETTE.normal;

  return (
    <svg
      viewBox="0 0 96 96"
      aria-hidden
      className={cn("shrink-0 overflow-hidden rounded-2xl transition-[filter,opacity]", dimmed && "opacity-55 grayscale-[70%]", className)}
    >
      <defs>
        <linearGradient id={`bg-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={colors.top} />
          <stop offset="1" stopColor={colors.bottom} />
        </linearGradient>
        <radialGradient id={`glow-${uid}`} cx="0.72" cy="0.22" r="0.5">
          <stop offset="0" stopColor={colors.glow} stopOpacity="0.35" />
          <stop offset="1" stopColor={colors.glow} stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="96" height="96" fill={`url(#bg-${uid})`} />
      <rect width="96" height="96" fill={`url(#glow-${uid})`} />
      <ellipse cx="48" cy="88" rx="42" ry="9" fill="#04110d" opacity="0.55" />

      {art === "garden" && (
        <g>
          <path d="M31 62 H65 L60 86 H36 Z" fill="#c2653a" />
          <rect x="28" y="57" width="40" height="8" rx="3" fill="#e08552" />
          <path d="M48 58 C48 48 47 40 48 30" stroke="#2fc46f" strokeWidth="3" fill="none" strokeLinecap="round" />
          <path d="M48 48 C38 46 33 38 34 31 C42 32 47 39 48 48Z" fill="#5be38f" />
          <path d="M48 42 C58 40 63 32 62 25 C54 26 49 33 48 42Z" fill="#2fc46f" />
          {[0, 72, 144, 216, 288].map((angle) => (
            <circle
              key={angle}
              cx={48 + 5.5 * Math.cos((angle * Math.PI) / 180)}
              cy={24 + 5.5 * Math.sin((angle * Math.PI) / 180)}
              r="4.6"
              fill="#ff8fb1"
            />
          ))}
          <circle cx="48" cy="24" r="3.4" fill="#f5c542" />
          <path d={drop(20, 34)} fill="#7fdcf7" />
          <path d={drop(76, 48, 0.8)} fill="#7fdcf7" opacity="0.85" />
        </g>
      )}

      {art === "vegetable-bed" && (
        <g>
          <rect x="12" y="60" width="72" height="22" rx="4" fill="#8a5a3b" />
          <path d="M12 71 H84" stroke="#6e452c" strokeWidth="2" />
          <rect x="15" y="56" width="66" height="9" rx="4" fill="#3b2a1f" />
          {[28, 48, 68].map((x) => (
            <g key={x}>
              <circle cx={x} cy="51" r="11" fill="#1f9955" />
              <circle cx={x - 2} cy="49" r="8" fill="#2fc46f" />
              <circle cx={x + 1} cy="47" r="4.5" fill="#a3f2c0" />
            </g>
          ))}
          <path d={drop(36, 20)} fill="#7fdcf7" />
          <path d={drop(58, 28, 0.8)} fill="#7fdcf7" opacity="0.85" />
        </g>
      )}

      {art === "seedlings" && (
        <g>
          <rect x="14" y="64" width="68" height="18" rx="4" fill="#1d4239" />
          {[20, 42, 64].map((x) => (
            <rect key={x} x={x} y="66" width="12" height="10" rx="2" fill="#3b2a1f" />
          ))}
          {[26, 48, 70].map((x, index) => (
            <g key={x}>
              <path d={`M${x} 66 V${52 - index * 3}`} stroke="#2fc46f" strokeWidth="2.5" strokeLinecap="round" />
              <path d={`M${x} ${56 - index * 3} C${x - 9} ${55 - index * 3} ${x - 11} ${48 - index * 3} ${x - 9} ${44 - index * 3} C${x - 3} ${45 - index * 3} ${x} ${50 - index * 3} ${x} ${56 - index * 3}Z`} fill="#5be38f" />
              <path d={`M${x} ${53 - index * 3} C${x + 9} ${52 - index * 3} ${x + 11} ${45 - index * 3} ${x + 9} ${41 - index * 3} C${x + 3} ${42 - index * 3} ${x} ${47 - index * 3} ${x} ${53 - index * 3}Z`} fill="#a3f2c0" />
            </g>
          ))}
          <path d={drop(48, 22)} fill="#7fdcf7" />
        </g>
      )}

      {art === "herbs" && (
        <g>
          <path d="M16 62 H80 L74 86 H22 Z" fill="#2d5a4e" />
          <rect x="13" y="57" width="70" height="8" rx="3" fill="#3d7564" />
          {[30, 48, 66].map((x, index) => (
            <g key={x}>
              <path d={`M${x} 58 V${28 + index * 4}`} stroke="#1f9955" strokeWidth="2.5" strokeLinecap="round" />
              {[0, 1, 2].map((level) => {
                const y = 50 - level * 9 + index * 3;
                return (
                  <g key={level}>
                    <ellipse cx={x - 6} cy={y} rx="6.5" ry="3.6" transform={`rotate(-30 ${x - 6} ${y})`} fill={level % 2 ? "#5be38f" : "#2fc46f"} />
                    <ellipse cx={x + 6} cy={y - 3} rx="6.5" ry="3.6" transform={`rotate(30 ${x + 6} ${y - 3})`} fill={level % 2 ? "#2fc46f" : "#5be38f"} />
                  </g>
                );
              })}
            </g>
          ))}
        </g>
      )}

      {art === "rescue" && (
        <g>
          <path d="M40 12 A8 8 0 0 1 56 12 V15 H40 Z" fill="#ff5a69" />
          <path d="M34 8 L30 5 M62 8 L66 5 M48 2 V-1" stroke="#ff9aa3" strokeWidth="2" strokeLinecap="round" />
          <rect x="35" y="17" width="26" height="62" rx="8" fill="#061613" stroke="#ffffff" strokeOpacity="0.3" strokeWidth="1.5" />
          <rect x="38.5" y="22" width="19" height="54" rx="5" fill="#2ec5f0" />
          <rect x="38.5" y="22" width="19" height="54" rx="5" fill="#ff5a69" opacity="0.4" />
          <rect x="41" y="26" width="3" height="44" rx="1.5" fill="#ffffff" opacity="0.35" />
          <path d="M61 26 H70 Q74 26 74 30 V44" stroke="#2d5a4e" strokeWidth="4" fill="none" strokeLinecap="round" />
          <path d={drop(74, 54, 0.9)} fill="#7fdcf7" />
          <path d={drop(74, 68, 0.7)} fill="#7fdcf7" opacity="0.7" />
          <path d="M18 80 C18 70 22 64 28 62 C28 70 24 76 18 80Z" fill="#2fc46f" />
        </g>
      )}
    </svg>
  );
}
