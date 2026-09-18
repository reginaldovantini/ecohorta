"use client";

import { ArrowLeft, Check, CircleAlert, CircleCheck, FlaskConical, ListChecks, Microscope, RotateCcw, Ruler } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { useCollectorSnapshot, useCollectorSource } from "@/components/collector/collector-source";
import { OriginBadge } from "@/components/ui/real-badge";
import { Button } from "@/components/ui/button";
import { Chip, type ChipTone } from "@/components/ui/chip";
import { Skeleton } from "@/components/ui/skeleton";
import { Surface } from "@/components/ui/surface";
import { useNow } from "@/hooks/use-now";
import { useProfile } from "@/hooks/use-profile";
import { CALIBRATION_STATUS_LABEL, type CalibrationRecord, type CalibrationView } from "@/lib/collector/calibration-view";
import { normalizeCollectorCode } from "@/lib/collector/code";
import { STABILITY_LABEL, type DistanceStability } from "@/lib/collector/distance-stability";
import { getLevelState } from "@/lib/collector/level-state";
import {
  CALIBRATION_QUALITY_LABEL,
  CALIBRATION_STEPS,
  type CalibrationDistances,
  type CalibrationFit,
  type CalibrationQuality,
  type CalibrationStepId,
} from "@/lib/collector/volume-calibration";
import { createCalibrationApiSource, type CalibrationActionResult } from "@/lib/iot/calibration-source";
import { profileStore } from "@/lib/student/profile-store";
import { cn } from "@/lib/utils/cn";
import { formatDecimal, formatLiters, formatPercent, formatRelativeTime } from "@/lib/utils/format";
import { CalibrationChart } from "./calibration-chart";
import { HardwareAlert } from "./hardware-alert";

const QUALITY_TONE: Record<CalibrationQuality, ChipTone> = { good: "leaf", acceptable: "sun", inconsistent: "alert" };
const STABILITY_DOT: Record<DistanceStability["state"], string> = {
  stable: "bg-leaf-400",
  stabilizing: "bg-sun-400 animate-pulse",
  invalid: "bg-alert-400",
};

const mm = (value: number | null, digits = 0) => (value === null ? "—" : `${formatDecimal(value, digits)} mm`);
const dateTime = (ms: number) =>
  new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(ms);

/** Administração → Captadores → {código} → Calibração de volume. */
export function CalibrationScreen({ code }: { code: string }) {
  const { status, role } = useProfile();
  const normalized = normalizeCollectorCode(code) ?? code.toUpperCase();

  if (status !== "ready") {
    return (
      <div className="space-y-4 pt-6" aria-busy="true" aria-label="Carregando">
        <Skeleton className="h-16 w-2/3" />
        <Skeleton className="h-56 w-full rounded-card" />
      </div>
    );
  }
  if (role !== "teacher" && role !== "admin") return <RestrictedNotice />;
  return <CalibrationWorkspace code={normalized} />;
}

export function RestrictedNotice() {
  return (
    <div className="space-y-4 pt-6">
      <Surface className="p-6 text-center">
        <p className="font-display text-lg font-semibold text-mist-50">Área restrita</p>
        <p className="mt-1 text-sm text-mist-400">A administração de captadores é exclusiva de professores e administradores.</p>
        <Link href="/" className="mt-4 inline-flex h-10 items-center rounded-xl bg-white/[0.07] px-4 text-sm font-semibold text-mist-50">
          Voltar ao início
        </Link>
      </Surface>
    </div>
  );
}

function CalibrationWorkspace({ code }: { code: string }) {
  const [source] = useState(() => createCalibrationApiSource(code, { onUnauthorized: () => profileStore.markSignedOut() }));
  useEffect(() => source.start(), [source]);
  const state = useSyncExternalStore(source.subscribe, source.getState, source.getServerState);
  const [notice, setNotice] = useState<{ tone: "leaf" | "alert"; text: string } | null>(null);
  const [redoStep, setRedoStep] = useState<CalibrationStepId | null>(null);
  const { view } = state;

  const run = async (action: () => Promise<CalibrationActionResult>, success?: string) => {
    setNotice(null);
    const result = await action();
    if (!result.ok) setNotice({ tone: "alert", text: result.message });
    else if (success) setNotice({ tone: "leaf", text: success });
    return result.ok;
  };

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
            <Skeleton className="h-56 w-full rounded-card" />
          </>
        )}
      </div>
    );
  }

  const { draft, active, collector } = view;
  const currentStep = draft ? (redoStep ?? draft.nextStep) : null;
  const completion = state.lastCompletion;

  return (
    <div className="space-y-5 pt-6">
      <BackLink />
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow">Administração · Calibração de volume</p>
          <h1 className="mt-0.5 font-display text-[1.75rem] font-bold leading-tight tracking-tight text-mist-50">{collector.code}</h1>
          <p className="mt-1 truncate text-sm text-mist-400">
            {collector.name} · {collector.location}
          </p>
        </div>
        <OriginBadge origin={collector.isSimulated ? "simulation" : "device"} className="mt-1" />
      </header>

      <HardwareAlert hardware={view.hardware} code={collector.code} />
      <LiveReading view={view} />

      {collector.benchActive && (
        <p className="rounded-2xl bg-ember-400/10 px-4 py-3 text-xs leading-relaxed text-mist-300 ring-1 ring-inset ring-ember-400/25" role="status">
          <strong className="text-mist-50">Ensaio de bancada ativo.</strong> A água colocada à mão não entra no balanço hídrico e as missões
          deste captador ficam bloqueadas até o ensaio terminar.
        </p>
      )}

      {notice && (
        <Surface tone={notice.tone} role="status" className="p-4 text-sm text-mist-100">
          {notice.text}
        </Surface>
      )}

      {!draft && (
        <>
          {completion && (
            <Surface tone={completion.status === "active" ? "leaf" : "alert"} className="p-4 text-sm text-mist-100" role="status">
              {completion.status === "active"
                ? `Calibração versão ${completion.version} ativada. O volume deste captador passa a ser calculado pela distância medida.`
                : `Tentativa registrada como versão ${completion.version} (inconsistente). A calibração anterior continua valendo.`}
            </Surface>
          )}
          {active ? (
            <ActiveCalibration record={active} nominalDiameterMm={collector.nominalDiameterMm} appliesToDevice={view.activeAppliesToDevice} />
          ) : (
            <NoCalibration />
          )}
          {active && view.activeAppliesToDevice && (
            <Link
              href={`/admin/captadores/${encodeURIComponent(collector.code)}/bancada`}
              className="flex items-center justify-center gap-2 rounded-control bg-white/[0.07] px-4 py-3 text-sm font-semibold text-mist-50 ring-1 ring-inset ring-white/10"
            >
              <Microscope className="size-4" aria-hidden /> Validar esta calibração na bancada
            </Link>
          )}
          <Preparation />
          <Button
            size="lg"
            variant={active ? "secondary" : "leaf"}
            className="w-full"
            disabled={state.busy}
            icon={<Ruler className="size-5" />}
            onClick={() => void run(() => source.startSession())}
          >
            {active ? "Nova calibração" : "Iniciar calibração"}
          </Button>
        </>
      )}

      {draft && (
        <>
          {currentStep ? (
            <CurrentStep
              step={currentStep}
              stability={view.live.stability}
              busy={state.busy}
              simulated={collector.isSimulated}
              collectorCode={collector.code}
              redo={redoStep !== null}
              onRegister={async () => {
                if (await run(() => source.registerPoint(currentStep))) setRedoStep(null);
              }}
              onBack={() => setRedoStep(null)}
            />
          ) : (
            draft.preview && (
              <Summary
                distances={draft.distances as CalibrationDistances}
                fit={draft.preview}
                nominalDiameterMm={draft.nominalDiameterMm}
                busy={state.busy}
                onActivate={() => void run(() => source.complete())}
                onRejectAndRestart={async () => {
                  if (await run(() => source.complete())) await run(() => source.startSession());
                }}
              />
            )
          )}

          <StepList
            draft={draft}
            current={currentStep}
            onRedo={(step) => {
              setNotice(null);
              setRedoStep(step === draft.nextStep ? null : step);
            }}
          />

          <Button
            variant="ghost"
            className="w-full"
            disabled={state.busy}
            icon={<RotateCcw className="size-4" />}
            onClick={() => {
              setRedoStep(null);
              void run(() => source.cancel(), "Procedimento cancelado. Nenhuma calibração foi alterada.");
            }}
          >
            Cancelar procedimento
          </Button>
        </>
      )}

      <HistoryList records={view.history} />
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

function LiveReading({ view }: { view: CalibrationView }) {
  const now = useNow(1000);
  const { live } = view;
  const { stability } = live;
  const distance = stability.distanceMm ?? live.lastDistanceMm;

  return (
    <Surface tone={view.collector.isSimulated ? "sim" : "aqua"} className="p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="eyebrow text-mist-100">Distância atual · {view.hardware.distanceSensor}</p>
        <Chip tone={live.online ? "leaf" : "neutral"}>{live.online ? "Recebendo leituras" : "Sem leitura recente"}</Chip>
      </div>

      <p className="mt-3 font-display text-5xl font-bold leading-none tracking-tight text-mist-50">
        {distance === null ? "—" : formatDecimal(distance, 0)}
        <span className="ml-1.5 text-xl text-aqua-300">mm</span>
      </p>
      <p className="mt-1 text-sm text-mist-300">{distance === null ? "Aguardando o sensor" : `${formatDecimal(distance / 10, 1)} cm`}</p>

      <dl className="mt-4 grid grid-cols-3 gap-2">
        <Stat label="Estado">
          <span className="flex items-center justify-center gap-1.5">
            <span aria-hidden className={cn("size-2.5 rounded-full", STABILITY_DOT[stability.state])} />
            {STABILITY_LABEL[stability.state]}
          </span>
        </Stat>
        <Stat label="Variação">{stability.stdMm === null ? "—" : `±${formatDecimal(stability.stdMm, 1)} mm`}</Stat>
        <Stat label="Leituras">{String(stability.readings)}</Stat>
      </dl>
      <p className="mt-2 text-xs text-mist-400" role="status">
        {stability.message}
        {live.measuredAt !== null && now !== null && ` · última leitura ${formatRelativeTime(live.measuredAt, now)}`}
      </p>

      <div className="mt-4 border-t border-white/[0.08] pt-3">
        {live.volume ? (
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="eyebrow">Volume calculado</p>
              <p className="font-display text-2xl font-bold text-mist-50">
                {formatLiters(live.volume.liters)}
                <span className="ml-2 text-base text-mist-300">{formatPercent(live.volume.fillRatio)}</span>
              </p>
            </div>
            <div className="text-right text-xs text-mist-400">
              <p>Coluna {mm(live.volume.heightMm)}</p>
              <p>{getLevelState(live.volume.fillRatio).label}</p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-mist-400">Volume: sem calibração ativa, a plataforma ainda não converte a distância em litros.</p>
        )}
        {live.volume?.belowZero && <p className="mt-2 text-xs text-sun-300">Superfície abaixo do nível ZERO (zona de decantação).</p>}
        {live.volume?.aboveMaximum && <p className="mt-2 text-xs text-ember-400">Superfície acima do nível máximo (dreno de segurança).</p>}
      </div>
    </Surface>
  );
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl bg-white/[0.05] px-2 py-2.5 text-center">
      <dt className="text-[11px] text-mist-400">{label}</dt>
      <dd className="mt-0.5 font-display text-sm font-semibold text-mist-50">{children}</dd>
    </div>
  );
}

function NoCalibration() {
  return (
    <Surface className="p-5">
      <p className="font-display font-semibold text-mist-50">Sem calibração de volume</p>
      <p className="mt-1 text-sm leading-relaxed text-mist-400">
        O volume em litros é calculado a partir da distância medida pelo sensor, com uma calibração experimental feita neste captador.
      </p>
    </Surface>
  );
}

function ActiveCalibration({
  record,
  nominalDiameterMm,
  appliesToDevice,
}: {
  record: CalibrationRecord;
  nominalDiameterMm: number | null;
  appliesToDevice: boolean;
}) {
  return (
    <Surface tone={appliesToDevice ? "leaf" : "ember"} className="p-5">
      {!appliesToDevice && (
        <p className="mb-3 text-sm leading-relaxed text-mist-100">
          <strong>Esta calibração foi feita com outro dispositivo</strong>
          {record.isSimulated ? " (SIMULAÇÃO)" : ""}. Ela não converte as leituras do dispositivo atual: faça uma nova calibração.
        </p>
      )}
      <div className="flex items-center justify-between gap-3">
        <p className="eyebrow text-leaf-300">Calibração ativa · versão {record.version}</p>
        {record.quality && <Chip tone={QUALITY_TONE[record.quality]}>{CALIBRATION_QUALITY_LABEL[record.quality]}</Chip>}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <Row label="Capacidade efetiva estimada" value={record.effectiveCapacityLiters === null ? "—" : formatLiters(record.effectiveCapacityLiters)} />
        <Row label="Altura útil" value={mm(record.effectiveHeightMm)} />
        <Row label="Diâmetro nominal" value={mm(nominalDiameterMm)} />
        <Row label="Diâmetro efetivo estimado" value={mm(record.effectiveDiameterMm, 1)} />
        <Row label="Constante" value={record.constantLitersPerMm === null ? "—" : `${formatDecimal(record.constantLitersPerMm, 5)} L/mm`} />
        <Row label="Sensor" value={`${record.sensorModel} · revisão ${record.hardwareRevision}`} />
      </dl>
      <p className="mt-3 text-xs text-mist-400">
        {record.activatedAt !== null && `Ativada em ${dateTime(record.activatedAt)}`}
        {record.createdBy && ` · por ${record.createdBy}`}
        {record.isSimulated && " · feita com o dispositivo virtual (SIMULAÇÃO)"}
      </p>
    </Surface>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-mist-400">{label}</dt>
      <dd className="truncate font-display font-semibold tabular-nums text-mist-50">{value}</dd>
    </div>
  );
}

function Preparation() {
  const items = [
    "Mantenha a válvula fechada e desvie o condensado do ar-condicionado durante todo o procedimento.",
    "Use uma jarra ou proveta graduada para medir exatamente 1,00 L por vez.",
    "Nível ZERO: centro da saída da válvula. Nível máximo: saída do dreno de segurança.",
    "Não toque no tubo nem no sensor enquanto as leituras estabilizam.",
  ];
  return (
    <Surface className="p-5">
      <p className="flex items-center gap-2 font-display font-semibold text-mist-50">
        <ListChecks className="size-5 text-aqua-300" aria-hidden /> Antes de começar
      </p>
      <ul className="mt-3 space-y-2 text-sm leading-relaxed text-mist-300">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <Check className="mt-0.5 size-4 shrink-0 text-leaf-400" aria-hidden />
            {item}
          </li>
        ))}
      </ul>
    </Surface>
  );
}

function StepList({
  draft,
  current,
  onRedo,
}: {
  draft: NonNullable<CalibrationView["draft"]>;
  current: CalibrationStepId | null;
  onRedo: (step: CalibrationStepId) => void;
}) {
  return (
    <Surface className="p-4">
      <p className="eyebrow mb-2">Etapas</p>
      <ol className="space-y-1">
        {CALIBRATION_STEPS.map((step, index) => {
          const point = draft.points[step.id];
          const registered = point !== undefined && draft.distances[distanceKey(step.id)] !== null;
          const isCurrent = current === step.id;
          return (
            <li
              key={step.id}
              className={cn("flex items-center gap-3 rounded-2xl px-2 py-2", isCurrent && "bg-aqua-400/10 ring-1 ring-inset ring-aqua-400/30")}
            >
              <span
                className={cn(
                  "grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold",
                  registered ? "bg-leaf-400 text-abyss-950" : isCurrent ? "bg-aqua-400 text-abyss-950" : "bg-white/[0.07] text-mist-400",
                )}
              >
                {registered ? <Check className="size-4" strokeWidth={3} aria-hidden /> : index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-mist-50">{step.label}</span>
                <span className="block text-xs tabular-nums text-mist-400">
                  {registered ? `${mm(point.distanceMm, 1)} · ±${formatDecimal(point.stdMm ?? 0, 1)} mm · ${point.readings} leituras` : "Pendente"}
                </span>
              </span>
              {registered && !isCurrent && (
                <button type="button" onClick={() => onRedo(step.id)} className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-aqua-300">
                  Refazer
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </Surface>
  );
}

function distanceKey(step: CalibrationStepId): keyof CalibrationDistances {
  return ({ zero: "zeroMm", one: "oneLiterMm", two: "twoLitersMm", three: "threeLitersMm", max: "maximumMm" } as const)[step];
}

function CurrentStep({
  step,
  stability,
  busy,
  simulated,
  collectorCode,
  redo,
  onRegister,
  onBack,
}: {
  step: CalibrationStepId;
  stability: DistanceStability;
  busy: boolean;
  simulated: boolean;
  collectorCode: string;
  redo: boolean;
  onRegister: () => Promise<void>;
  onBack: () => void;
}) {
  const index = CALIBRATION_STEPS.findIndex((item) => item.id === step);
  const definition = CALIBRATION_STEPS[index]!;
  const stable = stability.state === "stable";

  return (
    <Surface tone="aqua" className="space-y-4 p-5">
      <div>
        <p className="eyebrow text-aqua-300">
          Etapa {index + 1} de {CALIBRATION_STEPS.length}
          {redo && " · refazendo (as etapas seguintes serão descartadas)"}
        </p>
        <p className="mt-1 font-display text-3xl font-bold text-mist-50">{definition.label}</p>
        <p className="mt-2 text-[0.95rem] leading-relaxed text-mist-100">{definition.instruction}</p>
      </div>

      {simulated && <SimulationAssist collectorCode={collectorCode} step={step} />}

      <Button size="lg" variant="leaf" className="w-full" disabled={!stable || busy} onClick={() => void onRegister()}>
        {stable ? definition.action.toUpperCase() : "Aguardando leitura estável…"}
      </Button>
      {!stable && <p className="text-center text-xs text-mist-400">{stability.message}</p>}
      {redo && (
        <Button variant="ghost" size="sm" className="w-full" onClick={onBack}>
          Voltar para a próxima etapa
        </Button>
      )}
    </Surface>
  );
}

/** Na SIMULAÇÃO, ajusta o captador virtual para cada etapa (as leituras continuam vindo pela API IoT). */
function SimulationAssist({ collectorCode, step }: { collectorCode: string; step: CalibrationStepId }) {
  const source = useCollectorSource();
  const snapshot = useCollectorSnapshot(collectorCode);
  const [message, setMessage] = useState<string | null>(null);
  const definition = CALIBRATION_STEPS.find((item) => item.id === step)!;
  const target = definition.liters === null ? "o nível máximo" : definition.label;
  const inflow = snapshot?.simulation?.inflowEnabled ?? false;

  const send = async (request: Parameters<typeof source.updateSimulation>[1], done: string) => {
    const result = await source.updateSimulation(collectorCode, request);
    setMessage(result.ok ? done : (result.message ?? "Não foi possível ajustar a simulação."));
  };

  return (
    <div className="space-y-2 rounded-2xl bg-sim-400/10 p-3 ring-1 ring-inset ring-sim-400/25">
      <p className="flex items-center gap-2 text-xs font-semibold text-sim-300">
        <FlaskConical className="size-4" aria-hidden /> SIMULAÇÃO · captador virtual
      </p>
      <div className="grid gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() =>
            void send(
              { action: definition.liters === null ? { type: "set_level", ratio: 1 } : { type: "set_volume", liters: definition.liters } },
              `Captador virtual ajustado para ${target}.`,
            )
          }
        >
          Colocar {target} no captador virtual
        </Button>
        {inflow && (
          <Button variant="ghost" size="sm" onClick={() => void send({ settings: { inflowEnabled: false } }, "Entrada de condensado simulada desligada.")}>
            Desligar o condensado simulado
          </Button>
        )}
      </div>
      {message && <p className="text-xs text-mist-300">{message}</p>}
    </div>
  );
}

function Summary({
  distances,
  fit,
  nominalDiameterMm,
  busy,
  onActivate,
  onRejectAndRestart,
}: {
  distances: CalibrationDistances;
  fit: CalibrationFit;
  nominalDiameterMm: number | null;
  busy: boolean;
  onActivate: () => void;
  onRejectAndRestart: () => Promise<void>;
}) {
  const rows: [string, number, number | null][] = [
    ["0 L", distances.zeroMm, 0],
    ["1 L", distances.oneLiterMm, fit.heightsMm.one],
    ["2 L", distances.twoLitersMm, fit.heightsMm.two],
    ["3 L", distances.threeLitersMm, fit.heightsMm.three],
    ["Máximo", distances.maximumMm, fit.heightsMm.max],
  ];

  return (
    <div className="space-y-4">
      <Surface tone={fit.accepted ? "leaf" : "alert"} className="p-5">
        <div className="flex items-center justify-between gap-3">
          <p className="flex items-center gap-2 font-display text-xl font-bold text-mist-50">
            {fit.accepted ? <CircleCheck className="size-6 text-leaf-300" aria-hidden /> : <CircleAlert className="size-6 text-alert-400" aria-hidden />}
            {fit.accepted ? "Calibração concluída" : "Calibração inconsistente"}
          </p>
          <Chip tone={QUALITY_TONE[fit.quality]}>{CALIBRATION_QUALITY_LABEL[fit.quality]}</Chip>
        </div>
        {!fit.accepted && <p className="mt-2 text-sm text-mist-100">Calibração inconsistente. Revise as leituras e repita o procedimento.</p>}

        <table className="mt-4 w-full text-sm tabular-nums">
          <thead>
            <tr className="text-left text-[11px] text-mist-400">
              <th className="pb-1 font-medium">Ponto</th>
              <th className="pb-1 text-right font-medium">Distância</th>
              <th className="pb-1 text-right font-medium">Altura</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, distance, height]) => (
              <tr key={label} className="border-t border-white/[0.06]">
                <td className="py-1.5 font-semibold text-mist-50">{label}</td>
                <td className="py-1.5 text-right text-mist-100">{mm(distance, 1)}</td>
                <td className="py-1.5 text-right text-mist-300">{height === null ? "—" : mm(height, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-white/[0.08] pt-4 text-sm">
          <Row label="Constante" value={fit.constantLitersPerMm === null ? "—" : `${formatDecimal(fit.constantLitersPerMm, 5)} L/mm`} />
          <Row label="Capacidade efetiva estimada" value={fit.effectiveCapacityLiters === null ? "—" : formatLiters(fit.effectiveCapacityLiters)} />
          <Row label="Diâmetro nominal" value={mm(nominalDiameterMm)} />
          <Row label="Diâmetro efetivo estimado" value={mm(fit.effectiveDiameterMm, 1)} />
          <Row label="Altura útil" value={mm(fit.effectiveHeightMm)} />
          <Row label="Maior resíduo" value={fit.maxResidualLiters === null ? "—" : `±${formatDecimal(fit.maxResidualLiters, 3)} L`} />
        </dl>
        <p className="mt-3 text-xs leading-relaxed text-mist-400">
          O diâmetro efetivo é um resultado experimental e não substitui a medida física do tubo. A capacidade é uma estimativa até ser validada
          experimentalmente na bancada.
          {fit.extrapolationFactor !== null &&
            ` A capacidade é extrapolada: a altura útil é ${formatDecimal(fit.extrapolationFactor, 1)}× a altura do ponto de 3 L.`}
        </p>
      </Surface>

      <Surface className="p-4">
        <p className="eyebrow mb-3">Reta de calibração</p>
        <CalibrationChart distances={distances} fit={fit} />
      </Surface>

      <Surface className="p-4">
        <p className="eyebrow mb-2">Qualidade</p>
        <ul className="space-y-2">
          {fit.checks.map((check) => (
            <li key={check.id} className="flex gap-2.5 text-sm">
              {check.ok ? (
                <CircleCheck className="mt-0.5 size-4 shrink-0 text-leaf-400" aria-label="Aprovado" />
              ) : (
                <CircleAlert className="mt-0.5 size-4 shrink-0 text-alert-400" aria-label="Reprovado" />
              )}
              <span className="min-w-0">
                <span className="block font-semibold text-mist-50">{check.label}</span>
                <span className="block text-xs leading-relaxed text-mist-400">{check.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      </Surface>

      {fit.accepted ? (
        <Button size="lg" variant="leaf" className="w-full" disabled={busy} icon={<CircleCheck className="size-5" />} onClick={onActivate}>
          Ativar calibração
        </Button>
      ) : (
        <Button size="lg" variant="danger" className="w-full" disabled={busy} onClick={() => void onRejectAndRestart()}>
          Registrar tentativa e repetir
        </Button>
      )}
    </div>
  );
}

function HistoryList({ records }: { records: CalibrationRecord[] }) {
  if (records.length === 0) return null;
  return (
    <section className="space-y-3">
      <h2 className="eyebrow">Versões de calibração</h2>
      <ul className="space-y-2">
        {records.map((record) => (
          <li key={record.id}>
            <Surface className="flex items-start gap-3 p-3.5">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/[0.06] font-display text-sm font-bold text-mist-50">
                v{record.version}
              </span>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <p className="text-sm font-semibold text-mist-50">
                    {record.effectiveCapacityLiters !== null && record.status !== "rejected"
                      ? `${formatLiters(record.effectiveCapacityLiters)} · Ø ${mm(record.effectiveDiameterMm, 1)}`
                      : "Pontos inconsistentes"}
                  </p>
                  <Chip tone={record.status === "active" ? "leaf" : record.status === "rejected" ? "alert" : "neutral"} className="h-6">
                    {CALIBRATION_STATUS_LABEL[record.status]}
                  </Chip>
                </div>
                <p className="text-xs leading-relaxed text-mist-400">
                  {record.completedAt !== null && dateTime(record.completedAt)}
                  {record.createdBy && ` · ${record.createdBy}`}
                  {record.isSimulated && " · SIMULAÇÃO"}
                </p>
              </div>
            </Surface>
          </li>
        ))}
      </ul>
    </section>
  );
}
