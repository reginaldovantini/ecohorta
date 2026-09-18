import { describe, expect, it } from "vitest";
import type { DeviceCommand } from "./api-schema";
import { distanceFromVolume, measuredReuse, volumeFromDistance } from "@/lib/collector/volume-calibration";
import { createVolumeConverter, median } from "./calibration";
import { createVirtualDevice, virtualVolumeModel, type PhysicsSettings, type VirtualDeviceConfig } from "./virtual-device";

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

describe("firmware virtual — distância e conversão compartilhada", () => {
  const model = virtualVolumeModel(config);

  it("converte a distância medida com a mesma função do servidor", () => {
    const { device } = setup(7.42);
    const reading = device.reading();
    expect(reading.volumeLiters).toBeCloseTo(volumeFromDistance(model, reading.distanceMm)!.volumeLiters, 1);
    expect(model.constantLitersPerMm).toBeCloseTo(12 / 1529, 12);
  });

  it("ajusta volume e distância para testar a calibração", () => {
    const { device, run } = setup(5);
    expect(device.setVolume(1)).toBe(true);
    run(2000);
    expect(Math.abs(device.reading().distanceMm - distanceFromVolume(model, 1))).toBeLessThanOrEqual(3);

    expect(device.setDistance(1236)).toBe(true);
    run(2000);
    expect(Math.abs(device.reading().distanceMm - 1236)).toBeLessThanOrEqual(3);
    expect(device.reading().volumeLiters).toBeCloseTo((1589 - 1236) * (12 / 1529), 1);

    // Fora da faixa física do tubo: limitado ao vazio e ao dreno.
    device.setDistance(5000);
    run(2000);
    expect(device.reading().volumeLiters).toBeLessThan(0.05);
  });

  it("informa as distâncias inicial e final da liberação", () => {
    const { device, runUntilDone } = setup(8);
    device.receive(dispense("a", 2));
    runUntilDone();
    const report = device.commandReport()!;
    expect(report.start_distance_mm).toBeCloseTo(distanceFromVolume(model, 8), -1);
    const reuse = measuredReuse(model, report.start_distance_mm, report.end_distance_mm)!;
    expect(Math.abs(reuse.reusedLiters - report.delivered_liters)).toBeLessThan(0.05);
  });

  it("envia diagnóstico da leitura no mesmo formato do firmware", () => {
    const { device } = setup(6);
    const { diagnostics } = device.reading();
    expect(diagnostics.samples).toBe(9);
    expect(diagnostics.valid_samples).toBeLessThanOrEqual(diagnostics.samples!);
    expect(diagnostics.min_mm!).toBeLessThanOrEqual(diagnostics.max_mm!);
    const counted = Object.values(diagnostics.status_counts!).reduce((sum, count) => sum + count, 0);
    expect(counted).toBe(diagnostics.samples);
    expect(diagnostics.signal_rate_mcps).toBeNull(); // não simulado: não se inventa sinal
  });

  it("recusa ajustes durante uma liberação", () => {
    const { device } = setup(8);
    device.receive(dispense("a", 2));
    expect(device.setVolume(1)).toBe(false);
    expect(device.setDistance(900)).toBe(false);
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

describe("firmware virtual — sensor configurado na plataforma", () => {
  it("usa o driver do sensor configurado (VL53L1X ou VL53L0X), como o ESP32", () => {
    const { device, run } = setup(6);
    expect(device.sensorModel()).toBe("VL53L1X");
    expect(device.reading().diagnostics).toMatchObject({
      sensor_state: "ready",
      model_id: "0xEACC",
      i2c_ack: true,
      i2c_clock_hz: 100_000,
      distance_mode: "long",
      roi: "16x16",
    });

    expect(device.setSensorModel("VL53L0X")).toBe(true);
    expect(device.setSensorModel("VL53L0X")).toBe(false); // mesmo driver: nada muda
    run(2000);
    const { diagnostics, distanceMm } = device.reading();
    expect(device.sensorModel()).toBe("VL53L0X");
    expect(diagnostics).toMatchObject({ sensor_state: "ready", model_id: "0xEE", distance_mode: "long_range" });
    expect(diagnostics.roi).toBeUndefined(); // o VL53L0X não tem ROI
    expect(Object.keys(diagnostics.status_counts!)).toEqual(["Measured", "OutOfConfiguredRange"]);
    // A superfície física é a mesma: só o driver mudou.
    expect(distanceMm).toBeCloseTo(distanceFromVolume(virtualVolumeModel(config), 6), -1);
  });

  it("com o VL53L0X, leituras além do alcance documentado (2 m) são descartadas", () => {
    const deep: VirtualDeviceConfig = { ...config, sensorToFullMm: 600, usableHeightMm: 1600 }; // tubo vazio a 2,2 m
    const l0x = createVirtualDevice(deep, { volumeLiters: 0, settings: baseSettings, sensorModel: "VL53L0X" }, { random: mulberry32(3) });
    const l1x = createVirtualDevice(deep, { volumeLiters: 0, settings: baseSettings, sensorModel: "VL53L1X" }, { random: mulberry32(3) });
    for (let i = 0; i < 20; i++) {
      l0x.advance(100, 100);
      l1x.advance(100, 100);
    }
    expect(l0x.reading().diagnostics.valid_samples).toBe(0);
    expect(l1x.reading().diagnostics.valid_samples).toBeGreaterThan(0);
  });
});
