"use client";

import { motion } from "motion/react";
import { useId } from "react";
import { fillRatio, getLevelState, type Urgency } from "@/lib/collector/level-state";
import type { CollectorSnapshot } from "@/lib/iot/types";
import { cn } from "@/lib/utils/cn";

/*
 * Representação do captador físico: TUBO VERTICAL de vidro, em perspectiva leve.
 *
 * Tudo que se move corresponde a um estado real da telemetria:
 *   nível da água      ← volume medido pelo VL53L1X
 *   feixe do sensor    ← distância até a superfície
 *   gotas na entrada   ← nível subindo (ar-condicionado produzindo condensado)
 *   fluxo na saída     ← válvula aberta
 *   fluxo no dreno     ← nível no limite (transbordamento)
 *   tom de urgência    ← faixas de atenção (86–95%) e crítico (96–100%)
 *
 * Geometria (viewBox x −24…132, y 0…256):
 *   interior: x 28–96, y 38–212 · nível 100% = boca do dreno (y 50)
 */

const CENTER_X = 62;
const BOTTOM_Y = 212;
const FULL_Y = 50;
const SENSOR_Y = 30;
const WAVELENGTH = 68;
const WAVE_FILL = `M28 0 q17 -3.6 34 0 ${"t34 0 ".repeat(7)}V320 H28 Z`;
const WAVE_CREST = `M28 0 q17 -3.6 34 0 ${"t34 0 ".repeat(7)}`;
const BUBBLES = [
  { x: 42, delay: 0, duration: 3.4, r: 1.6 },
  { x: 57, delay: 1.3, duration: 2.8, r: 1.1 },
  { x: 72, delay: 0.6, duration: 3.9, r: 1.9 },
  { x: 86, delay: 2.1, duration: 3.1, r: 1.2 },
];
const SCALE_MARKS = [0, 0.25, 0.5, 0.75, 1] as const;

const URGENCY_COLOR: Record<Urgency, string> = {
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
  /** Destaca o feixe do sensor durante a medição. */
  measuring?: boolean;
  /** Régua de 0 a 100% ao lado do tubo. */
  showScale?: boolean;
  /** Percentual escrito dentro da água. */
  showPercent?: boolean;
  className?: string;
}

const levelY = (ratio: number) => BOTTOM_Y - ratio * (BOTTOM_Y - FULL_Y);

export function CollectorTank({
  ratio,
  urgency,
  inflowActive,
  dispensing,
  overflowing,
  measuring = false,
  showScale = false,
  showPercent = false,
  className,
}: CollectorTankProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const ids = {
    clip: `tank-clip-${uid}`,
    water: `tank-water-${uid}`,
    glass: `tank-glass-${uid}`,
    shade: `tank-shade-${uid}`,
  };

  const level = Math.min(1, Math.max(0, ratio));
  const surfaceY = levelY(level);
  const depth = BOTTOM_Y - surfaceY;
  const accent = URGENCY_COLOR[urgency];
  const percent = `${Math.round(level * 100)}%`;
  const spring = { type: "spring" as const, stiffness: 55, damping: 16 };

  return (
    <svg
      viewBox={showScale ? "-24 0 156 256" : "0 0 132 256"}
      role="img"
      aria-label={`Captador com ${percent} da capacidade${dispensing ? ", liberando água" : ""}${overflowing ? ", água escoando pelo dreno" : ""}`}
      className={cn("h-full w-auto overflow-visible", className)}
    >
      <defs>
        <clipPath id={ids.clip}>
          <path d="M28 40 A34 5 0 0 1 96 40 V208 A34 6 0 0 1 28 208 Z" />
        </clipPath>
        {/* Em coordenadas do corpo d'água: clara na superfície, escura em profundidade */}
        <linearGradient id={ids.water} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="170">
          <stop offset="0" stopColor="#9be6fa" />
          <stop offset="0.1" stopColor="#2ec5f0" />
          <stop offset="0.55" stopColor="#0a82bd" />
          <stop offset="1" stopColor="#06456a" />
        </linearGradient>
        {/* Sombreamento cilíndrico: bordas escuras, faixa de luz à esquerda */}
        <linearGradient id={ids.shade} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#000" stopOpacity="0.45" />
          <stop offset="0.18" stopColor="#fff" stopOpacity="0.14" />
          <stop offset="0.3" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.75" stopColor="#000" stopOpacity="0.05" />
          <stop offset="1" stopColor="#000" stopOpacity="0.5" />
        </linearGradient>
        <linearGradient id={ids.glass} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.35" />
          <stop offset="0.5" stopColor="#ffffff" stopOpacity="0.06" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0.22" />
        </linearGradient>
      </defs>

      {showScale && (
        <g fontFamily="var(--font-jetbrains-mono)" fontSize="7.5" fill="var(--color-mist-400)" textAnchor="end">
          {SCALE_MARKS.map((mark) => (
            <g key={mark}>
              <text x="14" y={levelY(mark) + 2.6}>
                {Math.round(mark * 100)}%
              </text>
              <line x1="17" x2="22" y1={levelY(mark)} y2={levelY(mark)} stroke="var(--color-mist-500)" strokeWidth="1" />
            </g>
          ))}
        </g>
      )}

      {/* Tubulação: entrada do condensado, dreno de segurança e saída com válvula */}
      <g fill="none" stroke="var(--color-abyss-500)" strokeWidth="6" strokeLinecap="round">
        <path d="M4 20 H30 Q36 20 36 26 V42" />
        <path d="M96 50 H112 Q118 50 118 56 V62" />
        <path d={`M${CENTER_X} 214 V236`} />
      </g>

      {/* Halo de urgência */}
      {urgency !== "normal" && (
        <path
          d="M20 38 A42 8 0 0 1 104 38 V210 A42 9 0 0 1 20 210 Z"
          fill="none"
          stroke={accent}
          strokeWidth={urgency === "critical" ? 6 : 5}
          opacity={urgency === "critical" ? 0.85 : 0.5}
          style={urgency === "critical" ? { animation: "urgent-pulse 1.4s ease-in-out infinite" } : undefined}
        />
      )}

      {/* Parede traseira do vidro */}
      <path d="M24 38 A38 6 0 0 1 100 38 V210 A38 7 0 0 1 24 210 Z" fill="var(--color-abyss-950)" fillOpacity="0.9" />

      <g clipPath={`url(#${ids.clip})`}>
        {inflowActive &&
          [0, 0.55].map((delay) => (
            <path
              key={delay}
              d="M36 42 c2.2 3 3.2 4.6 3.2 6.2 a3.2 3.2 0 0 1 -6.4 0 c0 -1.6 1 -3.2 3.2 -6.2z"
              fill="var(--color-aqua-300)"
              style={{ animation: `tank-drip 1.1s cubic-bezier(0.55, 0, 1, 0.45) ${delay}s infinite` }}
            />
          ))}

        <motion.g initial={false} animate={{ y: surfaceY }} transition={spring}>
          <g style={{ animation: "tank-wave 5.5s linear infinite reverse" }}>
            <path d={WAVE_FILL} transform={`translate(${-WAVELENGTH / 2} -2.5)`} fill="var(--color-aqua-500)" opacity="0.45" />
          </g>
          <g style={{ animation: `tank-wave ${dispensing ? 1.6 : 3.2}s linear infinite` }}>
            <path d={WAVE_FILL} fill={`url(#${ids.water})`} />
            <path d={WAVE_CREST} fill="none" stroke="var(--color-aqua-200)" strokeWidth="1.2" opacity="0.85" />
          </g>
          {depth > 60 &&
            BUBBLES.map((bubble) => (
              <circle
                key={bubble.x}
                cx={bubble.x}
                cy={depth - 8}
                r={bubble.r}
                fill="#ffffff"
                opacity="0"
                style={{ animation: `tank-bubble ${bubble.duration}s ease-in ${bubble.delay}s infinite` }}
              />
            ))}
          {urgency !== "normal" && (
            <rect
              x="24"
              y="-4"
              width="76"
              height="240"
              fill={accent}
              opacity={urgency === "critical" ? 0.3 : 0.12}
              style={urgency === "critical" ? { animation: "urgent-pulse 1.4s ease-in-out infinite" } : undefined}
            />
          )}
          {showPercent && depth > 34 && (
            <text
              x={CENTER_X}
              y="24"
              textAnchor="middle"
              fontFamily="var(--font-space-grotesk)"
              fontWeight="700"
              fontSize="15"
              fill="#ffffff"
              style={{ paintOrder: "stroke", stroke: "rgb(3 15 13 / 0.35)", strokeWidth: 3 }}
            >
              {percent}
            </text>
          )}
        </motion.g>

        {/* Sombreamento cilíndrico sobre água e vidro */}
        <rect x="24" y="30" width="76" height="190" fill={`url(#${ids.shade})`} />

        {[0.25, 0.5, 0.75].map((mark) => (
          <line key={mark} x1="84" x2="94" y1={levelY(mark)} y2={levelY(mark)} stroke="#ffffff" strokeOpacity="0.3" strokeWidth="1" />
        ))}
        <line x1="78" x2="96" y1={FULL_Y} y2={FULL_Y} stroke={accent} strokeOpacity="0.7" strokeWidth="1" strokeDasharray="2 2" />
      </g>

      {showPercent && depth <= 34 && (
        <text
          x={CENTER_X}
          y={surfaceY - 8}
          textAnchor="middle"
          fontFamily="var(--font-space-grotesk)"
          fontWeight="700"
          fontSize="13"
          fill="var(--color-mist-100)"
        >
          {percent}
        </text>
      )}

      {/* Vidro: contorno cilíndrico, aro superior e reflexos */}
      <path d="M24 38 V210 A38 7 0 0 0 100 210 V38" fill="none" stroke={`url(#${ids.glass})`} strokeWidth="2.5" />
      <ellipse cx={CENTER_X} cy="38" rx="38" ry="6" fill="none" stroke="#ffffff" strokeOpacity="0.28" strokeWidth="2" />
      <rect x="31" y="48" width="4" height="152" rx="2" fill="#ffffff" opacity="0.16" />
      <rect x="38" y="56" width="1.6" height="110" rx="0.8" fill="#ffffff" opacity="0.1" />

      {/* Sensor VL53L1X e feixe até a superfície */}
      <motion.line
        x1={CENTER_X}
        x2={CENTER_X}
        y1={SENSOR_Y}
        initial={false}
        animate={{ y2: surfaceY - 3 }}
        transition={spring}
        stroke="var(--color-leaf-300)"
        strokeWidth={measuring ? 1.6 : 1}
        strokeDasharray="2 4"
        opacity={measuring ? 0.95 : 0.5}
        style={{ animation: "flow-dash 1.2s linear infinite reverse" }}
      />
      <rect x="38" y="24" width="48" height="9" rx="3" fill="var(--color-abyss-700)" stroke="#ffffff" strokeOpacity="0.08" />
      <rect x="47" y="11" width="30" height="14" rx="4" fill="var(--color-abyss-600)" stroke="#ffffff" strokeOpacity="0.16" />
      <circle cx={CENTER_X} cy="28" r="5" fill="var(--color-leaf-400)" opacity="0.25" style={{ animation: "glow-pulse 2s ease-in-out infinite" }} />
      <circle cx={CENTER_X} cy="28" r="2.4" fill="var(--color-leaf-400)" />

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
