import { describe, expect, it } from "vitest";
import type { CollectorSnapshot, DeviceStatus } from "@/lib/iot/types";
import { findMission } from "./catalog";
import { buildRescueMission, getRescuePlan } from "./rescue";

function snapshot(volumeLiters: number, { overflowing = false, status = "READY" as DeviceStatus } = {}): CollectorSnapshot {
  return {
    info: { id: "c", code: "EC-001", name: "", location: "", capacityLiters: 12, reserveLiters: 0.5, valveKind: "undefined" },
    telemetry: {
      deviceId: "d",
      origin: "simulation",
      status,
      distanceMm: 100,
      volumeLiters,
      valve: "closed",
      netFlowLitersPerHour: 1.2,
      trend: "rising",
      overflowing,
      measuredAt: 0,
    },
    totals: { capturedLiters: 0, reusedLiters: 0, discardedEstimatedLiters: 0 },
    simulation: null,
  };
}

describe("missão de resgate", () => {
  it("não existe abaixo da faixa de atenção", () => {
    expect(getRescuePlan(snapshot(7.2))).toBeNull(); // 60%
    expect(getRescuePlan(snapshot(10.2))).toBeNull(); // 85%
  });

  it("surge em atenção sugerindo voltar a ~70%, em múltiplos de 0,5 L", () => {
    const plan = getRescuePlan(snapshot(10.8))!; // 90%
    expect(plan.urgency).toBe("attention");
    expect(plan.suggestedLiters).toBe(2.5);
    expect(plan.litersToLimit).toBeCloseTo(1.2);
  });

  it("fica crítica em transbordamento", () => {
    const plan = getRescuePlan(snapshot(12, { overflowing: true }))!;
    expect(plan).toMatchObject({ urgency: "critical", overflowing: true, litersToLimit: 0, suggestedLiters: 3.5 });
  });

  it("não aparece com o captador offline", () => {
    expect(getRescuePlan(snapshot(11.8, { status: "OFFLINE" }))).toBeNull();
  });

  it("gera uma missão de liberação com o volume sugerido e XP próprio", () => {
    const mission = buildRescueMission(getRescuePlan(snapshot(11.6))!);
    expect(mission).toMatchObject({ id: "resgate", category: "rescue", kind: "dispense", xp: 60 });
    expect(mission.liters).toBeGreaterThanOrEqual(1);
    expect(findMission("resgate")?.title).toBe("Missão de resgate");
  });
});
