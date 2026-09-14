import { availableLiters } from "@/lib/collector/water";
import type { CommandReport, DeviceCommand } from "./api-schema";
import { createVolumeConverter, median } from "./calibration";
import type { DeviceFailure, DeviceStatus, ValveState } from "./types";

/*
 * DISPOSITIVO VIRTUAL — emula o captador físico e o FIRMWARE do ESP32.
 * Roda como processo separado (tools/virtual-device) e fala com a plataforma
 * pela mesma API que o ESP32 usará. Não calcula tendência nem balanço:
 * isso é responsabilidade do servidor.
 *
 * Física: entrada de condensado (L/h); saída por gravidade com vazão ∝ √altura
 * (Torricelli); acima da capacidade a água sai pelo dreno de segurança.
 *
 * Firmware: leituras ruidosas → faixa física → mediana → calibração → volume;
 * válvula fechada pelo volume MEDIDO com antecipação da latência; NO_FLOW,
 * TIMEOUT, cancelamento e comandos idempotentes por command_id.
 *
 * Tempo simulado (física) pode ser acelerado; a estabilização da superfície
 * usa tempo real para que a etapa de medição seja perceptível.
 */

export interface VirtualDeviceConfig {
  capacityLiters: number;
  reserveLiters: number;
  /** Distância do sensor até a superfície com o captador no limite (mm). */
  sensorToFullMm: number;
  /** Altura útil da coluna d'água, do fundo ao limite (mm). */
  usableHeightMm: number;
  /** Vazão de saída com o captador cheio (L/min). */
  outflowAtFullLpm: number;
  /** Desvio-padrão do ruído do sensor (mm). */
  sensorNoiseMm: number;
  /** Tempo simulado entre o comando de fechar e a válvula fechar de fato. */
  valveCloseLatencyMs: number;
  /** Tempo real de estabilização da superfície antes da leitura final. */
  settleMs: number;
  /** Tempo simulado com a válvula aberta sem queda de nível até declarar NO_FLOW. */
  noFlowTimeoutMs: number;
  /** Limite absoluto de abertura da válvula (tempo simulado). */
  maxDispenseMs: number;
}

export interface PhysicsSettings {
  inflowEnabled: boolean;
  inflowLitersPerHour: number;
  /** Válvula inadequada para baixa pressão: abre, mas a água não sai. */
  faultNoFlow: boolean;
}

export interface DeviceReading {
  uptimeMs: number;
  distanceMm: number;
  volumeLiters: number;
  valve: ValveState;
  status: DeviceStatus;
}

interface ActiveDispense {
  commandId: string;
  targetLiters: number;
  phase: "EXECUTING" | "MEASURING";
  cancelled: boolean;
  openedSim: number;
  closedReal: number;
  startVolume: number;
  maxDurationSim: number;
}

const STEP_MS = 100;
const SENSOR_WINDOW = 9;
const FILTER_LAG_MS = (SENSOR_WINDOW / 2) * STEP_MS;
const NO_FLOW_MIN_LITERS = 0.05;
const MS_PER_HOUR = 3_600_000;
const MAX_REMEMBERED_COMMANDS = 50;

const round3 = (value: number) => Math.round(value * 1000) / 1000;

export function createVirtualDevice(
  config: VirtualDeviceConfig,
  initial: { volumeLiters: number; settings: PhysicsSettings },
  deps: { random?: () => number } = {},
) {
  const random = deps.random ?? Math.random;
  const capacity = config.capacityLiters;
  const toVolume = createVolumeConverter([
    { distanceMm: config.sensorToFullMm, volumeLiters: capacity },
    { distanceMm: config.sensorToFullMm + config.usableHeightMm, volumeLiters: 0 },
  ]);
  const minDistance = config.sensorToFullMm - 30;
  const maxDistance = config.sensorToFullMm + config.usableHeightMm + 30;

  let settings: PhysicsSettings = { ...initial.settings };
  let trueVolume = Math.min(capacity, Math.max(0, initial.volumeLiters));
  let simClock = 0;
  let realClock = 0;
  let valveOpen = false;
  let valveCloseAt: number | null = null;
  let readings: number[] = [];
  let distanceMm = distanceFor(trueVolume);
  let measured = trueVolume;
  let active: ActiveDispense | null = null;
  let report: CommandReport | null = null;
  /** Equivalente à memória não volátil (NVS): IDs já executados. */
  const executed: string[] = [];

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

  function closeValve() {
    if (valveOpen && valveCloseAt === null) valveCloseAt = simClock + config.valveCloseLatencyMs;
  }

  function finish(status: "COMPLETED" | "FAILED" | "CANCELLED", delivered: number, failure: DeviceFailure | null) {
    if (!report) return;
    report = {
      ...report,
      status,
      delivered_liters: round3(delivered),
      end_volume_liters: round3(measured),
      failure,
      finished_uptime_ms: Math.round(simClock),
    };
    active = null;
  }

  function runDispense() {
    if (!active || !report) return;
    const delivered = Math.max(0, active.startVolume - measured);
    const elapsedSim = simClock - active.openedSim;

    if (active.phase === "EXECUTING") {
      const flowLitersPerSecond = (config.outflowAtFullLpm / 60) * Math.sqrt(Math.max(0, measured) / capacity);
      const closeLead = flowLitersPerSecond * ((config.valveCloseLatencyMs + FILTER_LAG_MS) / 1000);

      if (active.cancelled || delivered >= active.targetLiters - closeLead) {
        closeValve();
        active.phase = "MEASURING";
        active.closedReal = realClock;
        report = { ...report, status: "MEASURING", delivered_liters: round3(delivered) };
      } else if (elapsedSim >= config.noFlowTimeoutMs && delivered < NO_FLOW_MIN_LITERS) {
        closeValve();
        finish("FAILED", delivered, "NO_FLOW");
      } else if (elapsedSim >= active.maxDurationSim) {
        closeValve();
        finish("FAILED", delivered, "TIMEOUT");
      } else if (Math.abs(delivered - report.delivered_liters) >= 0.005) {
        report = { ...report, delivered_liters: round3(delivered) };
      }
      return;
    }

    if (valveOpen || realClock - active.closedReal < config.settleMs) {
      if (Math.abs(delivered - report.delivered_liters) >= 0.005) {
        report = { ...report, delivered_liters: round3(delivered) };
      }
      return;
    }
    finish(active.cancelled ? "CANCELLED" : "COMPLETED", delivered, null);
  }

  function step(requestedSimMs: number, realMs: number) {
    // A estabilização da superfície acontece em tempo real, mesmo com a simulação
    // acelerada: senão o condensado de minutos simulados distorceria a medição final.
    const simMs = active?.phase === "MEASURING" ? realMs : requestedSimMs;
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
    runDispense();
  }

  return {
    /** Avança a simulação: física em tempo simulado, estabilização em tempo real. */
    advance(simMs: number, realMs: number) {
      const steps = Math.max(1, Math.round(simMs / STEP_MS));
      for (let i = 0; i < steps; i++) step(simMs / steps, realMs / steps);
    },

    reading(): DeviceReading {
      return {
        uptimeMs: Math.round(simClock),
        distanceMm: Math.round(distanceMm),
        volumeLiters: round3(measured),
        valve: valveOpen ? "open" : "closed",
        status: active ? "DISPENSING" : "READY",
      };
    },

    /** Relatório do comando atual ou do último concluído (reenviado até o próximo comando). */
    commandReport(): CommandReport | null {
      return report;
    },

    receive(command: DeviceCommand) {
      if (command.action === "cancel") {
        if (active?.commandId === command.command_id && active.phase === "EXECUTING") active.cancelled = true;
        return;
      }
      if (executed.includes(command.command_id)) return; // idempotente
      executed.push(command.command_id);
      if (executed.length > MAX_REMEMBERED_COMMANDS) executed.shift();
      if (active) return; // a plataforma garante uma liberação por vez

      const free = availableLiters(measured, config.reserveLiters);
      if (command.target_liters > free + 1e-6) {
        report = {
          command_id: command.command_id,
          status: "FAILED",
          delivered_liters: 0,
          start_volume_liters: round3(measured),
          end_volume_liters: round3(measured),
          failure: "INSUFFICIENT_WATER",
          started_uptime_ms: null,
          finished_uptime_ms: Math.round(simClock),
        };
        return;
      }

      valveOpen = true;
      valveCloseAt = null;
      const endHead = Math.max(0.05, (measured - command.target_liters) / capacity);
      const expectedMs = (command.target_liters / (config.outflowAtFullLpm * Math.sqrt(endHead))) * 60_000;
      active = {
        commandId: command.command_id,
        targetLiters: command.target_liters,
        phase: "EXECUTING",
        cancelled: false,
        openedSim: simClock,
        closedReal: 0,
        startVolume: measured,
        maxDurationSim: Math.min(command.max_duration_ms, config.maxDispenseMs, expectedMs * 2 + 15_000),
      };
      report = {
        command_id: command.command_id,
        status: "EXECUTING",
        delivered_liters: 0,
        start_volume_liters: round3(measured),
        end_volume_liters: null,
        failure: null,
        started_uptime_ms: Math.round(simClock),
        finished_uptime_ms: null,
      };
    },

    /** Ajuste de nível pelo painel da simulação. Recusado durante uma liberação. */
    setLevel(ratio: number) {
      if (active) return false;
      trueVolume = Math.min(1, Math.max(0, ratio)) * capacity;
      readings = [];
      for (let i = 0; i < SENSOR_WINDOW; i++) readSensor();
      return true;
    },

    updateSettings(patch: Partial<PhysicsSettings>) {
      settings = { ...settings, ...patch };
    },

    isBusy() {
      return active !== null;
    },

    exportState() {
      return { volumeLiters: trueVolume, settings };
    },
  };
}

export type VirtualDevice = ReturnType<typeof createVirtualDevice>;
