import type { Metadata } from "next";
import { Droplets, Leaf, MapPin, Sparkles, Timer } from "lucide-react";
import { CollectorTank, type CollectorTankProps } from "@/components/collector/collector-tank";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { ProgressBar } from "@/components/ui/progress-bar";
import { SimulationBadge } from "@/components/ui/simulation-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { Surface, type SurfaceTone } from "@/components/ui/surface";
import { DEVICE_STATUSES } from "@/lib/iot/types";

export const metadata: Metadata = { title: "Design System" };

const palette = [
  { name: "abyss", role: "Superfícies", shades: ["bg-abyss-950", "bg-abyss-900", "bg-abyss-800", "bg-abyss-700", "bg-abyss-500"] },
  { name: "aqua", role: "Água · primária", shades: ["bg-aqua-800", "bg-aqua-600", "bg-aqua-400", "bg-aqua-300", "bg-aqua-200"] },
  { name: "leaf", role: "Reúso · sucesso", shades: ["bg-leaf-600", "bg-leaf-500", "bg-leaf-400", "bg-leaf-300"] },
  { name: "sun", role: "XP · conquistas", shades: ["bg-sun-500", "bg-sun-400", "bg-sun-300"] },
  { name: "ember / alert", role: "Atenção · crítico", shades: ["bg-ember-500", "bg-ember-400", "bg-alert-500", "bg-alert-400"] },
  { name: "sim", role: "Somente simulação", shades: ["bg-sim-500", "bg-sim-400", "bg-sim-300"] },
];

const surfaceTones: SurfaceTone[] = ["default", "raised", "aqua", "leaf", "ember", "alert", "sim"];

const baseTank = { inflowActive: false, dispensing: false, overflowing: false } as const;
const tankStates: { label: string; props: CollectorTankProps }[] = [
  { label: "Baixo · acumulando", props: { ...baseTank, ratio: 0.22, urgency: "normal", inflowActive: true } },
  { label: "Disponível", props: { ...baseTank, ratio: 0.62, urgency: "normal" } },
  { label: "Liberando", props: { ...baseTank, ratio: 0.48, urgency: "normal", dispensing: true, measuring: true } },
  { label: "Atenção", props: { ...baseTank, ratio: 0.9, urgency: "attention", inflowActive: true } },
  { label: "Crítico", props: { ...baseTank, ratio: 0.97, urgency: "critical", inflowActive: true } },
  { label: "Transbordando", props: { ...baseTank, ratio: 1, urgency: "critical", inflowActive: true, overflowing: true } },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="eyebrow">{title}</h2>
      {children}
    </section>
  );
}

export default function DesignSystemPage() {
  return (
    <main className="mx-auto max-w-md space-y-10 px-5 pb-16 pt-safe">
      <header className="pt-8">
        <p className="eyebrow text-aqua-300">EcoHorta</p>
        <h1 className="mt-1 font-display text-3xl font-bold tracking-tight">Design System</h1>
        <p className="mt-2 text-sm text-mist-400">Tecnologia + natureza + ciência + jogo.</p>
      </header>

      <Section title="Cores">
        <div className="space-y-3">
          {palette.map((group) => (
            <div key={group.name} className="flex items-center gap-3">
              <div className="flex overflow-hidden rounded-xl ring-1 ring-white/10">
                {group.shades.map((shade) => (
                  <div key={shade} className={`${shade} size-9`} />
                ))}
              </div>
              <div className="text-sm">
                <p className="font-semibold text-mist-50">{group.name}</p>
                <p className="text-mist-400">{group.role}</p>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Tipografia">
        <Surface className="space-y-3 p-5">
          <p className="font-display text-5xl font-bold tracking-tight tabular-nums">
            7,42<span className="ml-1 text-2xl text-aqua-300">L</span>
          </p>
          <p className="font-display text-xl font-semibold">Space Grotesk — títulos e números</p>
          <p className="text-[0.95rem] text-mist-300">Inter — textos de leitura, descrições e interface.</p>
          <p className="font-mono text-sm text-aqua-200">JetBrains Mono — distance_mm: 842</p>
        </Surface>
      </Section>

      <Section title="Botões">
        <div className="grid gap-3">
          <Button size="lg" icon={<Droplets className="size-5" />}>Aceitar missão</Button>
          <Button variant="leaf" icon={<Leaf className="size-5" />}>Concluir</Button>
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1">Detalhes</Button>
            <Button variant="ghost" className="flex-1">Cancelar</Button>
          </div>
          <Button variant="danger">Parar liberação</Button>
        </div>
      </Section>

      <Section title="Chips e estados">
        <div className="flex flex-wrap gap-2">
          <Chip tone="aqua" icon={<Droplets />}>3,0 L</Chip>
          <Chip tone="sun" icon={<Sparkles />}>+50 XP</Chip>
          <Chip icon={<Timer />}>10 min</Chip>
          <Chip icon={<MapPin />}>Jardim</Chip>
          <Chip tone="ember">Atenção</Chip>
          <Chip tone="alert">Crítico</Chip>
          <SimulationBadge />
        </div>
        <div className="flex flex-wrap gap-2">
          {DEVICE_STATUSES.map((status) => (
            <StatusPill key={status} status={status} />
          ))}
        </div>
      </Section>

      <Section title="Captador — estados visuais">
        <div className="grid grid-cols-3 gap-3">
          {tankStates.map((state) => (
            <Surface key={state.label} className="flex flex-col items-center gap-2 px-2 py-4">
              <div className="h-40">
                <CollectorTank {...state.props} />
              </div>
              <p className="text-center text-xs font-semibold text-mist-300">{state.label}</p>
            </Surface>
          ))}
        </div>
      </Section>

      <Section title="Progresso">
        <Surface className="space-y-4 p-5">
          <ProgressBar value={0.82} tone="sun" label="XP do nível" />
          <ProgressBar value={0.61} tone="aqua" label="Volume do captador" />
          <ProgressBar value={0.74} tone="leaf" label="Desafio coletivo" />
        </Surface>
      </Section>

      <Section title="Superfícies">
        <div className="grid grid-cols-2 gap-3">
          {surfaceTones.map((tone) => (
            <Surface key={tone} tone={tone} className="p-4 text-sm font-semibold">
              {tone}
            </Surface>
          ))}
        </div>
      </Section>

      <Section title="Carregamento">
        <Surface className="space-y-3 p-5">
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </Surface>
      </Section>
    </main>
  );
}
