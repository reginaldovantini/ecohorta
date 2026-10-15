import { describe, expect, it } from "vitest";
import type { CollectorSnapshot, DeviceStatus } from "@/lib/iot/types";
import { findMission } from "./catalog";
import { isDispatchable, priorityOf, rankCollectors, rescueTarget, targetFor, totalDiscardedLiters } from "./dispatch";
import { DEFAULT_SCHOOL_SCHEDULE } from "@/lib/collector/school-hours";

function snapshot(
  code: string,
  volumeLiters: number,
  extra: {
    capacityLiters?: number;
    reserveLiters?: number;
    status?: DeviceStatus;
    overflowing?: boolean;
    netFlowLitersPerHour?: number;
    discarded?: number;
    benchMode?: boolean;
    incompatible?: boolean;
  } = {},
): CollectorSnapshot {
  const capacityLiters = extra.capacityLiters ?? 12;
  return {
    info: {
      id: code.toLowerCase(),
      code,
      name: `Captador ${code}`,
      location: `Local ${code}`,
      capacityLiters,
      reserveLiters: extra.reserveLiters ?? 0.5,
      valveKind: "undefined",
    },
    telemetry: {
      deviceId: `DEV-${code}`,
      origin: "device",
      status: extra.status ?? "READY",
      distanceMm: 800,
      volumeLiters,
      volumeSource: "calibration",
      valve: "closed",
      netFlowLitersPerHour: extra.netFlowLitersPerHour ?? 1.2,
      trend: "rising",
      overflowing: extra.overflowing ?? false,
      measuredAt: Date.now(),
      learnedInflowLitersPerHour: 1.2,
      acSchedule: DEFAULT_SCHOOL_SCHEDULE,
    },
    totals: { capturedLiters: volumeLiters, reusedLiters: 0, discardedEstimatedLiters: extra.discarded ?? 0 },
    simulation: null,
    benchMode: extra.benchMode ?? false,
    ...(extra.incompatible
      ? { hardware: { distanceSensor: "VL53L1X" as const, revision: 1, reportedSensor: "VL53L0X", reportedRevision: 1, sensorState: "ready" as const, compatibility: "incompatible" as const, message: "" } }
      : {}),
  };
}

describe("despacho entre captadores", () => {
  it("manda primeiro ao captador que já está transbordando, mesmo que outro tenha mais água livre", () => {
    const quaseCheio = snapshot("ECO-001", 11.5); // 96%, crítico, mas ainda não perdeu água
    const transbordando = snapshot("ECO-002", 9, { capacityLiters: 9, overflowing: true });

    const [primeiro, segundo] = rankCollectors([quaseCheio, transbordando]);
    expect(primeiro!.code).toBe("ECO-002");
    expect(primeiro!.urgency).toBe("overflowing");
    expect(primeiro!.reason).toMatch(/indo para o dreno agora/);
    expect(segundo!.code).toBe("ECO-001");
  });

  it("ordena por urgência antes de volume: 90% ganha de 60% mesmo com menos litros", () => {
    const pequenoCheio = snapshot("ECO-002", 5.4, { capacityLiters: 6 }); // 90% → atenção
    const grandeFolgado = snapshot("ECO-001", 12, { capacityLiters: 20 }); // 60% → normal

    const ordem = rankCollectors([grandeFolgado, pequenoCheio]).map((item) => item.code);
    expect(ordem).toEqual(["ECO-002", "ECO-001"]);
  });

  it("no mesmo nível, indica o que enche mais rápido: chega ao dreno antes", () => {
    const devagar = snapshot("ECO-001", 7.2, { netFlowLitersPerHour: 0.8 });
    const rapido = snapshot("ECO-002", 7.2, { netFlowLitersPerHour: 4 });

    expect(rankCollectors([devagar, rapido])[0]!.code).toBe("ECO-002");
  });

  it("estima quanto tempo falta até a água começar a ir para o dreno", () => {
    // 2 L até a boca do dreno, entrando 4 L/h → 30 min.
    const priority = priorityOf(snapshot("ECO-001", 10, { netFlowLitersPerHour: 4 }));
    expect(priority.litersToDrain).toBeCloseTo(2, 3);
    expect(priority.minutesToDrain).toBe(30);
  });

  it("não promete tempo quando o captador não está enchendo", () => {
    expect(priorityOf(snapshot("ECO-001", 10, { netFlowLitersPerHour: 0 })).minutesToDrain).toBeNull();
  });
});

describe("captadores fora de serviço", () => {
  it.each([
    ["offline", { status: "OFFLINE" as DeviceStatus }],
    ["em erro", { status: "ERROR" as DeviceStatus }],
    ["sem calibração", { status: "CALIBRATING" as DeviceStatus }],
    ["em ensaio de bancada", { benchMode: true }],
    ["com sensor incompatível", { incompatible: true }],
  ])("nunca é indicado quando está %s", (_nome, extra) => {
    const fora = snapshot("ECO-002", 11.9, extra);
    expect(isDispatchable(fora)).toBe(false);
    expect(rankCollectors([snapshot("ECO-001", 3), fora]).map((item) => item.code)).toEqual(["ECO-001"]);
  });

  it("sem nenhum captador em serviço, não indica nada", () => {
    expect(rankCollectors([snapshot("ECO-001", 11, { status: "OFFLINE" })])).toEqual([]);
  });
});

describe("destino de cada missão", () => {
  const regar = findMission("regar-jardim")!; // 3 L

  it("manda ao mais urgente que tenha água suficiente", () => {
    const urgenteSemAgua = snapshot("ECO-002", 11.8, { capacityLiters: 12, reserveLiters: 11 }); // cheio, mas quase tudo é reserva
    const folgadoComAgua = snapshot("ECO-001", 6);

    const { target, missingLiters } = targetFor(regar, rankCollectors([urgenteSemAgua, folgadoComAgua]));
    expect(target!.code).toBe("ECO-001");
    expect(missingLiters).toBe(0);
  });

  it("sem água em lugar nenhum, aponta o mais cheio e diz quanto falta", () => {
    const { target, missingLiters } = targetFor(regar, rankCollectors([snapshot("ECO-001", 1), snapshot("ECO-002", 2)]));
    expect(target!.code).toBe("ECO-002"); // 2 L − 0,5 L de reserva = 1,5 L livres
    expect(missingLiters).toBeCloseTo(1.5, 3);
  });

  it("sem captador em serviço, a missão fica sem destino", () => {
    const { target, missingLiters } = targetFor(regar, rankCollectors([snapshot("ECO-001", 8, { status: "OFFLINE" })]));
    expect(target).toBeNull();
    expect(missingLiters).toBe(3);
  });
});

describe("resgate: evitar o dreno", () => {
  it("escolhe o captador que está perdendo água, não o primeiro da lista", () => {
    const tranquilo = snapshot("ECO-001", 4);
    const perdendo = snapshot("ECO-002", 12, { overflowing: true });

    const resgate = rescueTarget([tranquilo, perdendo])!;
    expect(resgate.priority.code).toBe("ECO-002");
    expect(resgate.suggestedLiters).toBeGreaterThan(0);
  });

  it("não inventa resgate quando todos estão em nível normal", () => {
    expect(rescueTarget([snapshot("ECO-001", 3), snapshot("ECO-002", 5)])).toBeNull();
  });

  it("soma a água já perdida pelo dreno em todos os captadores", () => {
    expect(totalDiscardedLiters([snapshot("ECO-001", 5, { discarded: 2.4 }), snapshot("ECO-002", 5, { discarded: 1.35 })])).toBe(3.75);
  });
});
