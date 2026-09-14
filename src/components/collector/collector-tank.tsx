"use client";

import { motion } from "motion/react";
import { useId } from "react";
import { fillRatio, getLevelState, type Urgency } from "@/lib/collector/level-state";
import type { CollectorSnapshot } from "@/lib/iot/types";
import { cn } from "@/lib/utils/cn";

/*
 * Representação do captador físico (tubo vertical) em SVG.
 *
 * Tudo que se move corresponde a um estado real vindo da telemetria:
 *   nível da água      ← volume medido pelo VL53L1X
 *   feixe do sensor    ← distância até a superfície
 *   gotas na entrada   ← nível subindo (ar-condicionado produzindo condensado)
 *   fluxo na saída     ← válvula aberta
 *   fluxo no dreno     ← nível no limite (transbordamento)
 *
 * Geometria (viewBox 132 × 256):
 *   interior do tubo: x 28–96, y 36–212 · nível 100% = boca do dreno (y 50)
 */

const CENTER_X = 62;
const BOTTOM_Y = 212;
const FULL_Y = 50;
const SENSOR_Y = 30;
const WAVELENGTH = 68;
/** Onda periódica (8 meias-ondas) que desliza um comprimento de onda por ciclo. */
const WAVE_FILL = `M28 0 q17 -3.6 34 0 ${"t34 0 ".repeat(7)}V320 H28 Z`;
const WAVE_CREST = `M28 0 q17 -3.6 34 0 ${"t34 0 ".repeat(7)}`;
const BUBBLES = [
  { x: 42, delay: 0, duration: 3.4, r: 1.6 },
  { x: 57, delay: 1.3, duration: 2.8, r: 1.1 },
  { x: 72, delay: 0.6, duration: 3.9, r: 1.9 },
  { x: 86, delay: 2.1, duration: 3.1, r: 1.2 },
];

const URGENCY_STROKE: Record<Urgency, string> = {
  normal: "var(--color-aqua-400)",
  attention: "var(--color-ember-400)",
  critical: "var(--color-alert-400)",
};

export interface CollectorTankProps {
  /** 0 a 1 — nível medido. */
  ratio: number;
  urgency: Urgency;
  /** Nível subindo: gotas de condensado entrando. */
  inflowActive: boolean;
  /** Válvula aberta: água saindo pela parte inferior. */
  dispensing: boolean;
  /** Nível no limite: água escoando pelo dreno de segurança. */
  overflowing: boolean;
  /** Destaca o feixe do sensor durante a confirmação de volume. */
  measuring?: boolean;
  className?: string;
}

export function CollectorTank({
  ratio,
  urgency,
  inflowActive,
  dispensing,
  overflowing,
  measuring = false,
  className,
}: CollectorTankProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const ids = { clip: `tank-clip-${uid}`, water: `tank-water-${uid}`, glass: `tank-glass-${uid}` };

  const level = Math.min(1, Math.max(0, ratio));
  const levelY = BOTTOM_Y - level * (BOTTOM_Y - FULL_Y);
  const depth = BOTTOM_Y - levelY;
  const accent = URGENCY_STROKE[urgency];

  return (
    <svg
      viewBox="0 0 132 256"
      role="img"
      aria-label={`Captador com ${Math.round(level * 100)}% da capacidade${dispensing ? ", liberando água" : ""}${overflowing ? ", transbordando pelo dreno" : ""}`}
      className={cn("h-full w-auto overflow-visible", className)}
    >
      <defs>
        <clipPath id={ids.clip}>
          <rect x="28" y="36" width="68" height="176" rx="12" />
        </clipPath>
        {/* Em coordenadas do corpo d'água: claro na superfície, escuro em profundidade */}
        <linearGradient id={ids.water} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="170">
          <stop offset="0" stopColor="#8fe2f9" />
          <stop offset="0.12" stopColor="#2ec5f0" />
          <stop offset="0.55" stopColor="#0a82bd" />
          <stop offset="1" stopColor="#06456a" />
        </linearGradient>
        <linearGradient id={ids.glass} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.28" />
          <stop offset="0.5" stopColor="#ffffff" stopOpacity="0.06" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0.18" />
        </linearGradient>
      </defs>

      {/* Tubulação: entrada do condensado, dreno de segurança e saída com válvula */}
      <g fill="none" stroke="var(--color-abyss-500)" strokeWidth="6" strokeLinecap="round">
        <path d="M4 22 H30 Q36 22 36 28 V40" />
        <path d="M96 50 H112 Q118 50 118 56 V62" />
        <path d={`M${CENTER_X} 212 V236`} />
      </g>

      {/* Brilho de urgência ao redor do tubo */}
      {urgency !== "normal" && (
        <rect
          x="22"
          y="30"
          width="80"
          height="188"
          rx="18"
          fill="none"
          stroke={accent}
          strokeWidth="5"
          opacity="0.4"
          style={urgency === "critical" ? { animation: "glow-pulse 1.4s ease-in-out infinite" } : undefined}
        />
      )}

      {/* Fundo do tubo (vidro) */}
      <rect x="24" y="32" width="76" height="184" rx="16" fill="var(--color-abyss-900)" fillOpacity="0.85" />

      <g clipPath={`url(#${ids.clip})`}>
        {/* Gotas de condensado (desenhadas atrás da água) */}
        {inflowActive &&
          [0, 0.55].map((delay) => (
            <path
              key={delay}
              d="M36 40 c2.2 3 3.2 4.6 3.2 6.2 a3.2 3.2 0 0 1 -6.4 0 c0 -1.6 1 -3.2 3.2 -6.2z"
              fill="var(--color-aqua-300)"
              style={{ animation: `tank-drip 1.1s cubic-bezier(0.55, 0, 1, 0.45) ${delay}s infinite` }}
            />
          ))}

        {/* Corpo d'água: desloca-se com mola até o nível medido */}
        <motion.g initial={false} animate={{ y: levelY }} transition={{ type: "spring", stiffness: 55, damping: 16 }}>
          <g style={{ animation: "tank-wave 5.5s linear infinite reverse" }}>
            <path d={WAVE_FILL} transform={`translate(${-WAVELENGTH / 2} -2.5)`} fill="var(--color-aqua-500)" opacity="0.45" />
          </g>
          <g style={{ animation: `tank-wave ${dispensing ? 1.6 : 3.2}s linear infinite` }}>
            <path d={WAVE_FILL} fill={`url(#${ids.water})`} />
            <path d={WAVE_CREST} fill="none" stroke="var(--color-aqua-200)" strokeWidth="1.2" opacity="0.8" />
          </g>
          {depth > 60 &&
            BUBBLES.map((bubble) => (
              <circle
                key={bubble.x}
                cx={bubble.x}
                cy={depth - 6}
                r={bubble.r}
                fill="#ffffff"
                opacity="0"
                style={{ animation: `tank-bubble ${bubble.duration}s ease-in ${bubble.delay}s infinite` }}
              />
            ))}
        </motion.g>

        {/* Marcas de 25%, 50% e 75% */}
        {[0.25, 0.5, 0.75].map((mark) => {
          const y = BOTTOM_Y - mark * (BOTTOM_Y - FULL_Y);
          return <line key={mark} x1="84" x2="94" y1={y} y2={y} stroke="#ffffff" strokeOpacity="0.35" strokeWidth="1" />;
        })}
        <line x1="80" x2="96" y1={FULL_Y} y2={FULL_Y} stroke={accent} strokeOpacity="0.6" strokeWidth="1" strokeDasharray="2 2" />
      </g>

      {/* Parede de vidro e reflexos */}
      <rect x="24" y="32" width="76" height="184" rx="16" fill="none" stroke={`url(#${ids.glass})`} strokeWidth="3" />
      <rect x="34" y="46" width="4.5" height="150" rx="2.25" fill="#ffffff" opacity="0.12" />
      <rect x="41" y="52" width="1.6" height="110" rx="0.8" fill="#ffffff" opacity="0.08" />

      {/* Sensor VL53L1X e feixe até a superfície */}
      <motion.line
        x1={CENTER_X}
        x2={CENTER_X}
        y1={SENSOR_Y}
        initial={false}
        animate={{ y2: levelY - 2 }}
        transition={{ type: "spring", stiffness: 55, damping: 16 }}
        stroke="var(--color-leaf-300)"
        strokeWidth={measuring ? 1.6 : 1}
        strokeDasharray="2 4"
        opacity={measuring ? 0.95 : 0.55}
        style={{ animation: "flow-dash 1.2s linear infinite reverse" }}
      />
      <rect x="40" y="24" width="44" height="8" rx="2" fill="var(--color-abyss-700)" />
      <rect x="47" y="12" width="30" height="14" rx="4" fill="var(--color-abyss-600)" stroke="#ffffff" strokeOpacity="0.14" />
      <circle cx={CENTER_X} cy="26" r="5" fill="var(--color-leaf-400)" opacity="0.25" style={{ animation: "glow-pulse 2s ease-in-out infinite" }} />
      <circle cx={CENTER_X} cy="26" r="2.4" fill="var(--color-leaf-400)" />

      {/* Válvula de saída (normalmente fechada) */}
      <path
        d={`M${CENTER_X - 10} 220 L${CENTER_X} 226 L${CENTER_X - 10} 232 Z M${CENTER_X + 10} 220 L${CENTER_X} 226 L${CENTER_X + 10} 232 Z`}
        fill={dispensing ? "var(--color-aqua-300)" : "var(--color-mist-500)"}
        className="transition-[fill] duration-300"
      />

      {dispensing && (
        <path
          d={`M${CENTER_X} 238 V256`}
          stroke="var(--color-aqua-300)"
          strokeWidth="4.5"
          strokeLinecap="round"
          strokeDasharray="7 5"
          style={{ animation: "flow-dash 0.45s linear infinite" }}
        />
      )}

      {overflowing && (
        <path
          d="M118 66 V256"
          stroke="var(--color-aqua-300)"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeDasharray="6 6"
          style={{ animation: "flow-dash 0.5s linear infinite" }}
        />
      )}
    </svg>
  );
}

/** Deriva os estados visuais do captador a partir da telemetria. */
export function tankPropsFromSnapshot(snapshot: CollectorSnapshot) {
  const ratio = fillRatio(snapshot.telemetry.volumeLiters, snapshot.info.capacityLiters);
  return {
    ratio,
    urgency: snapshot.telemetry.overflowing ? ("critical" as const) : getLevelState(ratio).urgency,
    inflowActive: snapshot.telemetry.trend === "rising",
    dispensing: snapshot.telemetry.valve === "open",
    overflowing: snapshot.telemetry.overflowing,
  };
}
