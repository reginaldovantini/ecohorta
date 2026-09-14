import { describe, expect, it } from "vitest";
import type { CollectorSnapshot, DispenseProgress } from "@/lib/iot/types";
import { getMissionAvailability } from "./availability";
import { MISSION_CATALOG, type MissionDefinition } from "./catalog";
import { isTerminal, xpForExecution } from "./execution";

const mission: MissionDefinition = { ...MISSION_CATALOG[0]!, liters: 3, xp: 50 };

function snapshot(volumeLiters: number, status: CollectorSnapshot["telemetry"]["status"] = "READY"): CollectorSnapshot {
  return {
    info: { id: "c1", code: "EC-001", name: "", location: "", capacityLiters: 12, reserveLiters: 0.5, valveKind: "undefined" },
    telemetry: {
      deviceId: "d1",
      origin: "simulation",
      status,
      distanceMm: 300,
      volumeLiters,
      valve: "closed",
      netFlowLitersPerHour: 0,
      trend: "stable",
      overflowing: false,
      measuredAt: 0,
    },
    totals: { capturedLiters: 0, reusedLiters: 0, discardedEstimatedLiters: 0 },
    simulation: null,
  };
}

describe("getMissionAvailability", () => {
  it("libera quando há água acima da reserva", () => {
    expect(getMissionAvailability(mission, snapshot(3.5), false)).toEqual({ status: "available", freeLiters: 3 });
  });

  it("informa quanto falta considerando a reserva mínima", () => {
    const result = getMissionAvailability(mission, snapshot(3), false);
    expect(result.status).toBe("waiting_water");
    if (result.status === "waiting_water") expect(result.missingLiters).toBeCloseTo(0.5);
  });

  it("bloqueia durante outra liberação", () => {
    expect(getMissionAvailability(mission, snapshot(10), true).status).toBe("busy");
    expect(getMissionAvailability(mission, snapshot(10, "DISPENSING"), false).status).toBe("busy");
  });

  it("bloqueia com dispositivo offline, em erro ou sem dados", () => {
    expect(getMissionAvailability(mission, snapshot(10, "OFFLINE"), false).status).toBe("device_unavailable");
    expect(getMissionAvailability(mission, snapshot(10, "ERROR"), false).status).toBe("device_unavailable");
    expect(getMissionAvailability(mission, null, false).status).toBe("device_unavailable");
  });
});

describe("execução", () => {
  const progress = (status: DispenseProgress["status"]): DispenseProgress => ({
    commandId: "x",
    status,
    targetLiters: 3,
    deliveredLiters: 2.98,
    startVolumeLiters: 10,
    endVolumeLiters: 7.02,
    queuedAt: 0,
    startedAt: 1,
    finishedAt: 2,
    failure: null,
    cancelRequested: false,
    origin: "simulation",
  });

  it("identifica estados terminais", () => {
    expect(isTerminal(progress("COMPLETED"))).toBe(true);
    expect(isTerminal(progress("FAILED"))).toBe(true);
    expect(isTerminal(progress("CANCELLED"))).toBe(true);
    expect(isTerminal(progress("EXECUTING"))).toBe(false);
    expect(isTerminal(null)).toBe(false);
  });

  it("concede XP somente com conclusão confirmada", () => {
    expect(xpForExecution(mission, progress("COMPLETED"))).toBe(50);
    expect(xpForExecution(mission, progress("FAILED"))).toBe(0);
    expect(xpForExecution(mission, progress("CANCELLED"))).toBe(0);
  });

  it("todas as missões de ação têm volume positivo", () => {
    for (const item of MISSION_CATALOG.filter((m) => m.category === "action")) {
      expect(item.liters).toBeGreaterThan(0);
    }
  });
});
