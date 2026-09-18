"use client";

import { useState, type PointerEvent } from "react";
import type { BenchReading } from "@/lib/collector/bench-view";
import { formatDecimal, formatLiters } from "@/lib/utils/format";

/*
 * Distância medida pelo sensor ao longo do tempo (dado primário, sem filtro de exibição).
 * Leituras ausentes aparecem como falhas na linha e marcas na base: é assim que reflexões,
 * instabilidade e leituras inválidas ficam visíveis durante o ensaio.
 * Cor validada contra a superfície escura (a mesma dos pontos da calibração).
 */

const LINE = "#1296cc";
const INVALID = "#ff5a69"; // alert-400: leitura inválida (sempre acompanhada de rótulo)
const GRID = "rgb(255 255 255 / 0.07)";
const AXIS_TEXT = "#89a99d";

const W = 320;
const H = 176;
const M = { top: 12, right: 12, bottom: 26, left: 42 };

const time = (ms: number) => new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(ms);

export function DistanceChart({ readings }: { readings: BenchReading[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const valid = readings.filter((item) => item.distanceMm !== null);
  const invalidCount = readings.length - valid.length;

  if (readings.length < 2) {
    return <p className="text-sm text-mist-400">Aguardando leituras para desenhar o gráfico.</p>;
  }

  // Distância maior fica mais embaixo: a linha sobe quando a água sobe.
  const t0 = readings[0]!.at;
  const t1 = Math.max(readings[readings.length - 1]!.at, t0 + 1);
  const values = valid.map((item) => item.distanceMm!);
  const rawMin = values.length ? Math.min(...values) : 0;
  const rawMax = values.length ? Math.max(...values) : 1;
  const pad = Math.max(5, (rawMax - rawMin) * 0.15);
  const yMin = rawMin - pad;
  const yMax = rawMax + pad;
  const x = (at: number) => M.left + ((at - t0) / (t1 - t0)) * (W - M.left - M.right);
  const y = (mm: number) => M.top + ((mm - yMin) / (yMax - yMin)) * (H - M.top - M.bottom);

  // Segmentos contínuos: uma leitura inválida interrompe a linha.
  const segments: string[] = [];
  let current = "";
  for (const item of readings) {
    if (item.distanceMm === null) {
      if (current) segments.push(current);
      current = "";
      continue;
    }
    current += `${current ? "L" : "M"}${x(item.at).toFixed(1)},${y(item.distanceMm).toFixed(1)}`;
  }
  if (current) segments.push(current);

  const yTicks = [rawMin, (rawMin + rawMax) / 2, rawMax];
  const hovered = hover === null ? null : readings[hover]!;

  const onPointer = (event: PointerEvent<SVGRectElement>) => {
    const box = event.currentTarget.ownerSVGElement!.getBoundingClientRect();
    const at = t0 + (((event.clientX - box.left) / box.width) * W - M.left) / (W - M.left - M.right) * (t1 - t0);
    let nearest = 0;
    for (let i = 1; i < readings.length; i++) {
      if (Math.abs(readings[i]!.at - at) < Math.abs(readings[nearest]!.at - at)) nearest = i;
    }
    setHover(nearest);
  };

  return (
    <figure className="space-y-2">
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="block w-full touch-none" role="img" aria-label={`Distância medida: ${readings.length} leituras, ${invalidCount} inválidas`}>
          {yTicks.map((tick, index) => (
            <g key={index}>
              <line x1={M.left} x2={W - M.right} y1={y(tick)} y2={y(tick)} stroke={GRID} strokeWidth={1} />
              <text x={M.left - 6} y={y(tick)} dy="0.32em" textAnchor="end" fontSize={10} fill={AXIS_TEXT}>
                {formatDecimal(tick, 0)}
              </text>
            </g>
          ))}
          <text x={M.left} y={H - 8} fontSize={10} fill={AXIS_TEXT}>
            {time(t0)}
          </text>
          <text x={W - M.right} y={H - 8} textAnchor="end" fontSize={10} fill={AXIS_TEXT}>
            {time(t1)}
          </text>

          {segments.map((d, index) => (
            <path key={index} d={d} fill="none" stroke={LINE} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {readings.map((item, index) =>
            item.distanceMm === null ? (
              <rect key={index} x={x(item.at) - 1} y={H - M.bottom - 6} width={2} height={6} fill={INVALID} />
            ) : null,
          )}

          {hovered && (
            <line x1={x(hovered.at)} x2={x(hovered.at)} y1={M.top} y2={H - M.bottom} stroke="rgb(255 255 255 / 0.35)" strokeWidth={1} />
          )}
          {hovered?.distanceMm !== null && hovered && (
            <circle cx={x(hovered.at)} cy={y(hovered.distanceMm!)} r={4.5} fill={LINE} stroke="#0e2621" strokeWidth={2} />
          )}
          <rect
            x={M.left}
            y={0}
            width={W - M.left - M.right}
            height={H}
            fill="transparent"
            onPointerMove={onPointer}
            onPointerDown={onPointer}
            onPointerLeave={() => setHover(null)}
          />
        </svg>

        {hovered && (
          <div
            role="status"
            className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-xl border border-white/10 bg-abyss-900/95 px-3 py-2 text-xs shadow-lg"
            style={{ left: `${Math.min(78, Math.max(22, (x(hovered.at) / W) * 100))}%` }}
          >
            <p className="font-display text-sm font-bold tabular-nums text-mist-50">
              {hovered.distanceMm === null ? "Leitura inválida" : `${formatDecimal(hovered.distanceMm, 0)} mm`}
            </p>
            <p className="whitespace-nowrap text-mist-400">
              {time(hovered.at)}
              {hovered.volumeLiters !== null && ` · ${formatLiters(hovered.volumeLiters)}`}
            </p>
          </div>
        )}
      </div>
      <figcaption className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-mist-400">
        <span>
          {readings.length} leituras · {invalidCount} inválidas
        </span>
        {invalidCount > 0 && (
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="h-2 w-0.5" style={{ background: INVALID }} /> leitura inválida
          </span>
        )}
      </figcaption>
    </figure>
  );
}
