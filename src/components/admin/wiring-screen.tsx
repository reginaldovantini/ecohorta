"use client";

import { ArrowLeft, BookOpen, Cable, ChevronDown, CircleCheck, History, Info, Microscope, Ruler, TriangleAlert, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { OriginBadge } from "@/components/ui/real-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Surface, type SurfaceTone } from "@/components/ui/surface";
import { useProfile } from "@/hooks/use-profile";
import { normalizeCollectorCode } from "@/lib/collector/code";
import {
  DISTANCE_SENSOR_MODELS,
  DISTANCE_SENSORS,
  isDistanceSensorModel,
  SENSOR_STATE_LABEL,
  SENSOR_WIRING,
  type DistanceSensorModel,
  type SensorCompatibility,
} from "@/lib/collector/distance-sensors";
import type { HardwareChangeRecord, HardwareView } from "@/lib/collector/hardware-view";
import { wiringGuide, type GuideSection, type WiringGuide } from "@/lib/collector/wiring-guide";
import { createHardwareApiSource, type HardwareSource } from "@/lib/iot/hardware-source";
import { profileStore } from "@/lib/student/profile-store";
import { cn } from "@/lib/utils/cn";
import { formatDecimal } from "@/lib/utils/format";
import { RestrictedNotice } from "./calibration-screen";
import { SensorModuleArt, WIRE_COLORS, WiringDiagram } from "./wiring-art";

const COMPATIBILITY_UI: Record<SensorCompatibility, { tone: SurfaceTone; title: string; icon: LucideIcon | null }> = {
  compatible: { tone: "leaf", title: "Compatível", icon: CircleCheck },
  incompatible: { tone: "alert", title: "⚠️ INCOMPATIBILIDADE DE HARDWARE", icon: null },
  sensor_missing: { tone: "ember", title: "Sensor não encontrado", icon: TriangleAlert },
  sensor_fault: { tone: "ember", title: "Falha no sensor", icon: TriangleAlert },
  awaiting_config: { tone: "default", title: "Aguardando o firmware aplicar a configuração", icon: Info },
  not_reported: { tone: "default", title: "O firmware não informa o sensor", icon: Info },
  offline: { tone: "default", title: "Dispositivo sem leitura recente", icon: Info },
};

const dateTime = (ms: number) =>
  new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(ms);
const shortDateTime = (ms: number) => new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(ms);

const inputClass =
  "h-11 w-full rounded-control bg-white/[0.05] px-3 text-base text-mist-50 outline-none ring-1 ring-inset ring-white/10 placeholder:text-mist-500 focus:ring-2 focus:ring-aqua-400";

/** Administração → Captadores → {código} → Ligações: sensor configurado, manual de ligações e histórico. */
export function WiringScreen({ code }: { code: string }) {
  const { status, role } = useProfile();
  const normalized = normalizeCollectorCode(code) ?? code.toUpperCase();

  if (status !== "ready") {
    return (
      <div className="space-y-4 pt-6" aria-busy="true" aria-label="Carregando">
        <Skeleton className="h-16 w-2/3" />
        <Skeleton className="h-64 w-full rounded-card" />
      </div>
    );
  }
  if (role !== "teacher" && role !== "admin") return <RestrictedNotice />;
  return <WiringWorkspace code={normalized} />;
}

function WiringWorkspace({ code }: { code: string }) {
  const [source] = useState(() => createHardwareApiSource(code, { onUnauthorized: () => profileStore.markSignedOut() }));
  useEffect(() => source.start(), [source]);
  const state = useSyncExternalStore(source.subscribe, source.getState, source.getServerState);
  const [pending, setPending] = useState<DistanceSensorModel | null>(null);
  const [preview, setPreview] = useState<DistanceSensorModel | null>(null);
  const [notice, setNotice] = useState<{ tone: "leaf" | "alert"; text: string } | null>(null);
  const { view } = state;

  if (!view) {
    return (
      <div className="space-y-4 pt-6" aria-busy={!state.error}>
        <BackLink />
        {state.error ? (
          <Surface tone="alert" className="p-5 text-sm text-mist-100">
            {state.error}
          </Surface>
        ) : (
          <>
            <Skeleton className="h-16 w-2/3" />
            <Skeleton className="h-64 w-full rounded-card" />
          </>
        )}
      </div>
    );
  }

  const { collector, configuration } = view;
  const manualModel = preview ?? configuration.distanceSensor;

  return (
    <div className="space-y-5 pt-6">
      <BackLink />
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow">Administração · Ligações</p>
          <h1 className="mt-0.5 font-display text-[1.75rem] font-bold leading-tight tracking-tight text-mist-50">{collector.code}</h1>
          <p className="mt-1 truncate text-sm text-mist-400">
            {collector.name} · {collector.deviceKey ?? "sem dispositivo"}
          </p>
        </div>
        <OriginBadge origin={collector.isSimulated ? "simulation" : "device"} className="mt-1" />
      </header>

      <SensorsPanel view={view} busy={state.busy} onSelect={(model) => setPending(model)} />

      {notice && (
        <Surface tone={notice.tone} role="status" className="p-4 text-sm text-mist-100">
          {notice.text}
        </Surface>
      )}

      <WiringManual guide={wiringGuide(manualModel)} configured={configuration.distanceSensor} code={collector.code} onPreview={setPreview} />
      <ChangeHistory items={view.history} />

      <ChangeSheet
        view={view}
        next={pending}
        source={source}
        busy={state.busy}
        onClose={() => setPending(null)}
        onDone={(change) => {
          setPending(null);
          setPreview(null);
          setNotice({
            tone: "leaf",
            text: `Sensor trocado para ${change.newSensor} (revisão ${change.revision}). O firmware passa a usar o novo driver na próxima leitura. ${
              change.supersededCalibrationVersion !== null ? `A calibração v${change.supersededCalibrationVersion} foi substituída: ` : ""
            }calibre o captador com o novo sensor.`,
          });
        }}
      />
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/admin/captadores" className="inline-flex items-center gap-1.5 text-sm font-semibold text-mist-300">
      <ArrowLeft className="size-4" aria-hidden /> Captadores
    </Link>
  );
}

function Tile({ label, value, hint, large = false }: { label: string; value: ReactNode; hint?: string; large?: boolean }) {
  return (
    <div className="min-w-0 rounded-2xl bg-white/[0.05] px-3 py-2.5">
      <dt className="eyebrow">{label}</dt>
      <dd className={cn("mt-0.5 truncate font-display font-bold tabular-nums text-mist-50", large ? "text-xl" : "text-base")}>{value}</dd>
      {hint && <dd className="truncate text-[11px] text-mist-400">{hint}</dd>}
    </div>
  );
}

function CompatibilityBanner({ state, message }: { state: SensorCompatibility; message: string }) {
  const ui = COMPATIBILITY_UI[state];
  const Icon = ui.icon;
  return (
    <Surface tone={ui.tone} role={state === "incompatible" ? "alert" : "status"} className="p-3.5">
      <p className={cn("flex items-center gap-2 font-display text-sm font-bold", state === "incompatible" ? "text-alert-400" : "text-mist-50")}>
        {Icon && <Icon className={cn("size-4 shrink-0", state === "compatible" ? "text-leaf-400" : state === "sensor_missing" || state === "sensor_fault" ? "text-ember-400" : "text-mist-400")} aria-hidden />}
        {ui.title}
      </p>
      <p className="mt-1 text-xs leading-relaxed text-mist-300">{message}</p>
    </Surface>
  );
}

function SensorsPanel({ view, busy, onSelect }: { view: HardwareView; busy: boolean; onSelect: (model: DistanceSensorModel) => void }) {
  const { configuration, device, calibration, compatibility } = view;
  const configured = configuration.distanceSensor;
  const locked = busy || view.dispenseActive;

  return (
    <Surface tone={view.collector.isSimulated ? "sim" : "aqua"} className="space-y-4 p-4">
      <p className="flex items-center gap-2 font-display font-semibold text-mist-50">
        <Cable className="size-5 text-aqua-300" aria-hidden /> Sensores e Ligações
      </p>

      <CompatibilityBanner state={compatibility.state} message={compatibility.message} />

      <dl className="grid grid-cols-2 gap-2">
        <Tile label="Sensor configurado" value={configured} hint="na plataforma" large />
        <Tile label="Firmware esperado" value={configured} hint={`driver ${configured}Driver`} large />
        <Tile
          label="Reportado pelo firmware"
          value={
            <span className={cn(device.reportedSensor !== null && device.reportedSensor !== configured && "text-alert-400")}>
              {device.reportedSensor ?? "—"}
            </span>
          }
          hint={
            !device.online
              ? "sem leitura recente"
              : device.reportedSensor === null
                ? "não informado"
                : device.reportedRevision !== null
                  ? `revisão ${device.reportedRevision} aplicada`
                  : "revisão não informada"
          }
        />
        <Tile
          label="Estado do sensor"
          value={device.sensorState ? SENSOR_STATE_LABEL[device.sensorState] : "—"}
          hint={[device.modelId ? `id ${device.modelId}` : null, device.i2cClockHz ? `${formatDecimal(device.i2cClockHz / 1000, 0)} kHz` : null].filter(Boolean).join(" · ") || undefined}
        />
        <Tile
          label="Configuração"
          value={`revisão ${configuration.revision}`}
          hint={configuration.updatedAt !== null ? `${shortDateTime(configuration.updatedAt)}${configuration.updatedBy ? ` · ${configuration.updatedBy}` : ""}` : "configuração inicial"}
        />
        <Tile
          label="Calibração"
          value={calibration ? `v${calibration.version} · ${calibration.sensorModel}` : "—"}
          hint={!calibration ? "nenhuma ativa" : calibration.applies ? "vale para este sensor" : "de outra configuração"}
        />
      </dl>

      <label className="block space-y-1.5">
        <span className="text-sm font-semibold text-mist-50">Sensor de distância</span>
        <span className="relative block">
          <select
            className={cn(inputClass, "appearance-none pr-10 font-semibold")}
            value={configured}
            disabled={locked}
            onChange={(event) => {
              const next = event.target.value;
              if (isDistanceSensorModel(next) && next !== configured) onSelect(next);
            }}
          >
            {DISTANCE_SENSOR_MODELS.map((model) => (
              <option key={model} value={model}>
                {model} · {DISTANCE_SENSORS[model].rangeSummary.split(" (")[0]}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-mist-400" aria-hidden />
        </span>
        <span className="block text-xs leading-relaxed text-mist-400">
          {view.dispenseActive
            ? "Há uma liberação em andamento: a troca do sensor fica disponível quando ela terminar."
            : "A escolha fica salva na plataforma e segue para o firmware na resposta de cada leitura. Trocar exige confirmação."}
        </span>
      </label>

      <div className="grid grid-cols-2 gap-2">
        <Link
          href={`/admin/captadores/${encodeURIComponent(view.collector.code)}/bancada`}
          className="flex h-11 items-center justify-center gap-2 rounded-control bg-white/[0.07] text-sm font-semibold text-mist-50 ring-1 ring-inset ring-white/10"
        >
          <Microscope className="size-4" aria-hidden /> Bancada
        </Link>
        <Link
          href={`/admin/captadores/${encodeURIComponent(view.collector.code)}/calibracao`}
          className="flex h-11 items-center justify-center gap-2 rounded-control bg-white/[0.07] text-sm font-semibold text-mist-50 ring-1 ring-inset ring-white/10"
        >
          <Ruler className="size-4" aria-hidden /> Calibração
        </Link>
      </div>
    </Surface>
  );
}

function ChangeSheet({
  view,
  next,
  source,
  busy,
  onClose,
  onDone,
}: {
  view: HardwareView;
  next: DistanceSensorModel | null;
  source: HardwareSource;
  busy: boolean;
  onClose: () => void;
  onDone: (change: HardwareChangeRecord) => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const current = view.configuration.distanceSensor;

  const close = () => {
    setConfirmed(false);
    setNote("");
    setError(null);
    onClose();
  };

  const submit = async () => {
    if (!next || !confirmed) return;
    const result = await source.changeSensor({ distance_sensor: next, confirm_physical_match: true, note: note.trim() || null });
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setConfirmed(false);
    setNote("");
    setError(null);
    onDone(result.value);
  };

  return (
    <BottomSheet open={next !== null} onClose={close} title="Alteração de hardware" description={next ? `Sensor de distância: ${current} → ${next}` : undefined}>
      {next && (
        <div className="space-y-4 pb-5">
          <ul className="space-y-2 text-sm leading-relaxed text-mist-100">
            <li className="flex gap-2">
              <span aria-hidden className="text-aqua-300">•</span>
              <span>
                Muda o driver e a lógica que o firmware usa: ele passa a ler o <strong className="text-mist-50">{next}</strong> a partir da próxima leitura.
                A ligação não muda (4 vias, GPIO{SENSOR_WIRING.sdaGpio} e GPIO{SENSOR_WIRING.sclGpio}).
              </span>
            </li>
            <li className="flex gap-2">
              <span aria-hidden className="text-aqua-300">•</span>
              <span>
                {view.calibration
                  ? `A calibração ativa v${view.calibration.version} (${view.calibration.sensorModel}) deixa de valer e fica no histórico. Será preciso calibrar de novo.`
                  : "Depois da troca, calibre o captador com o novo sensor."}
              </span>
            </li>
            <li className="flex gap-2">
              <span aria-hidden className="text-aqua-300">•</span>
              <span>Inicia um ensaio de bancada: as missões ficam bloqueadas até testar e calibrar. Nenhuma válvula é acionada.</span>
            </li>
            {view.collector.isSimulated && (
              <li className="flex gap-2">
                <span aria-hidden className="text-sim-300">•</span>
                <span>SIMULAÇÃO: o dispositivo virtual troca o sensor na hora.</span>
              </li>
            )}
          </ul>

          <label className="flex items-start gap-3 rounded-2xl bg-white/[0.05] p-3 ring-1 ring-inset ring-white/10">
            <input
              type="checkbox"
              className="mt-0.5 size-5 shrink-0 accent-aqua-400"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            <span className="text-sm font-semibold leading-snug text-mist-50">Confirmo que o sensor físico instalado corresponde ao sensor selecionado.</span>
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-semibold text-mist-100">Nota — opcional</span>
            <input className={inputClass} maxLength={280} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Ex.: módulo trocado na bancada" />
          </label>

          {error && (
            <p role="alert" className="text-sm text-alert-400">
              {error}
            </p>
          )}

          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={close} disabled={busy}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={() => void submit()} disabled={!confirmed || busy}>
              Confirmar
            </Button>
          </div>
        </div>
      )}
    </BottomSheet>
  );
}

function WiringManual({
  guide,
  configured,
  code,
  onPreview,
}: {
  guide: WiringGuide;
  configured: DistanceSensorModel;
  code: string;
  onPreview: (model: DistanceSensorModel | null) => void;
}) {
  const spec = DISTANCE_SENSORS[guide.model];
  const previewing = guide.model !== configured;

  return (
    <section className="space-y-4" aria-labelledby="manual-title">
      <div className="space-y-2">
        <h2 id="manual-title" className="flex items-center gap-2 font-display text-lg font-bold text-mist-50">
          <BookOpen className="size-5 text-aqua-300" aria-hidden /> Manual de ligações
        </h2>
        <div role="radiogroup" aria-label="Manual do sensor" className="grid grid-cols-2 gap-2">
          {DISTANCE_SENSOR_MODELS.map((model) => (
            <button
              key={model}
              type="button"
              role="radio"
              aria-checked={guide.model === model}
              onClick={() => onPreview(model === configured ? null : model)}
              className={cn(
                "flex h-11 flex-col items-center justify-center rounded-xl text-sm font-semibold leading-tight ring-1 ring-inset",
                guide.model === model ? "bg-aqua-400/15 text-aqua-300 ring-aqua-400/50" : "bg-white/[0.04] text-mist-300 ring-white/10",
              )}
            >
              {model}
              <span className="text-[10px] font-medium text-mist-400">{model === configured ? "configurado" : "ver manual"}</span>
            </button>
          ))}
        </div>
        {previewing && (
          <p className="rounded-xl bg-sun-400/10 px-3 py-2 text-xs text-sun-300 ring-1 ring-inset ring-sun-400/25">
            Consulta do manual do {guide.model}. O sensor configurado continua sendo o {configured}.
          </p>
        )}
      </div>

      <Surface className="space-y-4 p-4">
        <SensorModuleArt model={guide.model} />
        <p className="text-center text-[11px] text-mist-500">Ilustração esquemática: a ordem dos pinos varia entre módulos. Siga os rótulos da sua placa.</p>
        <div>
          <p className="font-display text-xl font-bold text-mist-50">{guide.model}</p>
          <p className="text-sm text-mist-300">{guide.kind}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Chip tone="aqua">{spec.rangeSummary}</Chip>
            <Chip tone="neutral">cone {spec.fieldOfViewDeg}°</Chip>
            <Chip tone="neutral">endereço I²C {SENSOR_WIRING.address}</Chip>
            <Chip tone="neutral">ID {spec.identification.value}</Chip>
          </div>
        </div>
        <ManualBlock title="Função">
          <p>{guide.function}</p>
        </ManualBlock>
        <ManualBlock title="Como funciona">
          {guide.principle.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </ManualBlock>
        <dl className="divide-y divide-white/[0.06] text-sm">
          {guide.specs.map((item) => (
            <div key={item.label} className="grid grid-cols-[7.5rem_1fr] gap-3 py-2">
              <dt className="text-mist-400">{item.label}</dt>
              <dd className="text-mist-50">{item.value}</dd>
            </div>
          ))}
        </dl>
      </Surface>

      <Surface className="space-y-3 p-4">
        <p className="eyebrow">Diagrama de ligação · {guide.model}</p>
        <WiringDiagram model={guide.model} />
        <p className="text-[11px] leading-relaxed text-mist-400">
          * VCC na alimentação adequada ao módulo: 3V3 na maioria dos casos (ver Alimentação). Cores sugeridas (padrão Qwiic/STEMMA QT):{" "}
          {Object.entries(WIRE_COLORS)
            .map(([wire, color]) => `${wire} ${color.name}`)
            .join(", ")}
          . Anote as cores reais do seu cabo.
        </p>
      </Surface>

      <Surface className="p-4">
        <p className="eyebrow mb-2">Ligações · cabo de {SENSOR_WIRING.cableConductors} vias</p>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-mist-400">
              <th scope="col" className="w-10 py-1.5 font-semibold">
                Via
              </th>
              <th scope="col" className="py-1.5 font-semibold">
                Sensor
              </th>
              <th scope="col" className="py-1.5 font-semibold">
                ESP32 DevKit V1
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.06]">
            {guide.connections.map((connection) => {
              const wire = connection.sensorPin.split(" ")[0] as keyof typeof WIRE_COLORS;
              const color = connection.via !== null ? WIRE_COLORS[wire] : null;
              return (
                <tr key={connection.sensorPin} className={cn(connection.via === null && "text-mist-400")}>
                  <td className="py-2 align-top">
                    {color ? (
                      <span className="inline-flex items-center gap-1.5 font-mono text-mist-100">
                        <span aria-hidden className="size-2.5 rounded-full ring-1 ring-white/30" style={{ backgroundColor: color.stroke }} />
                        {connection.via}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="py-2 pr-2 align-top font-semibold text-mist-50">{connection.sensorPin}</td>
                  <td className="py-2 align-top">
                    <span className={cn("font-semibold", connection.via === null ? "text-alert-400" : "text-mist-50")}>{connection.esp32}</span>
                    <span className="block text-[11px] text-mist-400">{connection.note}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Surface>

      <Surface tone="ember" className="space-y-3 p-4">
        <p className="flex items-center gap-2 font-display font-semibold text-mist-50">
          <TriangleAlert className="size-5 text-ember-400" aria-hidden /> Alimentação: não assuma 5 V
        </p>
        <p className="text-sm leading-relaxed text-mist-100">{guide.power.intro}</p>
        <dl className="space-y-2 text-sm">
          {guide.power.options.map((option) => (
            <div key={option.module} className="rounded-xl bg-white/[0.05] px-3 py-2">
              <dt className="text-xs text-mist-400">{option.module}</dt>
              <dd className="font-semibold text-mist-50">{option.connectTo}</dd>
            </div>
          ))}
        </dl>
        <div>
          <p className="text-xs font-semibold text-mist-100">Antes de ligar SDA e SCL ao ESP32:</p>
          <ol className="mt-1 list-decimal space-y-1 pl-5 text-xs leading-relaxed text-mist-300">
            {guide.power.check.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>
      </Surface>

      <div className="space-y-2">
        {guide.sections.map((section) => (
          <GuideAccordion key={section.id} section={section} code={code} />
        ))}
      </div>

      <ul className="space-y-1 text-[11px] leading-relaxed text-mist-500">
        {guide.sources.map((source) => (
          <li key={source}>{source}</li>
        ))}
      </ul>
    </section>
  );
}

function ManualBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5 text-sm leading-relaxed text-mist-100">
      <p className="eyebrow">{title}</p>
      {children}
    </div>
  );
}

function GuideAccordion({ section, code }: { section: GuideSection; code: string }) {
  const base = `/admin/captadores/${encodeURIComponent(code)}`;
  const action = section.id === "teste" ? { href: `${base}/bancada`, label: "Abrir a Bancada" } : section.id === "calibracao" ? { href: `${base}/calibracao`, label: "Abrir a Calibração" } : null;
  return (
    <details className="group rounded-card border border-white/[0.06] bg-abyss-800/80">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 font-display text-sm font-semibold text-mist-50 [&::-webkit-details-marker]:hidden">
        {section.title}
        <ChevronDown className="size-4 shrink-0 text-mist-400 transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="space-y-3 px-4 pb-4 text-sm leading-relaxed text-mist-100">
        {section.bullets && (
          <ul className="space-y-1.5">
            {section.bullets.map((item) => (
              <li key={item} className="flex gap-2">
                <span aria-hidden className="text-aqua-300">•</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        )}
        {section.steps && (
          <ol className="list-decimal space-y-1.5 pl-5">
            {section.steps.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ol>
        )}
        {action && (
          <Link href={action.href} className="inline-flex items-center gap-2 font-semibold text-aqua-300">
            {section.id === "teste" ? <Microscope className="size-4" aria-hidden /> : <Ruler className="size-4" aria-hidden />} {action.label}
          </Link>
        )}
      </div>
    </details>
  );
}

function ChangeHistory({ items }: { items: HardwareChangeRecord[] }) {
  return (
    <Surface className="p-4">
      <p className="flex items-center gap-2 font-display font-semibold text-mist-50">
        <History className="size-5 text-aqua-300" aria-hidden /> Histórico de hardware
      </p>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-mist-400">Nenhuma troca de sensor. O captador está na configuração inicial (revisão 1).</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {items.map((item) => (
            <li key={item.id} className="rounded-2xl bg-white/[0.04] p-3 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-mist-50">
                  {item.previousSensor} → {item.newSensor}
                </span>
                <Chip tone="neutral" className="h-6">
                  revisão {item.revision}
                </Chip>
                {item.isSimulated && (
                  <Chip tone="sim" className="h-6">
                    SIMULAÇÃO
                  </Chip>
                )}
              </div>
              <p className="mt-1 text-mist-400">
                {dateTime(item.changedAt)}
                {item.changedBy && ` · ${item.changedBy}`} · sensor físico confirmado
                {item.supersededCalibrationVersion !== null && ` · calibração v${item.supersededCalibrationVersion} substituída`}
                {item.cancelledCalibration && " · calibração em andamento cancelada"}
              </p>
              {item.note && <p className="mt-1 text-mist-300">{item.note}</p>}
            </li>
          ))}
        </ul>
      )}
    </Surface>
  );
}
