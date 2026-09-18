"use client";

import { Droplets, Gauge, RotateCcw, Ruler, Timer, TriangleAlert } from "lucide-react";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import {
  useCollectorSnapshot,
  useCollectorSource,
  usePrimaryCollectorCode,
} from "@/components/collector/collector-source";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import type { SimulationRequest } from "@/lib/iot/data-source";
import { DEFAULT_SIMULATION_SETTINGS, TIME_SCALES } from "@/lib/iot/simulation-config";
import { cn } from "@/lib/utils/cn";
import { formatDecimal } from "@/lib/utils/format";
import { SimulationPanelContext } from "./simulation-panel-context";

const LEVEL_PRESETS = [0.1, 0.5, 0.9, 0.97, 1] as const;
const INFLOW_PRESETS = [0.6, 1.2, 3] as const;

/** `enabled` só para professores e administradores; para os demais, o selo SIMULAÇÃO não abre o painel. */
export function SimulationPanelProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const api = useMemo(() => (enabled ? { open: () => setOpen(true) } : null), [enabled]);
  const close = useCallback(() => setOpen(false), []);

  return (
    <SimulationPanelContext value={api}>
      {children}
      {enabled && (
        <BottomSheet
          open={open}
          onClose={close}
          title="Painel da simulação"
          description="Controla o dispositivo virtual, que fala com a plataforma pela mesma API do ESP32. Nada aqui é dado real."
        >
          <SimulationPanelBody />
        </BottomSheet>
      )}
    </SimulationPanelContext>
  );
}

function SimulationPanelBody() {
  const source = useCollectorSource();
  const code = usePrimaryCollectorCode();
  const snapshot = useCollectorSnapshot(code);
  const [notice, setNotice] = useState<string | null>(null);
  const settings = snapshot?.simulation;

  if (!code || !settings) {
    return <p className="text-sm text-mist-400">Este captador é real: não há controles de simulação.</p>;
  }

  const send = async (request: SimulationRequest) => {
    const result = await source.updateSimulation(code, request);
    setNotice(result.ok ? null : (result.message ?? "Não foi possível atualizar a simulação."));
  };

  return (
    <div className="space-y-6">
      <PanelGroup
        icon={<Timer />}
        title="Velocidade do tempo"
        hint="O condensado real acumula devagar (cerca de 1 L/h). Acelere para demonstrar."
      >
        <Segmented
          label="Velocidade do tempo"
          options={TIME_SCALES.map((scale) => ({ value: scale, label: scale === 1 ? "1× real" : `${scale}×` }))}
          value={settings.timeScale}
          onChange={(timeScale) => void send({ settings: { timeScale } })}
        />
      </PanelGroup>

      <PanelGroup icon={<Droplets />} title="Ar-condicionado">
        <SwitchRow
          label="Produzindo condensado"
          checked={settings.inflowEnabled}
          onChange={(inflowEnabled) => void send({ settings: { inflowEnabled } })}
        />
        <Segmented
          label="Vazão de condensado"
          options={INFLOW_PRESETS.map((rate) => ({ value: rate, label: `${formatDecimal(rate, 1)} L/h` }))}
          value={settings.inflowLitersPerHour}
          disabled={!settings.inflowEnabled}
          onChange={(inflowLitersPerHour) => void send({ settings: { inflowLitersPerHour } })}
        />
      </PanelGroup>

      <PanelGroup icon={<Gauge />} title="Definir nível do captador">
        <div className="grid grid-cols-5 gap-2">
          {LEVEL_PRESETS.map((ratio) => (
            <Button
              key={ratio}
              variant="secondary"
              size="sm"
              className="px-0"
              onClick={() => void send({ action: { type: "set_level", ratio } })}
            >
              {Math.round(ratio * 100)}%
            </Button>
          ))}
        </div>
      </PanelGroup>

      <DistanceControl
        sensor={snapshot?.hardware?.distanceSensor ?? null}
        onApply={(distance_mm) => void send({ action: { type: "set_distance", distance_mm } })}
      />

      <PanelGroup icon={<TriangleAlert />} title="Falhas para testar">
        <SwitchRow
          label="Válvula sem vazão"
          description="Válvula inadequada para baixa pressão: abre, mas a água não sai (NO_FLOW)."
          checked={settings.faultNoFlow}
          onChange={(faultNoFlow) => void send({ settings: { faultNoFlow } })}
        />
        <SwitchRow
          label="Captador offline"
          description="O dispositivo para de enviar leituras. A plataforma detecta a ausência em até 15 s."
          checked={settings.offline}
          onChange={(offline) => void send({ settings: { offline } })}
        />
      </PanelGroup>

      {notice && <p className="text-sm text-ember-400">{notice}</p>}

      <Button
        variant="ghost"
        className="w-full"
        icon={<RotateCcw className="size-4" />}
        onClick={() => void send({ settings: DEFAULT_SIMULATION_SETTINGS, action: { type: "reset" } })}
      >
        Reiniciar simulação
      </Button>
    </div>
  );
}

/** Coloca a superfície simulada a uma distância do sensor para testar a conversão em litros. */
function DistanceControl({ sensor, onApply }: { sensor: string | null; onApply: (distanceMm: number) => void }) {
  const [value, setValue] = useState("1236");
  const distance = Number(value);
  const valid = value.trim() !== "" && Number.isFinite(distance) && distance >= 0 && distance <= 10_000;

  return (
    <PanelGroup
      icon={<Ruler />}
      title={`Distância do sensor${sensor ? ` ${sensor}` : ""}`}
      hint="Posiciona a água simulada a esta distância do sensor. Com calibração ativa, a plataforma converte em litros."
    >
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) onApply(distance);
        }}
      >
        <label className="relative flex-1">
          <span className="sr-only">Distância em milímetros</span>
          <input
            inputMode="numeric"
            value={value}
            onChange={(event) => setValue(event.target.value.replace(/[^\d]/g, "").slice(0, 5))}
            className="h-10 w-full rounded-xl bg-white/[0.05] pl-3 pr-10 font-mono text-sm text-mist-50 outline-none ring-1 ring-inset ring-white/10 focus:ring-2 focus:ring-sim-400"
          />
          <span className="pointer-events-none absolute inset-y-0 right-3 grid place-items-center text-xs text-mist-400">mm</span>
        </label>
        <Button type="submit" variant="secondary" size="sm" className="h-10" disabled={!valid}>
          Aplicar
        </Button>
      </form>
    </PanelGroup>
  );
}

function PanelGroup({ icon, title, hint, children }: { icon: ReactNode; title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-2.5">
      <h3 className="eyebrow flex items-center gap-2 text-sim-300 [&_svg]:size-3.5">
        {icon}
        {title}
      </h3>
      {hint && <p className="text-xs text-mist-400">{hint}</p>}
      {children}
    </section>
  );
}

function Segmented<T extends number>({
  label,
  options,
  value,
  disabled = false,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: number;
  disabled?: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn("grid grid-flow-col auto-cols-fr gap-1 rounded-2xl bg-white/[0.04] p-1", disabled && "opacity-45")}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              "h-10 rounded-xl text-sm font-semibold transition-colors",
              selected ? "bg-sim-400/20 text-sim-300 ring-1 ring-inset ring-sim-400/40" : "text-mist-300",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function SwitchRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center gap-3 rounded-2xl bg-white/[0.04] p-3 text-left"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-mist-50">{label}</span>
        {description && <span className="mt-0.5 block text-xs leading-snug text-mist-400">{description}</span>}
      </span>
      <span
        aria-hidden
        className={cn("relative h-7 w-12 shrink-0 rounded-full transition-colors", checked ? "bg-sim-500" : "bg-white/15")}
      >
        <span
          className={cn(
            "absolute left-0 top-1 size-5 rounded-full bg-white shadow transition-transform",
            checked ? "translate-x-6" : "translate-x-1",
          )}
        />
      </span>
    </button>
  );
}
