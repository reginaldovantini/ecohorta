import { describe, expect, it } from "vitest";
import type { DeviceCommand } from "./api-schema";
import { createVolumeConverter, median } from "./calibration";
import { createVirtualDevice, type PhysicsSettings, type VirtualDeviceConfig } from "./virtual-device";

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
  capacityLiters: 12,
  reserveLiters: 0.5,
  sensorToFullMm: 60,
  usableHeightMm: 1529,
  outflowAtFullLpm: 2.4,
  sensorNoiseMm: 2,
  valveCloseLatencyMs: 300,
  settleMs: 1500,
  noFlowTimeoutMs: 6000,
  maxDispenseMs: 240_000,
};

const baseSettings: PhysicsSettings = { inflowEnabled: false, inflowLitersPerHour: 1.2, faultNoFlow: false };

const dispense = (id: string, targetLiters: number): DeviceCommand => ({
  command_id: id,
  action: "dispense",
  target_liters: targetLiters,
  max_duration_ms: 240_000,
});

function setup(volumeLiters: number, settings: Partial<PhysicsSettings> = {}) {
  const device = createVirtualDevice(config, { volumeLiters, settings: { ...baseSettings, ...settings } }, { random: mulberry32(7) });
  const run = (ms: number) => {
    for (let elapsed = 0; elapsed < ms; elapsed += 250) device.advance(250, 250);
  };
  const runUntilDone = (limitMs = 10 * 60_000) => {
    const statuses = new Set<string>();
    for (let elapsed = 0; elapsed < limitMs; elapsed += 250) {
      run(250);
      const status = device.commandReport()?.status;
      if (status) statuses.add(status);
      if (status === "COMPLETED" || status === "FAILED" || status === "CANCELLED") break;
    }
    return statuses;
  };
  run(2000); // estabiliza o filtro do sensor
  return { device, run, runUntilDone };
}

describe("firmware virtual — liberação", () => {
  it("abre, mede, fecha e reporta o volume medido próximo ao alvo", () => {
    const { device, runUntilDone } = setup(8);
    device.receive(dispense("a", 3));
    expect(device.reading().valve).toBe("open");

    const statuses = runUntilDone();
    const report = device.commandReport()!;

    expect([...statuses]).toEqual(expect.arrayContaining(["EXECUTING", "MEASURING", "COMPLETED"]));
    expect(report.delivered_liters).toBeGreaterThan(2.9);
    expect(report.delivered_liters).toBeLessThan(3.1);
    expect(report.finished_uptime_ms! - report.started_uptime_ms!).toBeGreaterThan(60_000); // ~3 L por gravidade
    expect(device.reading()).toMatchObject({ valve: "closed", status: "READY" });
  });

  it("mantém a medição precisa com a simulação acelerada (estabilização em tempo real)", () => {
    const { device } = setup(8, { inflowEnabled: true, inflowLitersPerHour: 1.2 });
    device.receive(dispense("fast", 2));
    for (let elapsed = 0; elapsed < 60_000; elapsed += 100) {
      device.advance(100 * 120, 100); // 120×
      const status = device.commandReport()?.status;
      if (status === "COMPLETED" || status === "FAILED") break;
    }
    const report = device.commandReport()!;
    expect(report.status).toBe("COMPLETED");
    expect(report.delivered_liters).toBeGreaterThan(1.95);
    expect(report.delivered_liters).toBeLessThan(2.06);
    // Duração física: alguns minutos simulados de válvula aberta, não a estabilização acelerada.
    expect(report.finished_uptime_ms! - report.started_uptime_ms!).toBeLessThan(150_000);
  });

  it("é idempotente: o mesmo command_id nunca executa duas vezes", () => {
    const { device, run, runUntilDone } = setup(10);
    device.receive(dispense("dup", 2));
    device.receive(dispense("dup", 2));
    runUntilDone();
    const volumeAfter = device.reading().volumeLiters;

    device.receive(dispense("dup", 2));
    run(5_000);
    expect(device.reading().valve).toBe("closed");
    expect(Math.abs(device.reading().volumeLiters - volumeAfter)).toBeLessThan(0.05);
  });

  it("cancela fechando a válvula e reporta o volume já liberado", () => {
    const { device, run, runUntilDone } = setup(10);
    device.receive(dispense("a", 3));
    run(20_000);
    device.receive({ command_id: "a", action: "cancel" });
    runUntilDone();

    const report = device.commandReport()!;
    expect(report.status).toBe("CANCELLED");
    expect(report.delivered_liters).toBeGreaterThan(0.2);
    expect(report.delivered_liters).toBeLessThan(3);
    expect(device.reading().valve).toBe("closed");
  });

  it("não abre a válvula sem água suficiente acima da reserva", () => {
    const { device } = setup(2);
    device.receive(dispense("a", 3));
    expect(device.commandReport()).toMatchObject({ status: "FAILED", failure: "INSUFFICIENT_WATER", started_uptime_ms: null });
    expect(device.reading().valve).toBe("closed");
  });

  it("detecta falta de vazão (válvula inadequada para baixa pressão) e fecha a válvula", () => {
    const { device, run, runUntilDone } = setup(8, { faultNoFlow: true });
    device.receive(dispense("a", 3));
    runUntilDone();
    run(1000);
    expect(device.commandReport()).toMatchObject({ status: "FAILED", failure: "NO_FLOW" });
    expect(device.reading().valve).toBe("closed");
  });
});

describe("firmware virtual — sensor", () => {
  it("mede o volume com erro pequeno apesar do ruído", () => {
    const { device } = setup(7.42);
    expect(Math.abs(device.reading().volumeLiters - 7.42)).toBeLessThan(0.05);
  });

  it("não ultrapassa a capacidade: o excesso sai pelo dreno", () => {
    const { device, run } = setup(11.9, { inflowEnabled: true, inflowLitersPerHour: 20 });
    run(30 * 60_000);
    expect(device.reading().volumeLiters).toBeLessThanOrEqual(12.02);
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
