import { beforeEach, describe, expect, it } from "vitest";
import type { TelemetryPayload } from "@/lib/iot/api-schema";
import { SIMULATED_COLLECTOR } from "@/lib/iot/simulation-config";
import { createCollectorService, type CollectorService } from "./collector-service";

const TOKEN = "token-de-teste-com-tamanho-suficiente";
const IDS = {
  a: "0b7c6a8e-1f2d-4c3b-9a8e-7f6d5c4b3a21",
  b: "1c8d7b9f-2e3d-4d4c-8b9f-8e7d6c5b4a32",
  exec: "2d9e8c0a-3f4e-4e5d-9c0a-9f8e7d6c5b43",
};

let clock = 1_000_000;
let service: CollectorService;
let seq = 0;

function telemetry(patch: Partial<TelemetryPayload> = {}): TelemetryPayload {
  seq++;
  return {
    device_id: "VIRTUAL-001",
    collector_code: "EC-001",
    seq,
    uptime_ms: seq * 1000,
    distance_mm: 700,
    volume_liters: 8,
    valve: "closed",
    status: "READY",
    fw_version: "sim-1",
    ...patch,
  };
}

const dispenseRequest = (commandId: string, liters = 3) => ({
  command_id: commandId,
  execution_id: IDS.exec,
  mission_id: "regar-jardim",
  target_liters: liters,
});

beforeEach(() => {
  clock = 1_000_000;
  seq = 0;
  service = createCollectorService({
    seeds: [{ info: SIMULATED_COLLECTOR, deviceId: "VIRTUAL-001", isSimulated: true, tokenEnvVar: "TEST_TOKEN" }],
    now: () => clock,
    env: { TEST_TOKEN: TOKEN },
  });
});

describe("autenticação do dispositivo", () => {
  it("aceita somente o token correto do dispositivo cadastrado", () => {
    expect(service.authenticateDevice(`Bearer ${TOKEN}`, "VIRTUAL-001", "EC-001")).toBe("EC-001");
    expect(service.authenticateDevice("Bearer errado", "VIRTUAL-001", "EC-001")).toBeNull();
    expect(service.authenticateDevice(`Bearer ${TOKEN}`, "OUTRO", "EC-001")).toBeNull();
    expect(service.authenticateDevice(null, "VIRTUAL-001", "EC-001")).toBeNull();
  });
});

describe("snapshot", () => {
  it("fica OFFLINE sem telemetria recente e aceita códigos sem hífen", () => {
    expect(service.getSnapshot("ec001")?.telemetry.status).toBe("OFFLINE");
    service.ingestTelemetry("EC-001", telemetry());
    expect(service.getSnapshot("EC001")?.telemetry).toMatchObject({ status: "READY", volumeLiters: 8, origin: "simulation" });
    clock += 16_000;
    expect(service.getSnapshot("EC-001")?.telemetry.status).toBe("OFFLINE");
  });
});

describe("ciclo de liberação", () => {
  beforeEach(() => {
    service.ingestTelemetry("EC-001", telemetry());
  });

  it("entrega o comando ao dispositivo até receber o primeiro relatório", () => {
    const created = service.requestDispense("EC-001", dispenseRequest(IDS.a));
    expect(created.ok && created.value.status).toBe("QUEUED");

    expect(service.ingestTelemetry("EC-001", telemetry()).command).toMatchObject({ command_id: IDS.a, action: "dispense" });
    expect(service.ingestTelemetry("EC-001", telemetry()).command?.command_id).toBe(IDS.a);

    const response = service.ingestTelemetry(
      "EC-001",
      telemetry({
        valve: "open",
        status: "DISPENSING",
        command_report: {
          command_id: IDS.a,
          status: "EXECUTING",
          delivered_liters: 0.4,
          start_volume_liters: 8,
          end_volume_liters: null,
          failure: null,
          started_uptime_ms: 5000,
          finished_uptime_ms: null,
        },
      }),
    );
    expect(response.command).toBeNull();
    expect(response.next_poll_ms).toBe(250);
    expect(service.getProgress("EC-001", IDS.a)?.status).toBe("EXECUTING");
  });

  it("é idempotente e registra o reúso medido uma única vez", () => {
    service.requestDispense("EC-001", dispenseRequest(IDS.a));
    expect(service.requestDispense("EC-001", dispenseRequest(IDS.a)).ok).toBe(true);

    const completed = {
      command_id: IDS.a,
      status: "COMPLETED" as const,
      delivered_liters: 2.98,
      start_volume_liters: 8,
      end_volume_liters: 5.02,
      failure: null,
      started_uptime_ms: 5000,
      finished_uptime_ms: 119_000,
    };
    service.ingestTelemetry("EC-001", telemetry({ volume_liters: 5.02, command_report: completed }));
    service.ingestTelemetry("EC-001", telemetry({ volume_liters: 5.02, command_report: completed }));

    const progress = service.getProgress("EC-001", IDS.a)!;
    expect(progress.status).toBe("COMPLETED");
    expect(progress.finishedAt! - progress.startedAt!).toBe(114_000);
    expect(service.getSnapshot("EC-001")?.totals.reusedLiters).toBe(2.98);
  });

  it("recusa uma segunda liberação simultânea e volume acima do disponível", () => {
    service.requestDispense("EC-001", dispenseRequest(IDS.a));
    const busy = service.requestDispense("EC-001", dispenseRequest(IDS.b, 1));
    expect(busy.ok && busy.value).toMatchObject({ status: "FAILED", failure: "DEVICE_BUSY" });

    const other = createCollectorService({
      seeds: [{ info: SIMULATED_COLLECTOR, deviceId: "VIRTUAL-001", isSimulated: true, tokenEnvVar: "TEST_TOKEN" }],
      now: () => clock,
      env: {},
    });
    other.ingestTelemetry("EC-001", telemetry({ volume_liters: 3 }));
    const tooMuch = other.requestDispense("EC-001", dispenseRequest(IDS.a, 3));
    expect(tooMuch.ok && tooMuch.value).toMatchObject({ status: "FAILED", failure: "INSUFFICIENT_WATER" });
  });

  it("cancela imediatamente enquanto na fila e expira se o dispositivo não buscar", () => {
    service.requestDispense("EC-001", dispenseRequest(IDS.a));
    const cancelled = service.requestCancel("EC-001", IDS.a);
    expect(cancelled.ok && cancelled.value.status).toBe("CANCELLED");

    service.requestDispense("EC-001", dispenseRequest(IDS.b, 1));
    clock += 31_000;
    expect(service.getProgress("EC-001", IDS.b)).toMatchObject({ status: "FAILED", failure: "DEVICE_OFFLINE" });
  });

  it("repassa o cancelamento ao dispositivo durante a liberação", () => {
    service.requestDispense("EC-001", dispenseRequest(IDS.a));
    service.ingestTelemetry(
      "EC-001",
      telemetry({
        valve: "open",
        command_report: {
          command_id: IDS.a,
          status: "EXECUTING",
          delivered_liters: 0.5,
          start_volume_liters: 8,
          end_volume_liters: null,
          failure: null,
          started_uptime_ms: 5000,
          finished_uptime_ms: null,
        },
      }),
    );
    service.requestCancel("EC-001", IDS.a);
    expect(service.ingestTelemetry("EC-001", telemetry({ valve: "open" })).command).toEqual({
      command_id: IDS.a,
      action: "cancel",
    });
  });
});

describe("simulação", () => {
  it("entrega ações ao dispositivo virtual até a confirmação", () => {
    const result = service.updateSimulation("EC-001", { settings: { timeScale: 30 }, action: { type: "set_level", ratio: 0.97 } });
    expect(result.ok).toBe(true);

    const response = service.ingestTelemetry("EC-001", telemetry());
    expect(response.simulation?.settings.timeScale).toBe(30);
    expect(response.simulation?.action).toMatchObject({ id: 1, type: "set_level", ratio: 0.97 });

    const acknowledged = service.ingestTelemetry("EC-001", telemetry({ applied_simulation_action_id: 1 }));
    expect(acknowledged.simulation?.action).toBeNull();
  });

  it("ajuste de nível confirmado recomeça a tendência sem apagar o reúso medido", () => {
    service.ingestTelemetry("EC-001", telemetry({ volume_liters: 8 }));
    service.requestDispense("EC-001", dispenseRequest(IDS.a, 2));
    service.ingestTelemetry(
      "EC-001",
      telemetry({
        volume_liters: 6,
        command_report: {
          command_id: IDS.a,
          status: "COMPLETED",
          delivered_liters: 2,
          start_volume_liters: 8,
          end_volume_liters: 6,
          failure: null,
          started_uptime_ms: 3000,
          finished_uptime_ms: 60_000,
        },
      }),
    );

    service.updateSimulation("EC-001", { action: { type: "set_level", ratio: 0.95 } });
    // Ainda no nível antigo (dispositivo não aplicou): nada muda.
    service.ingestTelemetry("EC-001", telemetry({ volume_liters: 6 }));
    // Dispositivo confirma e já envia o novo nível.
    service.ingestTelemetry("EC-001", telemetry({ volume_liters: 11.4, applied_simulation_action_id: 1 }));
    for (let i = 0; i < 5; i++) service.ingestTelemetry("EC-001", telemetry({ volume_liters: 11.4 }));

    const snapshot = service.getSnapshot("EC-001")!;
    expect(snapshot.totals.reusedLiters).toBe(2);
    expect(snapshot.telemetry.trend).toBe("stable");
  });

  it("reiniciar a simulação zera o balanço após a confirmação", () => {
    service.ingestTelemetry("EC-001", telemetry({ volume_liters: 8 }));
    service.updateSimulation("EC-001", { action: { type: "reset" } });
    service.ingestTelemetry("EC-001", telemetry({ volume_liters: 6.6, applied_simulation_action_id: 1 }));
    expect(service.getSnapshot("EC-001")!.totals.reusedLiters).toBe(0);
  });

  it("recusa comandos de simulação para captadores reais", () => {
    const real = createCollectorService({
      seeds: [{ info: SIMULATED_COLLECTOR, deviceId: "ESP32-001", isSimulated: false, tokenEnvVar: "X" }],
      now: () => clock,
      env: {},
    });
    expect(real.updateSimulation("EC-001", { settings: { timeScale: 30 } })).toMatchObject({ ok: false, status: 403 });
  });
});
