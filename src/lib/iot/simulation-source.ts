import { z } from "zod";
import type { CollectorDataSource } from "./data-source";
import type { CollectorSnapshot, DispenseCommand } from "./types";
import {
  createVirtualDevice,
  type VirtualDeviceConfig,
  type VirtualDeviceSettings,
  type VirtualDeviceState,
} from "./virtual-device";

/**
 * Parâmetros do dispositivo virtual. São valores de SIMULAÇÃO, plausíveis para
 * um tubo DN100 (~78,5 cm² de seção: 12 L ≈ 1,53 m de coluna) — devem ser
 * substituídos pelas medições físicas do captador (calibração e teste de vazão).
 */
export const SIMULATION_CONFIG: VirtualDeviceConfig = {
  collector: {
    id: "virtual-ec-001",
    code: "EC-001",
    name: "EcoCaptador",
    location: "Horta",
    capacityLiters: 12,
    reserveLiters: 0.5,
    valveKind: "undefined",
  },
  deviceId: "VIRTUAL-001",
  sensorToFullMm: 60,
  usableHeightMm: 1529,
  outflowAtFullLpm: 2.4,
  sensorNoiseMm: 2,
  commandLatencyMs: 1800,
  valveCloseLatencyMs: 300,
  settleMs: 2200,
  noFlowTimeoutMs: 6000,
};

export const TIME_SCALES = [1, 30, 120] as const;

export interface SimulationSettings extends VirtualDeviceSettings {
  timeScale: number;
}

export interface SimulationControls {
  subscribe(listener: () => void): () => void;
  getSettings(): SimulationSettings;
  update(patch: Partial<SimulationSettings>): void;
  /** `false` se houver uma liberação em andamento. */
  setLevel(ratio: number): boolean;
  reset(): void;
}

const STORAGE_KEY = "ecohorta:virtual-device:v1";
const TICK_MS = 250;
const IDLE_PUBLISH_MS = 1000;
const SAVE_MS = 5000;

const DEFAULT_SETTINGS: SimulationSettings = {
  timeScale: 1,
  inflowEnabled: true,
  inflowLitersPerHour: 1.2,
  faultNoFlow: false,
  offline: false,
};

const persistedSchema = z.object({
  volumeLiters: z.number().min(0),
  baselineLiters: z.number(),
  reusedLiters: z.number().min(0),
  discardedEstimatedLiters: z.number().min(0),
  learnedInflowLitersPerHour: z.number().min(0),
  timeScale: z.number().positive().max(1000),
  inflowEnabled: z.boolean(),
  inflowLitersPerHour: z.number().min(0).max(20),
});

function loadPersisted() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = persistedSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function freshState(): VirtualDeviceState {
  return {
    volumeLiters: 6.6,
    baselineLiters: 6.6,
    reusedLiters: 0,
    discardedEstimatedLiters: 0,
    learnedInflowLitersPerHour: 0,
    settings: { ...DEFAULT_SETTINGS },
  };
}

/**
 * Fonte de dados do captador baseada no dispositivo virtual.
 * Mesmo contrato (`CollectorDataSource`) que a integração com o ESP32 usará.
 */
export function createSimulationSource() {
  const persisted = loadPersisted();
  let timeScale = persisted?.timeScale ?? DEFAULT_SETTINGS.timeScale;

  const createDevice = (state: VirtualDeviceState, preroll: boolean) => {
    const created = createVirtualDevice(SIMULATION_CONFIG, state);
    if (preroll) created.preroll();
    return created;
  };

  let device = persisted
    ? createDevice(
        {
          ...persisted,
          // Falhas simuladas não sobrevivem a um recarregamento da página.
          settings: {
            inflowEnabled: persisted.inflowEnabled,
            inflowLitersPerHour: persisted.inflowLitersPerHour,
            faultNoFlow: false,
            offline: false,
          },
        },
        true,
      )
    : createDevice(freshState(), true);

  if (persisted) {
    // O preroll aprende a taxa de acúmulo; os totais restaurados são preservados.
    const restored = device.exportState();
    device = createVirtualDevice(SIMULATION_CONFIG, {
      ...restored,
      volumeLiters: persisted.volumeLiters,
      baselineLiters: persisted.baselineLiters,
      reusedLiters: persisted.reusedLiters,
      discardedEstimatedLiters: persisted.discardedEstimatedLiters,
    });
  }

  const codes = [SIMULATION_CONFIG.collector.code] as const;
  const dataListeners = new Set<() => void>();
  const controlListeners = new Set<() => void>();
  let snapshot: CollectorSnapshot = device.snapshot(Date.now());
  let settingsSnapshot: SimulationSettings = { ...device.getSettings(), timeScale };

  const publish = () => {
    snapshot = device.snapshot(Date.now());
    device.consumeProgressChange();
    for (const listener of dataListeners) listener();
  };

  const publishSettings = () => {
    settingsSnapshot = { ...device.getSettings(), timeScale };
    for (const listener of controlListeners) listener();
  };

  const save = () => {
    if (typeof window === "undefined") return;
    const state = device.exportState();
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          volumeLiters: state.volumeLiters,
          baselineLiters: state.baselineLiters,
          reusedLiters: state.reusedLiters,
          discardedEstimatedLiters: state.discardedEstimatedLiters,
          learnedInflowLitersPerHour: state.learnedInflowLitersPerHour,
          timeScale,
          inflowEnabled: state.settings.inflowEnabled,
          inflowLitersPerHour: state.settings.inflowLitersPerHour,
        }),
      );
    } catch {
      // Armazenamento indisponível: a simulação segue só em memória.
    }
  };

  const source: CollectorDataSource = {
    origin: "simulation",
    subscribe(listener) {
      dataListeners.add(listener);
      return () => {
        dataListeners.delete(listener);
      };
    },
    getCollectorCodes: () => codes,
    getSnapshot: (code) => (code === SIMULATION_CONFIG.collector.code ? snapshot : null),
    getProgress: (commandId) => device.getProgress(commandId),
    dispense(command: DispenseCommand) {
      const progress = device.dispense(command);
      publish();
      return progress;
    },
  };

  const controls: SimulationControls = {
    subscribe(listener) {
      controlListeners.add(listener);
      return () => {
        controlListeners.delete(listener);
      };
    },
    getSettings: () => settingsSnapshot,
    update(patch) {
      const { timeScale: nextScale, ...devicePatch } = patch;
      if (nextScale !== undefined) timeScale = nextScale;
      device.updateSettings(devicePatch);
      publishSettings();
      publish();
      save();
    },
    setLevel(ratio) {
      const ok = device.setLevel(ratio);
      if (ok) {
        publish();
        save();
      }
      return ok;
    },
    reset() {
      if (device.hasActiveCommand()) return;
      timeScale = DEFAULT_SETTINGS.timeScale;
      device = createDevice(freshState(), true);
      publishSettings();
      publish();
      save();
    },
  };

  /** Inicia o relógio da simulação no navegador. Retorna a função de parada. */
  const start = () => {
    let last = performance.now();
    let sincePublish = 0;
    let sinceSave = 0;

    const id = window.setInterval(() => {
      const current = performance.now();
      const realMs = Math.min(1000, current - last);
      last = current;
      device.advance(realMs * timeScale, realMs);

      sincePublish += realMs;
      sinceSave += realMs;
      if (device.hasActiveCommand() || device.consumeProgressChange() || sincePublish >= IDLE_PUBLISH_MS) {
        sincePublish = 0;
        publish();
      }
      if (sinceSave >= SAVE_MS) {
        sinceSave = 0;
        save();
      }
    }, TICK_MS);

    window.addEventListener("pagehide", save);
    publish();

    return () => {
      window.clearInterval(id);
      window.removeEventListener("pagehide", save);
      save();
    };
  };

  return { source, controls, start };
}

export type SimulationRuntime = ReturnType<typeof createSimulationSource>;
