"use client";

import { useState } from "react";
import type { CalibrationDistances, CalibrationFit } from "@/lib/collector/volume-calibration";
import { formatDecimal } from "@/lib/utils/format";

/*
 * Gráfico da calibração: altura da coluna (mm) × volume (L).
 * Pontos medidos de 0 a 3 L, reta V = k × H e o nível máximo (capacidade extrapolada).
 * Cores validadas contra a superfície escura (abyss-800): faixa de luminosidade,
 * croma, separação para daltonismo e contraste. A tabela de pontos ao lado é a visão em texto.
 */

const MEASURED = "#1296cc";
const MAXIMUM = "#c4880a";
const SURFACE = "#0e2621";
const GRID = "rgb(255 255 255 / 0.07)";
const AXIS_TEXT = "#89a99d"; // mist-400

const W = 320;
const H = 224;
const M = { top: 18, right: 14, bottom: 38, left: 38 };

interface Point {
  key: string;
  label: string;
  liters: number;
  heightMm: number;
  distanceMm: number;
  kind: "measured" | "maximum";
}

function niceStep(span: number, targetTicks: number) {
  const raw = span / targetTicks;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  return (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
}

function ticks(min: number, max: number, target: number) {
  const step = niceStep(max - min, target);
  const values: number[] = [];
  for (let value = Math.ceil(min / step) * step; value <= max + 1e-9; value += step) values.push(Math.round(value * 1000) / 1000);
  return values;
}

export function CalibrationChart({ distances, fit }: { distances: CalibrationDistances; fit: CalibrationFit }) {
  const [active, setActive] = useState<string | null>(null);
  const k = fit.constantLitersPerMm;

  const points: Point[] = [
    { key: "zero", label: "0 L", liters: 0, heightMm: 0, distanceMm: distances.zeroMm, kind: "measured" },
    { key: "one", label: "1 L", liters: 1, heightMm: fit.heightsMm.one, distanceMm: distances.oneLiterMm, kind: "measured" },
    { key: "two", label: "2 L", liters: 2, heightMm: fit.heightsMm.two, distanceMm: distances.twoLitersMm, kind: "measured" },
    { key: "three", label: "3 L", liters: 3, heightMm: fit.heightsMm.three, distanceMm: distances.threeLitersMm, kind: "measured" },
  ];
  if (k !== null && fit.effectiveCapacityLiters !== null) {
    points.push({
      key: "max",
      label: "Nível máximo",
      liters: fit.effectiveCapacityLiters,
      heightMm: fit.heightsMm.max,
      distanceMm: distances.maximumMm,
      kind: "maximum",
    });
  }
  const finite = points.filter((point) => Number.isFinite(point.heightMm) && Number.isFinite(point.liters));

  const xMin = Math.min(0, ...finite.map((point) => point.heightMm));
  const xMax = Math.max(1, ...finite.map((point) => point.heightMm)) * 1.06;
  const yMax = Math.max(3, ...finite.map((point) => point.liters)) * 1.12;
  const x = (value: number) => M.left + ((value - xMin) / (xMax - xMin)) * (W - M.left - M.right);
  const y = (value: number) => H - M.bottom - (value / yMax) * (H - M.top - M.bottom);
  const xTicks = ticks(xMin, xMax, 4);
  const yTicks = ticks(0, yMax, 4);
  const maxPoint = finite.find((point) => point.kind === "maximum");
  const hovered = finite.find((point) => point.key === active) ?? null;

  return (
    <figure className="space-y-3">
      <figcaption className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-mist-300">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-full" style={{ background: MEASURED }} /> Pontos medidos (0 a 3 L)
        </span>
        {k !== null && (
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="h-0.5 w-4 rounded-full" style={{ background: MEASURED }} /> Reta V = k × H
          </span>
        )}
        {maxPoint && (
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-full" style={{ background: MAXIMUM }} /> Nível máximo (extrapolado)
          </span>
        )}
      </figcaption>

      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label="Volume em função da altura da coluna de água">
          {yTicks.map((tick) => (
            <g key={`y${tick}`}>
              <line x1={M.left} x2={W - M.right} y1={y(tick)} y2={y(tick)} stroke={GRID} strokeWidth={1} />
              <text x={M.left - 6} y={y(tick)} dy="0.32em" textAnchor="end" fontSize={10} fill={AXIS_TEXT}>
                {formatDecimal(tick, 0)}
              </text>
            </g>
          ))}
          {xTicks.map((tick) => (
            <text key={`x${tick}`} x={x(tick)} y={H - M.bottom + 14} textAnchor="middle" fontSize={10} fill={AXIS_TEXT}>
              {formatDecimal(tick, 0)}
            </text>
          ))}
          <line x1={M.left} x2={W - M.right} y1={y(0)} y2={y(0)} stroke="rgb(255 255 255 / 0.18)" strokeWidth={1} />
          <text x={(M.left + W - M.right) / 2} y={H - 6} textAnchor="middle" fontSize={10} fill={AXIS_TEXT}>
            Altura da coluna acima do zero (mm)
          </text>
          <text x={M.left - 30} y={10} fontSize={10} fill={AXIS_TEXT}>
            Volume (L)
          </text>

          {k !== null && maxPoint && (
            <line
              x1={x(0)}
              y1={y(0)}
              x2={x(maxPoint.heightMm)}
              y2={y(k * maxPoint.heightMm)}
              stroke={MEASURED}
              strokeWidth={2}
              strokeLinecap="round"
            />
          )}

          {finite.map((point) => {
            const cx = x(point.heightMm);
            const cy = y(point.liters);
            const color = point.kind === "maximum" ? MAXIMUM : MEASURED;
            const isActive = active === point.key;
            return (
              <g
                key={point.key}
                tabIndex={0}
                role="button"
                aria-label={`${point.label}: ${formatDecimal(point.liters)} litros, altura ${formatDecimal(point.heightMm, 0)} mm, distância ${formatDecimal(point.distanceMm, 0)} mm`}
                onPointerEnter={() => setActive(point.key)}
                onPointerLeave={() => setActive(null)}
                onFocus={() => setActive(point.key)}
                onBlur={() => setActive(null)}
                onClick={() => setActive(isActive ? null : point.key)}
                className="cursor-pointer outline-none"
              >
                <circle cx={cx} cy={cy} r={12} fill="transparent" />
                <circle cx={cx} cy={cy} r={isActive ? 6 : 4.5} fill={color} stroke={SURFACE} strokeWidth={2} />
              </g>
            );
          })}

          {maxPoint && (
            <text x={x(maxPoint.heightMm) - 10} y={y(maxPoint.liters) - 10} textAnchor="end" fontSize={10} fontWeight={600} fill="#e2f1ea">
              Máx. {formatDecimal(maxPoint.liters)} L
            </text>
          )}
        </svg>

        {hovered && (
          <div
            role="status"
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-xl border border-white/10 bg-abyss-900/95 px-3 py-2 text-xs shadow-lg"
            style={{
              left: `${Math.min(80, Math.max(20, (x(hovered.heightMm) / W) * 100))}%`,
              top: `${(y(hovered.liters) / H) * 100 - 4}%`,
            }}
          >
            <p className="font-display text-sm font-bold tabular-nums text-mist-50">{formatDecimal(hovered.liters)} L</p>
            <p className="whitespace-nowrap text-mist-400">
              {hovered.label} · H {formatDecimal(hovered.heightMm, 0)} mm · D {formatDecimal(hovered.distanceMm, 0)} mm
            </p>
          </div>
        )}
      </div>
    </figure>
  );
}
