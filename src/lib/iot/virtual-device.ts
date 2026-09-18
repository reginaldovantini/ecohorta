import { DEFAULT_DISTANCE_SENSOR, DISTANCE_SENSORS, SENSOR_WIRING, type DistanceSensorModel } from "@/lib/collector/distance-sensors";
import { distanceFromVolume, modelFromGeometry, volumeFromDistance } from "@/lib/collector/volume-calibration";
import { availableLiters } from "@/lib/collector/water";
import type { CommandReport, DeviceCommand, SensorDiagnostics } from "./api-schema";
import { median } from "./calibration";
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
 * Firmware: driver do sensor configurado na plataforma (VL53L0X ou VL53L1X, recebido na
 * resposta da telemetria, como no ESP32) → leituras ruidosas → faixa física e alcance
 * documentado do sensor → mediana → volume pela MESMA conversão distância → volume do
 * servidor (V = k × H, src/lib/collector/volume-calibration.ts);
 * válvula fechada pelo volume MEDIDO com antecipação da latência; NO_FLOW,
 * TIMEOUT, cancelamento e comandos idempotentes por command_id.
 *
 * Tempo simulado (física) pode ser acelerado; a estabilização da superfície
 * usa tempo real para que a etapa de medição seja perceptível.
 *
 * Na simulação, o sensor "instalado" é sempre o configurado: a troca física é instantânea.
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
  /** Diagnóstico da leitura no mesmo formato do firmware (amostras válidas, dispersão, status). */
  diagnostics: SensorDiagnostics;
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

const round1 = (value: number) => Math.round(value * 10) / 10;
const round3 = (value: number) => Math.round(value * 1000) / 1000;

/** Sensor simulado até a plataforma informar a configuração do captador. */
export const VIRTUAL_SENSOR_MODEL: DistanceSensorModel = DEFAULT_DISTANCE_SENSOR;

/** Identificação que cada driver lê no registrador do sensor (a mesma conferida pelo firmware). */
const MODEL_ID: Record<DistanceSensorModel, string> = { VL53L0X: "0xEE", VL53L1X: "0xEACC" };

/** Geometria "verdadeira" do captador virtual: zero no fundo útil, máximo no dreno. */
export function virtualVolumeModel(config: VirtualDeviceConfig) {
  return modelFromGeometry({
    zeroDistanceMm: config.sensorToFullMm + config.usableHeightMm,
    maximumDistanceMm: config.sensorToFullMm,
    capacityLiters: config.capacityLiters,
  });
}

export function createVirtualDevice(
  config: VirtualDeviceConfig,
  initial: { volumeLiters: number; settings: PhysicsSettings; sensorModel?: DistanceSensorModel },
  deps: { random?: () => number } = {},
) {
  const random = deps.random ?? Math.random;
  let sensorModel: DistanceSensorModel = initial.sensorModel ?? VIRTUAL_SENSOR_MODEL;
  const capacity = config.capacityLiters;
  const model = virtualVolumeModel(config);
  const minDistance = config.sensorToFullMm - 30;
  const maxDistance = config.sensorToFullMm + config.usableHeightMm + 30;

  let settings: PhysicsSettings = { ...initial.settings };
  let trueVolume = Math.min(capacity, Math.max(0, initial.volumeLiters));
  let simClock = 0;
  let realClock = 0;
  let valveOpen = false;
  let valveCloseAt: number | null = null;
  let readings: number[] = [];
  /** Últimas tentativas de leitura do sensor: `true` = dentro da faixa física. */
  let attempts: boolean[] = [];
  let distanceMm = distanceFor(trueVolume);
  let measured = trueVolume;
  let active: ActiveDispense | null = null;
  let report: CommandReport | null = null;
  /** Equivalente à memória não volátil (NVS): IDs já executados. */
  const executed: string[] = [];

  function distanceFor(volume: number) {
    return distanceFromVolume(model, volume);
  }

  function gaussian() {
    let u = 0;
    while (u === 0) u = random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
  }

  function readSensor() {
    let raw = distanceFor(trueVolume) + gaussian() * config.sensorNoiseMm;
    if (random() < 0.005) raw += 200 + random() * 900; // reflexo espúrio na superfície
    // Faixa física do tubo e alcance documentado do sensor em uso (VL53L0X: 2 m).
    const valid = raw >= minDistance && raw <= maxDistance && raw <= DISTANCE_SENSORS[sensorModel].documentedMaxRangeMm;
    attempts.push(valid);
    if (attempts.length > SENSOR_WINDOW) attempts.shift();
    if (!valid) return; // fora da faixa física: descartada
    readings.push(raw);
    if (readings.length > SENSOR_WINDOW) readings.shift();
    distanceMm = median(readings);
    measured = volumeFromDistance(model, distanceMm)?.volumeLiters ?? measured;
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
      end_distance_mm: round1(distanceMm),
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

  function setVolume(liters: number) {
    if (active) return false;
    trueVolume = Math.min(capacity, Math.max(0, liters));
    readings = [];
    attempts = [];
    for (let i = 0; i < SENSOR_WINDOW; i++) readSensor();
    return true;
  }

  function diagnostics(): SensorDiagnostics {
    const validSamples = attempts.filter(Boolean).length;
    // Mesmos nomes de status que cada driver do firmware informa.
    const [ok, rejected] = sensorModel === "VL53L1X" ? ["RangeValid", "OutOfBoundsFail"] : ["Measured", "OutOfConfiguredRange"];
    return {
      sensor_state: "ready",
      model_id: MODEL_ID[sensorModel],
      i2c_ack: true,
      i2c_clock_hz: SENSOR_WIRING.i2cClockHz,
      samples: attempts.length,
      valid_samples: validSamples,
      min_mm: readings.length ? Math.round(Math.min(...readings)) : null,
      max_mm: readings.length ? Math.round(Math.max(...readings)) : null,
      signal_rate_mcps: null, // não simulado
      ambient_rate_mcps: null,
      status_counts: { [ok]: validSamples, [rejected]: attempts.length - validSamples },
      last_status: attempts.length === 0 ? null : attempts[attempts.length - 1] ? ok : rejected,
      timing_budget_ms: 50,
      distance_mode: sensorModel === "VL53L1X" ? "long" : "long_range",
      ...(sensorModel === "VL53L1X" ? { roi: "16x16" } : {}),
    };
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
        diagnostics: diagnostics(),
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
          start_distance_mm: round1(distanceMm),
          end_distance_mm: round1(distanceMm),
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
        start_distance_mm: round1(distanceMm),
        end_distance_mm: null,
        failure: null,
        started_uptime_ms: Math.round(simClock),
        finished_uptime_ms: null,
      };
    },

    /** Ajuste de volume pelo painel da simulação (ex.: etapas da calibração). Recusado durante uma liberação. */
    setVolume,

    /** Ajuste de nível em fração da capacidade. */
    setLevel(ratio: number) {
      return setVolume(Math.min(1, Math.max(0, ratio)) * capacity);
    },

    /** Coloca a superfície na distância pedida do sensor (limitada à faixa física do tubo). */
    setDistance(distanceMm: number) {
      return setVolume((model.zeroDistanceMm - distanceMm) * model.constantLitersPerMm);
    },

    updateSettings(patch: Partial<PhysicsSettings>) {
      settings = { ...settings, ...patch };
    },

    /** Driver em uso (o que o firmware informa em `sensor_model`). */
    sensorModel() {
      return sensorModel;
    },

    /** Aplica o sensor configurado na plataforma. Trocar de driver recomeça as leituras. */
    setSensorModel(model: DistanceSensorModel) {
      if (model === sensorModel) return false;
      sensorModel = model;
      readings = [];
      attempts = [];
      for (let i = 0; i < SENSOR_WINDOW; i++) readSensor();
      return true;
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
