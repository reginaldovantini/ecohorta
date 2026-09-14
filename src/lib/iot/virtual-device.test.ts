import { describe, expect, it } from "vitest";
import { createVolumeConverter, median } from "./calibration";
import type { DispenseCommand } from "./types";
import { createVirtualDevice, type VirtualDeviceConfig, type VirtualDeviceSettings } from "./virtual-device";

function mulberry32(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const config: VirtualDeviceConfig = {
  collector: {
    id: "c1",
    code: "EC-TEST",
    name: "Teste",
    location: "Laboratório",
    capacityLiters: 12,
    reserveLiters: 0.5,
    valveKind: "undefined",
  },
  deviceId: "VIRTUAL-TEST",
  sensorToFullMm: 60,
  usableHeightMm: 1529,
  outflowAtFullLpm: 2.4,
  sensorNoiseMm: 2,
  commandLatencyMs: 1000,
  valveCloseLatencyMs: 300,
  settleMs: 1500,
  noFlowTimeoutMs: 6000,
};

const baseSettings: VirtualDeviceSettings = {
  inflowEnabled: false,
  inflowLitersPerHour: 1.2,
  faultNoFlow: false,
  offline: false,
};

function setup(volumeLiters: number, settings: Partial<VirtualDeviceSettings> = {}) {
  let wall = 1_000_000;
  const device = createVirtualDevice(
    config,
    {
      volumeLiters,
      baselineLiters: volumeLiters,
      reusedLiters: 0,
      discardedEstimatedLiters: 0,
      learnedInflowLitersPerHour: 0,
      settings: { ...baseSettings, ...settings },
    },
    { random: mulberry32(7), now: () => wall },
  );
  const run = (ms: number) => {
    for (let elapsed = 0; elapsed < ms; elapsed += 250) {
      device.advance(250, 250);
      wall += 250;
    }
  };
  const runUntilDone = (commandId: string, limitMs = 10 * 60_000) => {
    const statuses = new Set<string>();
    for (let elapsed = 0; elapsed < limitMs; elapsed += 250) {
      run(250);
      const status = device.getProgress(commandId)?.status;
      if (status) statuses.add(status);
      if (status === "COMPLETED" || status === "FAILED") break;
    }
    return statuses;
  };
  run(2000); // estabiliza o filtro do sensor
  return { device, run, runUntilDone };
}

const command = (commandId: string, targetLiters: number): DispenseCommand => ({
  commandId,
  executionId: `exec-${commandId}`,
  missionId: "regar-jardim",
  collectorCode: "EC-TEST",
  targetLiters,
});

describe("dispositivo virtual — liberação", () => {
  it("percorre os estados e conclui com o volume medido próximo ao alvo", () => {
    const { device, runUntilDone } = setup(8);
    expect(device.dispense(command("a", 3)).status).toBe("QUEUED");

    const statuses = runUntilDone("a");
    const progress = device.getProgress("a")!;

    expect([...statuses]).toEqual(expect.arrayContaining(["EXECUTING", "MEASURING", "COMPLETED"]));
    expect(progress.status).toBe("COMPLETED");
    expect(progress.deliveredLiters).toBeGreaterThan(2.9);
    expect(progress.deliveredLiters).toBeLessThan(3.1);
    expect(progress.startedAt).not.toBeNull();
    expect(progress.finishedAt! - progress.startedAt!).toBeGreaterThan(60_000); // ~3 L a ~2 L/min por gravidade

    const snapshot = device.snapshot(0);
    expect(snapshot.telemetry.valve).toBe("closed");
    expect(snapshot.telemetry.status).toBe("READY");
    expect(snapshot.totals.reusedLiters).toBeCloseTo(progress.deliveredLiters, 2);
  });

  it("é idempotente: o mesmo commandId nunca executa duas vezes", () => {
    const { device, runUntilDone } = setup(10);
    const first = device.dispense(command("dup", 2));
    expect(device.dispense(command("dup", 2))).toBe(first);

    runUntilDone("dup");
    const reusedAfterFirst = device.snapshot(0).totals.reusedLiters;

    expect(device.dispense(command("dup", 2)).status).toBe("COMPLETED");
    runUntilDone("dup", 5_000);
    expect(device.snapshot(0).totals.reusedLiters).toBe(reusedAfterFirst);
  });

  it("recusa outro comando durante uma liberação", () => {
    const { device, run } = setup(10);
    device.dispense(command("a", 3));
    run(3000);
    const busy = device.dispense(command("b", 1));
    expect(busy.status).toBe("FAILED");
    expect(busy.failure).toBe("DEVICE_BUSY");
  });

  it("não abre a válvula sem água suficiente acima da reserva", () => {
    const { device, runUntilDone } = setup(2);
    device.dispense(command("a", 3));
    runUntilDone("a");
    expect(device.getProgress("a")).toMatchObject({ status: "FAILED", failure: "INSUFFICIENT_WATER", startedAt: null });
    expect(device.snapshot(0).telemetry.valve).toBe("closed");
  });

  it("detecta falta de vazão (válvula inadequada para baixa pressão) e fecha a válvula", () => {
    const { device, runUntilDone, run } = setup(8, { faultNoFlow: true });
    device.dispense(command("a", 3));
    runUntilDone("a");
    run(1000);
    expect(device.getProgress("a")).toMatchObject({ status: "FAILED", failure: "NO_FLOW" });
    expect(device.snapshot(0).telemetry.valve).toBe("closed");
    expect(device.snapshot(0).totals.reusedLiters).toBe(0);
  });

  it("falha como offline quando o dispositivo não busca o comando", () => {
    const { device, runUntilDone } = setup(8, { offline: true });
    device.dispense(command("a", 1));
    runUntilDone("a");
    expect(device.getProgress("a")).toMatchObject({ status: "FAILED", failure: "DEVICE_OFFLINE" });
  });
});

describe("dispositivo virtual — nível e transbordamento", () => {
  it("mede o volume com erro pequeno apesar do ruído do sensor", () => {
    const { device } = setup(7.42);
    expect(Math.abs(device.snapshot(0).telemetry.volumeLiters - 7.42)).toBeLessThan(0.05);
  });

  it("identifica acúmulo e estima o descarte no dreno sem ultrapassar a capacidade", () => {
    const { device, run } = setup(6, { inflowEnabled: true, inflowLitersPerHour: 6 });
    device.preroll();
    expect(device.snapshot(0).telemetry.trend).toBe("rising");

    device.setLevel(0.99);
    run(5 * 60_000);

    const snapshot = device.snapshot(0);
    expect(snapshot.telemetry.overflowing).toBe(true);
    expect(snapshot.telemetry.volumeLiters).toBeLessThanOrEqual(12);
    expect(snapshot.totals.discardedEstimatedLiters).toBeGreaterThan(0.2);
    expect(snapshot.totals.capturedLiters).toBeGreaterThan(snapshot.totals.discardedEstimatedLiters);
  });
});

describe("calibração", () => {
  const convert = createVolumeConverter([
    { distanceMm: 1589, volumeLiters: 0 },
    { distanceMm: 60, volumeLiters: 12 },
    { distanceMm: 824.5, volumeLiters: 6 },
  ]);

  it("interpola entre pontos fora de ordem", () => {
    expect(convert(60)).toBe(12);
    expect(convert(824.5)).toBe(6);
    expect(convert(442.25)).toBeCloseTo(9);
  });

  it("limita aos extremos da tabela", () => {
    expect(convert(10)).toBe(12);
    expect(convert(2000)).toBe(0);
  });

  it("exige ao menos dois pontos", () => {
    expect(() => createVolumeConverter([{ distanceMm: 1, volumeLiters: 1 }])).toThrow();
  });

  it("calcula a mediana", () => {
    expect(median([5, 1, 900, 3, 4])).toBe(4);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
});
