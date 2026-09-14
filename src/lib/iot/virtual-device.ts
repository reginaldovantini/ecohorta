import { availableLiters } from "@/lib/collector/water";
import { createVolumeConverter, median } from "./calibration";
import type {
  CollectorInfo,
  CollectorSnapshot,
  DeviceStatus,
  DispenseCommand,
  DispenseProgress,
  WaterTrend,
} from "./types";

/*
 * DISPOSITIVO VIRTUAL — emula o captador físico e o firmware do ESP32.
 *
 * Física (simplificada, mas coerente):
 *   entrada de condensado constante (L/h) enquanto o ar-condicionado está ligado;
 *   saída por gravidade: vazão ∝ √(altura da coluna) — Torricelli;
 *   acima da capacidade, a água sai pelo dreno de segurança.
 *
 * Firmware emulado:
 *   leituras ruidosas do sensor → faixa física → mediana → calibração → volume;
 *   liberação fecha a válvula pelo volume MEDIDO, com antecipação pela latência;
 *   falta de vazão (NO_FLOW), tempo máximo (TIMEOUT), ocupado e offline;
 *   comandos idempotentes por commandId.
 *
 * O tempo simulado (física) pode ser acelerado; latência de rede e estabilização
 * da superfície usam tempo real, para que cada etapa seja perceptível na tela.
 */

export interface VirtualDeviceConfig {
  collector: CollectorInfo;
  deviceId: string;
  /** Distância do sensor até a superfície com o captador no limite (mm). */
  sensorToFullMm: number;
  /** Altura útil da coluna d'água, do fundo ao limite (mm). */
  usableHeightMm: number;
  /** Vazão de saída com o captador cheio (L/min). */
  outflowAtFullLpm: number;
  /** Desvio-padrão do ruído do sensor (mm). */
  sensorNoiseMm: number;
  /** Tempo real até o dispositivo buscar o comando. */
  commandLatencyMs: number;
  /** Tempo simulado entre o comando de fechar e a válvula fechar de fato. */
  valveCloseLatencyMs: number;
  /** Tempo real de estabilização da superfície antes da leitura final. */
  settleMs: number;
  /** Tempo simulado com a válvula aberta sem queda de nível até declarar NO_FLOW. */
  noFlowTimeoutMs: number;
}

export interface VirtualDeviceSettings {
  inflowEnabled: boolean;
  inflowLitersPerHour: number;
  /** Simula a válvula inadequada para baixa pressão: abre, mas a água não sai. */
  faultNoFlow: boolean;
  offline: boolean;
}

export interface VirtualDeviceState {
  volumeLiters: number;
  baselineLiters: number;
  reusedLiters: number;
  discardedEstimatedLiters: number;
  learnedInflowLitersPerHour: number;
  settings: VirtualDeviceSettings;
}

interface ActiveCommand {
  command: DispenseCommand;
  receivedReal: number;
  openedSim: number;
  startedWall: number;
  closedSim: number;
  closedReal: number;
  startVolume: number;
  maxDurationSim: number;
}

const STEP_MS = 100;
const SENSOR_WINDOW = 9;
const FILTER_LAG_MS = (SENSOR_WINDOW / 2) * STEP_MS;
const TREND_SAMPLE_MS = 5_000;
const TREND_WINDOW_MS = 10 * 60_000;
const TREND_MIN_SPAN_MS = 60_000;
const TREND_THRESHOLD_LPH = 0.15;
const OVERFLOW_ENTER_RATIO = 0.995;
const OVERFLOW_EXIT_RATIO = 0.985;
const NO_FLOW_MIN_LITERS = 0.05;
const MS_PER_HOUR = 3_600_000;

const round = (value: number, digits: number) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

/** Regressão linear das amostras → variação em L/h. */
function slopeLitersPerHour(samples: readonly { t: number; v: number }[]) {
  if (samples.length < 3) return 0;
  const span = samples[samples.length - 1]!.t - samples[0]!.t;
  if (span < TREND_MIN_SPAN_MS) return 0;
  let sumT = 0;
  let sumV = 0;
  for (const s of samples) {
    sumT += s.t;
    sumV += s.v;
  }
  const meanT = sumT / samples.length;
  const meanV = sumV / samples.length;
  let numerator = 0;
  let denominator = 0;
  for (const s of samples) {
    numerator += (s.t - meanT) * (s.v - meanV);
    denominator += (s.t - meanT) ** 2;
  }
  return denominator === 0 ? 0 : (numerator / denominator) * MS_PER_HOUR;
}

export function createVirtualDevice(
  config: VirtualDeviceConfig,
  initial: VirtualDeviceState,
  deps: { random?: () => number; now?: () => number } = {},
) {
  const random = deps.random ?? Math.random;
  const now = deps.now ?? Date.now;
  const capacity = config.collector.capacityLiters;
  const toVolume = createVolumeConverter([
    { distanceMm: config.sensorToFullMm, volumeLiters: capacity },
    { distanceMm: config.sensorToFullMm + config.usableHeightMm, volumeLiters: 0 },
  ]);
  const minDistance = config.sensorToFullMm - 30;
  const maxDistance = config.sensorToFullMm + config.usableHeightMm + 30;

  let settings: VirtualDeviceSettings = { ...initial.settings };
  let trueVolume = Math.min(capacity, Math.max(0, initial.volumeLiters));
  let baseline = initial.baselineLiters;
  let reused = initial.reusedLiters;
  let discarded = initial.discardedEstimatedLiters;
  let learnedInflow = initial.learnedInflowLitersPerHour;

  let simClock = 0;
  let realClock = 0;
  let valveOpen = false;
  let valveCloseAt: number | null = null;
  let readings: number[] = [];
  let distanceMm = distanceFor(trueVolume);
  let measured = trueVolume;
  let samples: { t: number; v: number }[] = [];
  let lastSampleAt = Number.NEGATIVE_INFINITY;
  let netFlow = 0;
  let overflowing = false;
  let active: ActiveCommand | null = null;
  let progressChanged = false;
  let lastSnapshot: CollectorSnapshot | null = null;
  const progressById = new Map<string, DispenseProgress>();

  function distanceFor(volume: number) {
    return config.sensorToFullMm + (1 - volume / capacity) * config.usableHeightMm;
  }

  function gaussian() {
    let u = 0;
    while (u === 0) u = random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
  }

  function readSensor() {
    let raw = distanceFor(trueVolume) + gaussian() * config.sensorNoiseMm;
    if (random() < 0.005) raw += 200 + random() * 900; // reflexo espúrio na superfície
    if (raw < minDistance || raw > maxDistance) return; // fora da faixa física: descartada
    readings.push(raw);
    if (readings.length > SENSOR_WINDOW) readings.shift();
    distanceMm = median(readings);
    measured = toVolume(distanceMm);
  }

  function resetTrend() {
    samples = [];
    lastSampleAt = Number.NEGATIVE_INFINITY;
    netFlow = 0;
  }

  function updateTrend() {
    if (simClock - lastSampleAt < TREND_SAMPLE_MS) return;
    lastSampleAt = simClock;
    samples.push({ t: simClock, v: measured });
    while (samples.length > 0 && simClock - samples[0]!.t > TREND_WINDOW_MS) samples.shift();
    netFlow = slopeLitersPerHour(samples);
    if (!overflowing && !valveOpen && active === null && netFlow > TREND_THRESHOLD_LPH) {
      learnedInflow = netFlow;
    }
  }

  function setProgress(commandId: string, patch: Partial<DispenseProgress>) {
    const current = progressById.get(commandId);
    if (!current) return;
    progressById.set(commandId, { ...current, ...patch });
    progressChanged = true;
  }

  function finish(commandId: string, patch: Partial<DispenseProgress>) {
    setProgress(commandId, patch);
    active = null;
    resetTrend();
  }

  function closeValve() {
    if (valveOpen && valveCloseAt === null) valveCloseAt = simClock + config.valveCloseLatencyMs;
  }

  function runCommand() {
    if (!active) return;
    const { commandId } = active.command;
    const progress = progressById.get(commandId)!;

    if (progress.status === "QUEUED") {
      if (realClock - active.receivedReal < config.commandLatencyMs) return;
      if (settings.offline) {
        finish(commandId, { status: "FAILED", failure: "DEVICE_OFFLINE", finishedAt: now() });
        return;
      }
      const free = availableLiters(measured, config.collector.reserveLiters);
      if (progress.targetLiters > free + 1e-6) {
        finish(commandId, { status: "FAILED", failure: "INSUFFICIENT_WATER", finishedAt: now() });
        return;
      }
      valveOpen = true;
      valveCloseAt = null;
      active.openedSim = simClock;
      active.startedWall = now();
      active.startVolume = measured;
      const endHead = Math.max(0.05, (measured - progress.targetLiters) / capacity);
      const expectedMs = (progress.targetLiters / (config.outflowAtFullLpm * Math.sqrt(endHead))) * 60_000;
      active.maxDurationSim = expectedMs * 2 + 15_000;
      setProgress(commandId, { status: "EXECUTING", startedAt: active.startedWall, startVolumeLiters: round(measured, 3) });
      return;
    }

    const delivered = Math.max(0, active.startVolume - measured);
    const elapsedSim = simClock - active.openedSim;

    if (progress.status === "EXECUTING") {
      const flowLitersPerSecond = (config.outflowAtFullLpm / 60) * Math.sqrt(Math.max(0, measured) / capacity);
      const closeLead = flowLitersPerSecond * ((config.valveCloseLatencyMs + FILTER_LAG_MS) / 1000);

      if (delivered >= progress.targetLiters - closeLead) {
        closeValve();
        active.closedSim = simClock;
        active.closedReal = realClock;
        setProgress(commandId, { status: "MEASURING", deliveredLiters: round(delivered, 3) });
      } else if (elapsedSim >= config.noFlowTimeoutMs && delivered < NO_FLOW_MIN_LITERS) {
        closeValve();
        finish(commandId, {
          status: "FAILED",
          failure: "NO_FLOW",
          deliveredLiters: round(delivered, 3),
          endVolumeLiters: round(measured, 3),
          finishedAt: active.startedWall + elapsedSim,
        });
      } else if (elapsedSim >= active.maxDurationSim) {
        closeValve();
        reused += delivered;
        finish(commandId, {
          status: "FAILED",
          failure: "TIMEOUT",
          deliveredLiters: round(delivered, 3),
          endVolumeLiters: round(measured, 3),
          finishedAt: active.startedWall + elapsedSim,
        });
      } else if (Math.abs(delivered - progress.deliveredLiters) >= 0.005) {
        setProgress(commandId, { deliveredLiters: round(delivered, 3) });
      }
      return;
    }

    if (progress.status === "MEASURING") {
      if (valveOpen || realClock - active.closedReal < config.settleMs) {
        if (Math.abs(delivered - progress.deliveredLiters) >= 0.005) {
          setProgress(commandId, { deliveredLiters: round(delivered, 3) });
        }
        return;
      }
      reused += delivered;
      finish(commandId, {
        status: "COMPLETED",
        deliveredLiters: round(delivered, 3),
        endVolumeLiters: round(measured, 3),
        finishedAt: active.startedWall + (active.closedSim - active.openedSim),
      });
    }
  }

  function step(simMs: number, realMs: number) {
    simClock += simMs;
    realClock += realMs;

    if (settings.inflowEnabled) trueVolume += settings.inflowLitersPerHour * (simMs / MS_PER_HOUR);
    if (valveOpen && !settings.faultNoFlow) {
      const head = Math.sqrt(Math.max(0, trueVolume) / capacity);
      trueVolume -= config.outflowAtFullLpm * head * (simMs / 60_000);
    }
    if (valveCloseAt !== null && simClock >= valveCloseAt) {
      valveOpen = false;
      valveCloseAt = null;
    }
    // Acima do limite, a água sai fisicamente pelo dreno (o sensor não mede isso).
    trueVolume = Math.min(capacity, Math.max(0, trueVolume));

    readSensor();

    const ratio = measured / capacity;
    if (!overflowing && ratio >= OVERFLOW_ENTER_RATIO) overflowing = true;
    else if (overflowing && ratio < OVERFLOW_EXIT_RATIO) overflowing = false;
    // Estimativa de descarte: taxa de acúmulo aprendida antes do limite × tempo no limite.
    if (overflowing && !valveOpen) discarded += learnedInflow * (simMs / MS_PER_HOUR);

    updateTrend();
    runCommand();
  }

  function status(): DeviceStatus {
    if (settings.offline) return "OFFLINE";
    if (valveOpen || active?.openedSim) return "DISPENSING";
    return "READY";
  }

  function trend(): { trend: WaterTrend; netFlow: number } {
    if (active && valveOpen) {
      const elapsedHours = (simClock - active.openedSim) / MS_PER_HOUR;
      const rate = elapsedHours > 0 ? -Math.max(0, active.startVolume - measured) / elapsedHours : 0;
      return { trend: "falling", netFlow: rate };
    }
    if (netFlow > TREND_THRESHOLD_LPH) return { trend: "rising", netFlow };
    if (netFlow < -TREND_THRESHOLD_LPH) return { trend: "falling", netFlow };
    return { trend: "stable", netFlow };
  }

  return {
    /** Avança a simulação: física em tempo simulado, latências em tempo real. */
    advance(simMs: number, realMs: number) {
      const steps = Math.max(1, Math.round(simMs / STEP_MS));
      for (let i = 0; i < steps; i++) step(simMs / steps, realMs / steps);
    },

    /** Aprende a taxa de acúmulo antes de exibir dados (10 min simulados, sem contar como captado). */
    preroll() {
      this.advance(TREND_WINDOW_MS, 0);
      baseline = measured;
      discarded = 0;
    },

    snapshot(nowMs: number): CollectorSnapshot {
      if (settings.offline && lastSnapshot) {
        return { ...lastSnapshot, telemetry: { ...lastSnapshot.telemetry, status: "OFFLINE" } };
      }
      const flow = trend();
      lastSnapshot = {
        info: config.collector,
        telemetry: {
          deviceId: config.deviceId,
          origin: "simulation",
          status: status(),
          distanceMm: Math.round(distanceMm),
          volumeLiters: round(measured, 2),
          valve: valveOpen ? "open" : "closed",
          netFlowLitersPerHour: round(flow.netFlow, 2),
          trend: flow.trend,
          overflowing,
          measuredAt: nowMs,
        },
        totals: {
          capturedLiters: round(Math.max(0, measured - baseline + reused + discarded), 2),
          reusedLiters: round(reused, 2),
          discardedEstimatedLiters: round(discarded, 2),
        },
      };
      return lastSnapshot;
    },

    dispense(command: DispenseCommand): DispenseProgress {
      const existing = progressById.get(command.commandId);
      if (existing) return existing;

      const queued: DispenseProgress = {
        commandId: command.commandId,
        status: "QUEUED",
        targetLiters: command.targetLiters,
        deliveredLiters: 0,
        startVolumeLiters: null,
        endVolumeLiters: null,
        queuedAt: now(),
        startedAt: null,
        finishedAt: null,
        failure: null,
        origin: "simulation",
      };

      if (active || command.collectorCode !== config.collector.code) {
        const rejected: DispenseProgress = {
          ...queued,
          status: "FAILED",
          failure: active ? "DEVICE_BUSY" : "DEVICE_OFFLINE",
          finishedAt: queued.queuedAt,
        };
        progressById.set(command.commandId, rejected);
        progressChanged = true;
        return rejected;
      }

      progressById.set(command.commandId, queued);
      active = {
        command,
        receivedReal: realClock,
        openedSim: 0,
        startedWall: 0,
        closedSim: 0,
        closedReal: 0,
        startVolume: 0,
        maxDurationSim: 0,
      };
      progressChanged = true;
      return queued;
    },

    getProgress(commandId: string) {
      return progressById.get(commandId) ?? null;
    },

    hasActiveCommand() {
      return active !== null;
    },

    /** `true` se algum progresso mudou desde a última chamada. */
    consumeProgressChange() {
      const changed = progressChanged;
      progressChanged = false;
      return changed;
    },

    /** Ajuste manual de nível pelo painel. Esvaziar não conta como reúso; encher conta como captado. */
    setLevel(ratio: number) {
      if (active) return false;
      const target = Math.min(1, Math.max(0, ratio)) * capacity;
      const delta = target - trueVolume;
      if (delta < 0) baseline += delta;
      trueVolume = target;
      readings = [];
      for (let i = 0; i < SENSOR_WINDOW; i++) readSensor();
      resetTrend();
      return true;
    },

    updateSettings(patch: Partial<VirtualDeviceSettings>) {
      settings = { ...settings, ...patch };
      if (patch.inflowEnabled !== undefined || patch.inflowLitersPerHour !== undefined) resetTrend();
    },

    getSettings(): VirtualDeviceSettings {
      return settings;
    },

    exportState(): VirtualDeviceState {
      return {
        volumeLiters: trueVolume,
        baselineLiters: baseline,
        reusedLiters: reused,
        discardedEstimatedLiters: discarded,
        learnedInflowLitersPerHour: learnedInflow,
        settings,
      };
    },
  };
}

export type VirtualDevice = ReturnType<typeof createVirtualDevice>;
