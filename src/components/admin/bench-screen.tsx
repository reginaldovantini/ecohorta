"use client";

import { ArrowLeft, Download, FlaskConical, Microscope, NotebookPen, Ruler, Scale } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { OriginBadge } from "@/components/ui/real-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { Surface } from "@/components/ui/surface";
import { useNow } from "@/hooks/use-now";
import { useProfile } from "@/hooks/use-profile";
import {
  OBSERVATION_CONDITION_LABEL,
  OBSERVATION_CONDITIONS,
  type BenchView,
  type ObservationCondition,
  type SensorObservationRecord,
  type ValidationRecord,
} from "@/lib/collector/bench-view";
import { normalizeCollectorCode } from "@/lib/collector/code";
import { SENSOR_STATE_LABEL } from "@/lib/collector/distance-sensors";
import type { DistanceStability } from "@/lib/collector/distance-stability";
import { VALIDATION_METHOD_LABEL, VALIDATION_METHODS, type ValidationMethod } from "@/lib/collector/validation";
import { createBenchApiSource, type BenchSource } from "@/lib/iot/bench-source";
import { profileStore } from "@/lib/student/profile-store";
import { cn } from "@/lib/utils/cn";
import { formatDecimal, formatLiters, formatPercent, formatRelativeTime } from "@/lib/utils/format";
import { RestrictedNotice } from "./calibration-screen";
import { DistanceChart } from "./distance-chart";
import { HardwareAlert } from "./hardware-alert";

/** Na bancada o estado é lido como no instrumento: ESTÁVEL, INSTÁVEL ou INVÁLIDO. */
const STATE_LABEL: Record<DistanceStability["state"], string> = { stable: "ESTÁVEL", stabilizing: "INSTÁVEL", invalid: "INVÁLIDO" };
const STATE_DOT: Record<DistanceStability["state"], string> = { stable: "bg-leaf-400", stabilizing: "bg-sun-400 animate-pulse", invalid: "bg-alert-400" };

const mm = (value: number | null | undefined, digits = 0) => (value === null || value === undefined ? "—" : `${formatDecimal(value, digits)} mm`);
const signed = (value: number, digits: number, unit: string) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${formatDecimal(Math.abs(value), digits)}${unit}`;
const clock = (ms: number) => new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(ms);
const dateTime = (ms: number) =>
  new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(ms);

const inputClass =
  "h-11 w-full rounded-control bg-white/[0.05] px-3 text-base text-mist-50 outline-none ring-1 ring-inset ring-white/10 placeholder:text-mist-500 focus:ring-2 focus:ring-aqua-400";

/** Administração → Captadores → {código} → Bancada: diagnóstico do sensor sem executar missões. */
export function BenchScreen({ code }: { code: string }) {
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
  return <BenchWorkspace code={normalized} />;
}

function BenchWorkspace({ code }: { code: string }) {
  const [source] = useState(() => createBenchApiSource(code, { onUnauthorized: () => profileStore.markSignedOut() }));
  useEffect(() => source.start(), [source]);
  const state = useSyncExternalStore(source.subscribe, source.getState, source.getServerState);
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

  const { collector, bench } = view;

  return (
    <div className="space-y-5 pt-6">
      <BackLink />
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow">Administração · Bancada</p>
          <h1 className="mt-0.5 font-display text-[1.75rem] font-bold leading-tight tracking-tight text-mist-50">{collector.code}</h1>
          <p className="mt-1 truncate text-sm text-mist-400">
            {collector.name} · {collector.deviceKey ?? "sem dispositivo"}
          </p>
        </div>
        <OriginBadge origin={collector.isSimulated ? "simulation" : "device"} className="mt-1" />
      </header>

      <BenchSession
        view={view}
        busy={state.busy}
        onStart={async () => {
          const result = await source.startBench();
          setNotice(result.ok ? null : { tone: "alert", text: result.message });
        }}
        onEnd={async () => {
          const result = await source.endBench();
          setNotice(result.ok ? { tone: "leaf", text: "Ensaio encerrado. O balanço volta a contar a partir do nível atual." } : { tone: "alert", text: result.message });
        }}
      />

      {notice && (
        <Surface tone={notice.tone} role="status" className="p-4 text-sm text-mist-100">
          {notice.text}
        </Surface>
      )}

      <HardwareAlert hardware={view.hardware} code={collector.code} />
      <PrimaryPanel view={view} />
      <Diagnostics view={view} />

      <Surface className="p-4">
        <p className="eyebrow mb-1">Distância medida · últimos 10 min</p>
        <p className="mb-3 text-xs text-mist-400">A linha sobe quando a água sobe (a distância até o sensor diminui).</p>
        <DistanceChart readings={view.readings} />
      </Surface>

      <ObservationForm source={source} view={view} disabled={!bench.active || state.busy} onNotice={setNotice} />
      <ValidationSection source={source} view={view} disabled={!bench.active || state.busy} onNotice={setNotice} />
      <Exports code={collector.code} />
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

function BenchSession({ view, busy, onStart, onEnd }: { view: BenchView; busy: boolean; onStart: () => void; onEnd: () => void }) {
  const { bench } = view;
  if (bench.active) {
    return (
      <Surface tone="ember" className="space-y-3 p-4">
        <p className="flex items-center gap-2 font-display font-semibold text-mist-50">
          <Microscope className="size-5 text-ember-400" aria-hidden /> Ensaio de bancada em andamento
        </p>
        <p className="text-xs leading-relaxed text-mist-300">
          {bench.startedAt !== null && `Desde ${clock(bench.startedAt)}`}
          {bench.startedBy && ` · ${bench.startedBy}`}. Leituras gravadas a cada segundo, balanço hídrico pausado e missões bloqueadas.
          Encerra sozinho 15 min depois que esta tela e a de calibração forem fechadas.
        </p>
        <Button variant="secondary" size="sm" className="w-full" disabled={busy} onClick={onEnd}>
          Encerrar ensaio
        </Button>
      </Surface>
    );
  }
  return (
    <Surface className="space-y-3 p-4">
      <p className="flex items-center gap-2 font-display font-semibold text-mist-50">
        <Microscope className="size-5 text-aqua-300" aria-hidden /> Ensaio de bancada
      </p>
      <ul className="space-y-1 text-xs leading-relaxed text-mist-300">
        <li>• Grava cada leitura do sensor (para analisar reflexões e instabilidade).</li>
        <li>• Pausa o balanço hídrico: a água colocada à mão não conta como captada.</li>
        <li>• Bloqueia as missões deste captador. A válvula não é acionada.</li>
      </ul>
      <p className="text-xs text-mist-500">A leitura ao vivo abaixo funciona sem iniciar o ensaio; registrar observações e validações exige o ensaio.</p>
      <Button variant="leaf" className="w-full" disabled={busy || !view.collector.deviceKey} onClick={onStart}>
        Iniciar ensaio de bancada
      </Button>
    </Surface>
  );
}

function PrimaryPanel({ view }: { view: BenchView }) {
  const { live, calibration, collector } = view;
  const distance = live.stability.distanceMm ?? live.lastDistanceMm;
  const applies = calibration?.appliesToDevice ?? false;
  const capacity = applies ? calibration!.capacityLiters : collector.configuredCapacityLiters;

  return (
    <Surface tone={collector.isSimulated ? "sim" : "aqua"} className="p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="eyebrow text-mist-100">Leitura atual</p>
        <Chip tone={live.online ? "leaf" : "neutral"}>{live.online ? "Recebendo leituras" : "Sem leitura recente"}</Chip>
      </div>
      <dl className="grid grid-cols-2 gap-2">
        <Tile label="Distância" value={distance === null ? "—" : `${formatDecimal(distance, 0)} mm`} hint={distance === null ? "sem leitura válida" : `${formatDecimal(distance / 10, 1)} cm`} large />
        <Tile
          label="Volume"
          value={live.volume ? formatLiters(live.volume.liters) : "—"}
          hint={live.volume ? `coluna ${mm(live.volume.heightMm)}` : applies ? "leitura sem volume" : "sem calibração válida"}
          large
        />
        <Tile label="Capacidade" value={formatLiters(capacity)} hint={applies ? "efetiva estimada" : "configurada"} />
        <Tile label="Percentual" value={live.volume ? formatPercent(live.volume.fillRatio) : "—"} hint={live.volume?.aboveMaximum ? "acima do máximo" : live.volume?.belowZero ? "abaixo do zero" : undefined} />
        <Tile
          label="Estado"
          value={
            <span className="flex items-center gap-2">
              <span aria-hidden className={cn("size-2.5 rounded-full", STATE_DOT[live.stability.state])} />
              {STATE_LABEL[live.stability.state]}
            </span>
          }
        />
        <Tile
          label="Calibração"
          value={calibration ? `v${calibration.version}` : "—"}
          hint={!calibration ? "nenhuma ativa" : applies ? (calibration.isSimulated ? "SIMULAÇÃO" : "deste dispositivo") : "de outro dispositivo ou sensor"}
        />
        <Tile
          label="Sensor"
          value={collector.sensorModel ?? "—"}
          hint={`configurado: ${view.hardware.distanceSensor}${view.hardware.compatibility === "incompatible" ? " · incompatível" : ""}`}
        />
        <Tile label="Fonte" value={collector.isSimulated ? "SIMULAÇÃO" : "REAL"} />
      </dl>
    </Surface>
  );
}

function Tile({ label, value, hint, large = false }: { label: string; value: ReactNode; hint?: string; large?: boolean }) {
  return (
    <div className="min-w-0 rounded-2xl bg-white/[0.05] px-3 py-2.5">
      <dt className="eyebrow">{label}</dt>
      <dd className={cn("mt-0.5 truncate font-display font-bold tabular-nums text-mist-50", large ? "text-2xl" : "text-base")}>{value}</dd>
      {hint && <dd className="truncate text-[11px] text-mist-400">{hint}</dd>}
    </div>
  );
}

function Diagnostics({ view }: { view: BenchView }) {
  const now = useNow(1000);
  const { live, collector } = view;
  const { stability, diagnostics } = live;
  const spread = diagnostics?.min_mm != null && diagnostics.max_mm != null ? diagnostics.max_mm - diagnostics.min_mm : null;
  const statuses = diagnostics?.status_counts ? Object.entries(diagnostics.status_counts).map(([name, count]) => `${name} ${count}`).join(" · ") : null;

  const rows: [string, string][] = [
    ["Leituras aceitas na janela", `${stability.readings} de ${stability.total}`],
    ["Tempo médio entre leituras", stability.averageIntervalMs === null ? "—" : `${formatDecimal(stability.averageIntervalMs / 1000, 1)} s`],
    ["Leituras inválidas", String(stability.invalid)],
    ["Outliers descartados", String(stability.outliers)],
    ["Variação (desvio-padrão)", stability.stdMm === null ? "—" : `±${formatDecimal(stability.stdMm, 1)} mm`],
    ["Deriva na janela", stability.driftMm === null ? "—" : signed(stability.driftMm, 1, " mm")],
    ["Amostras válidas (firmware)", diagnostics?.valid_samples != null && diagnostics.samples != null ? `${diagnostics.valid_samples} de ${diagnostics.samples}` : "—"],
    ["Dispersão entre amostras", spread === null ? "—" : `${formatDecimal(spread, 0)} mm`],
    ["Sinal (MCPS)", diagnostics?.signal_rate_mcps != null ? formatDecimal(diagnostics.signal_rate_mcps, 2) : "—"],
    ["Luz ambiente (MCPS)", diagnostics?.ambient_rate_mcps != null ? formatDecimal(diagnostics.ambient_rate_mcps, 2) : "—"],
    ["Estado do sensor", diagnostics?.sensor_state ? SENSOR_STATE_LABEL[diagnostics.sensor_state] : "—"],
    ["Identificação (registrador)", diagnostics?.model_id ?? "—"],
    ["Último status do sensor", diagnostics?.last_status ?? "—"],
    ["ROI · orçamento", [diagnostics?.roi, diagnostics?.timing_budget_ms != null ? `${diagnostics.timing_budget_ms} ms` : null].filter(Boolean).join(" · ") || "—"],
    ["I²C", diagnostics?.i2c_clock_hz != null ? `${formatDecimal(diagnostics.i2c_clock_hz / 1000, 0)} kHz` : "—"],
    ["Firmware", collector.firmwareVersion ?? "—"],
    ["Wi-Fi", diagnostics?.rssi_dbm != null ? `${diagnostics.rssi_dbm} dBm` : "—"],
  ];

  return (
    <Surface className="p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="eyebrow">Diagnóstico da leitura</p>
        <StatusPill status={live.online ? live.deviceStatus : "OFFLINE"} />
      </div>
      <p className="mb-3 text-xs text-mist-400" role="status">
        {stability.message}
        {live.measuredAt !== null && now !== null && ` · última leitura ${formatRelativeTime(live.measuredAt, now)}`}
      </p>
      <dl className="divide-y divide-white/[0.06] text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-3 py-1.5">
            <dt className="text-mist-400">{label}</dt>
            <dd className="text-right font-mono text-[0.8rem] text-mist-50">{value}</dd>
          </div>
        ))}
      </dl>
      {statuses && <p className="mt-2 break-words font-mono text-[11px] text-mist-500">Status das amostras: {statuses}</p>}
    </Surface>
  );
}

function ObservationForm({
  source,
  view,
  disabled,
  onNotice,
}: {
  source: BenchSource;
  view: BenchView;
  disabled: boolean;
  onNotice: (notice: { tone: "leaf" | "alert"; text: string } | null) => void;
}) {
  const [condition, setCondition] = useState<ObservationCondition>("com_agua");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const referenceValue = reference.trim() === "" ? null : Number(reference.replace(",", "."));
  const referenceValid = referenceValue === null || Number.isFinite(referenceValue);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!referenceValid) return;
    const result = await source.observe({ condition, reference_height_mm: referenceValue, note: note.trim() || null });
    if (result.ok) {
      onNotice({ tone: "leaf", text: `Observação registrada (${STATE_LABEL[result.value.observation.stabilityState].toLowerCase()}).` });
      setNote("");
    } else onNotice({ tone: "alert", text: result.message });
  };

  return (
    <Surface className="space-y-4 p-4">
      <div>
        <p className="flex items-center gap-2 font-display font-semibold text-mist-50">
          <NotebookPen className="size-5 text-aqua-300" aria-hidden /> Observar o sensor
        </p>
        <p className="mt-1 text-xs leading-relaxed text-mist-400">
          Registra a leitura atual como ela está — estável, instável ou inválida — para avaliar o cone de visão, reflexões nas paredes e nas
          conexões e o comportamento em cada nível. Nada é corrigido.
        </p>
      </div>
      <form onSubmit={(event) => void submit(event)} className="space-y-3">
        <div role="radiogroup" aria-label="Condição" className="grid grid-cols-2 gap-2">
          {OBSERVATION_CONDITIONS.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={condition === option}
              onClick={() => setCondition(option)}
              className={cn(
                "h-10 rounded-xl px-2 text-xs font-semibold ring-1 ring-inset",
                condition === option ? "bg-aqua-400/15 text-aqua-300 ring-aqua-400/50" : "bg-white/[0.04] text-mist-300 ring-white/10",
              )}
            >
              {OBSERVATION_CONDITION_LABEL[option]}
            </button>
          ))}
        </div>
        <label className="block space-y-1">
          <span className="text-xs font-semibold text-mist-100">Altura na mangueira transparente (mm, a partir da marca do ZERO) — opcional</span>
          <input className={inputClass} inputMode="decimal" value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Ex.: 412" />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-semibold text-mist-100">Nota — opcional</span>
          <input className={inputClass} maxLength={280} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Ex.: nível na altura da luva" />
        </label>
        <Button type="submit" variant="secondary" className="w-full" disabled={disabled || !referenceValid}>
          Registrar leitura atual
        </Button>
      </form>
      {view.observations.length > 0 && (
        <ul className="space-y-2">
          {view.observations.slice(0, 6).map((item) => (
            <ObservationItem key={item.id} item={item} />
          ))}
        </ul>
      )}
    </Surface>
  );
}

function ObservationItem({ item }: { item: SensorObservationRecord }) {
  const difference = item.heightMm !== null && item.referenceHeightMm !== null ? item.heightMm - item.referenceHeightMm : null;
  return (
    <li className="rounded-2xl bg-white/[0.04] p-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-mist-50">{OBSERVATION_CONDITION_LABEL[item.condition]}</span>
        <Chip tone={item.stabilityState === "stable" ? "leaf" : item.stabilityState === "invalid" ? "alert" : "sun"} className="h-6">
          {STATE_LABEL[item.stabilityState]}
        </Chip>
        <span className="text-mist-500">{dateTime(item.createdAt)}</span>
      </div>
      <p className="mt-1 font-mono text-mist-300">
        {mm(item.distanceMm, 1)} · ±{formatDecimal(item.stdMm ?? 0, 1)} mm · {item.invalid} inválidas de {item.total}
        {item.referenceHeightMm !== null && ` · mangueira ${mm(item.referenceHeightMm)}`}
        {difference !== null && ` · sensor − mangueira ${signed(difference, 0, " mm")}`}
      </p>
      {item.note && <p className="mt-1 text-mist-400">{item.note}</p>}
    </li>
  );
}

function ValidationSection({
  source,
  view,
  disabled,
  onNotice,
}: {
  source: BenchSource;
  view: BenchView;
  disabled: boolean;
  onNotice: (notice: { tone: "leaf" | "alert"; text: string } | null) => void;
}) {
  const [known, setKnown] = useState("");
  const [method, setMethod] = useState<ValidationMethod>("balanca");
  const [mass, setMass] = useState("");
  const [note, setNote] = useState("");
  const [last, setLast] = useState<ValidationRecord | null>(null);
  const { calibration, live, validationSummary: summary } = view;
  const knownValue = Number(known.replace(",", "."));
  const massValue = mass.trim() === "" ? null : Number(mass.replace(",", "."));
  const valid = known.trim() !== "" && Number.isFinite(knownValue) && knownValue >= 0 && (massValue === null || (Number.isFinite(massValue) && massValue > 0));

  if (!calibration?.appliesToDevice) {
    return (
      <Surface className="space-y-2 p-4">
        <p className="flex items-center gap-2 font-display font-semibold text-mist-50">
          <Scale className="size-5 text-aqua-300" aria-hidden /> Validação experimental
        </p>
        <p className="text-sm text-mist-400">
          {calibration ? "A calibração ativa foi feita com outro dispositivo ou outro sensor." : "Este captador ainda não tem calibração ativa."} A validação compara um
          volume conhecido com o volume calculado por uma calibração deste dispositivo.
        </p>
        <Link
          href={`/admin/captadores/${encodeURIComponent(view.collector.code)}/calibracao`}
          className="inline-flex items-center gap-2 text-sm font-semibold text-aqua-300"
        >
          <Ruler className="size-4" aria-hidden /> Ir para a calibração
        </Link>
      </Surface>
    );
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    const result = await source.validate({ known_volume_liters: knownValue, measurement_method: method, known_mass_kg: massValue, note: note.trim() || null });
    if (result.ok) {
      setLast(result.value.validation);
      setNote("");
      onNotice(null);
    } else onNotice({ tone: "alert", text: result.message });
  };

  return (
    <Surface className="space-y-4 p-4">
      <div>
        <p className="flex items-center gap-2 font-display font-semibold text-mist-50">
          <Scale className="size-5 text-aqua-300" aria-hidden /> Validação experimental · calibração v{calibration.version}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-mist-400">
          Informe só o volume físico colocado no captador. A distância e o volume calculado vêm da leitura estável do servidor. A validação é dado
          experimental: não altera a calibração.
        </p>
      </div>

      <form onSubmit={(event) => void submit(event)} className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <label className="block space-y-1">
            <span className="text-xs font-semibold text-mist-100">Volume conhecido (L)</span>
            <input className={inputClass} inputMode="decimal" value={known} onChange={(event) => setKnown(event.target.value)} placeholder="Ex.: 5,00" />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-semibold text-mist-100">Massa (kg) — opcional</span>
            <input className={inputClass} inputMode="decimal" value={mass} onChange={(event) => setMass(event.target.value)} placeholder="Ex.: 5,003" />
          </label>
        </div>
        <div role="radiogroup" aria-label="Método de medição" className="grid grid-cols-3 gap-2">
          {VALIDATION_METHODS.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={method === option}
              onClick={() => setMethod(option)}
              className={cn(
                "min-h-10 rounded-xl px-1.5 py-1 text-[11px] font-semibold leading-tight ring-1 ring-inset",
                method === option ? "bg-aqua-400/15 text-aqua-300 ring-aqua-400/50" : "bg-white/[0.04] text-mist-300 ring-white/10",
              )}
            >
              {VALIDATION_METHOD_LABEL[option]}
            </button>
          ))}
        </div>
        <input className={inputClass} maxLength={280} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Nota — opcional" />
        <Button type="submit" variant="leaf" className="w-full" disabled={disabled || !valid || live.stability.state !== "stable"}>
          {live.stability.state === "stable" ? "Registrar validação" : "Aguardando leitura estável…"}
        </Button>
      </form>

      {last && <ValidationResult item={last} />}

      <div className="rounded-2xl bg-white/[0.04] p-3">
        <p className="eyebrow mb-2">Resultados da v{calibration.version} · {summary.count} registros</p>
        {summary.count === 0 ? (
          <p className="text-xs text-mist-400">Nenhuma validação ainda. Sugestão: 5 L, 8 L e próximo da capacidade.</p>
        ) : (
          <dl className="grid grid-cols-2 gap-2 text-xs">
            <SummaryItem label="Erro médio (viés)" value={summary.meanErrorLiters === null ? "—" : signed(summary.meanErrorLiters, 3, " L")} />
            <SummaryItem label="Erro absoluto médio" value={summary.meanAbsoluteErrorLiters === null ? "—" : `${formatDecimal(summary.meanAbsoluteErrorLiters, 3)} L`} />
            <SummaryItem label="Maior erro absoluto" value={summary.maxAbsoluteErrorLiters === null ? "—" : `${formatDecimal(summary.maxAbsoluteErrorLiters, 3)} L`} />
            <SummaryItem
              label="Erro percentual absoluto médio"
              value={summary.meanAbsolutePercentError === null ? "—" : `${formatDecimal(summary.meanAbsolutePercentError, 1)}%`}
            />
          </dl>
        )}
        <p className="mt-2 text-[11px] text-mist-500">Estatística descritiva, sem limite de aprovação definido a priori.</p>
      </div>

      {view.validations.length > 0 && (
        <ul className="space-y-2">
          {view.validations.slice(0, 10).map((item) => (
            <li key={item.id} className="rounded-2xl bg-white/[0.04] p-3 text-xs">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-semibold text-mist-50">
                  {formatLiters(item.knownVolumeLiters)} conhecido → {formatLiters(item.calculatedVolumeLiters)} calculado
                </span>
                <span className="font-mono text-mist-100">
                  {signed(item.errorLiters, 3, " L")}
                  {item.percentError !== null && ` (${signed(item.percentError, 1, "%")})`}
                </span>
              </div>
              <p className="mt-1 text-mist-400">
                v{item.calibrationVersion} · {mm(item.distanceMm, 1)} · {VALIDATION_METHOD_LABEL[item.measurementMethod]} · {dateTime(item.createdAt)}
                {item.isSimulated && " · SIMULAÇÃO"}
                {item.aboveMaximum && " · acima do máximo"}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Surface>
  );
}

function ValidationResult({ item }: { item: ValidationRecord }) {
  return (
    <div className="rounded-2xl bg-aqua-400/10 p-3 ring-1 ring-inset ring-aqua-400/30" role="status">
      <p className="eyebrow text-aqua-300">Validação registrada</p>
      <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
        <SummaryItem label="Volume conhecido" value={formatLiters(item.knownVolumeLiters)} />
        <SummaryItem label="Volume calculado" value={formatLiters(item.calculatedVolumeLiters)} />
        <SummaryItem label="Erro" value={signed(item.errorLiters, 3, " L")} />
        <SummaryItem label="Erro percentual" value={item.percentError === null ? "— (volume 0)" : signed(item.percentError, 1, "%")} />
      </dl>
    </div>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-mist-400">{label}</dt>
      <dd className="font-display font-semibold tabular-nums text-mist-50">{value}</dd>
    </div>
  );
}

function Exports({ code }: { code: string }) {
  const base = `/api/admin/collectors/${encodeURIComponent(code)}/bench/export`;
  const links: [string, string][] = [
    ["Leituras (24 h)", `${base}?tipo=readings&horas=24`],
    ["Observações", `${base}?tipo=observations&horas=720`],
    ["Validações", `${base}?tipo=validations&horas=720`],
  ];
  return (
    <Surface className="p-4">
      <p className="flex items-center gap-2 font-display font-semibold text-mist-50">
        <FlaskConical className="size-5 text-aqua-300" aria-hidden /> Dados para análise
      </p>
      <p className="mt-1 text-xs text-mist-400">CSV para planilha (separador “;”, vírgula decimal), com REAL/SIMULAÇÃO em cada linha.</p>
      <div className="mt-3 grid gap-2">
        {links.map(([label, href]) => (
          // Download de arquivo da API: âncora simples (não é navegação entre páginas).
          <a
            key={label}
            href={href}
            download
            className="flex h-10 items-center gap-2 rounded-xl bg-white/[0.05] px-3 text-sm font-semibold text-mist-100 ring-1 ring-inset ring-white/10"
          >
            <Download className="size-4 text-mist-400" aria-hidden /> {label}
          </a>
        ))}
      </div>
    </Surface>
  );
}
