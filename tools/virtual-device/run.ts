/*
 * DISPOSITIVO VIRTUAL do captador SIM-001 (is_simulated = true). EC-001 é o captador físico.
 *
 * Processo separado que se comporta como o ESP32: lê o "sensor", controla a
 * "válvula" e conversa com a plataforma SOMENTE pela API IoT:
 *   POST /api/iot/telemetry  → envia leitura + relatório do comando
 *                            ← recebe comando pendente, parâmetros da simulação e a
 *                              configuração de hardware (sensor VL53L0X ou VL53L1X)
 *
 * Uso: `npm run dev` (sobe plataforma + dispositivo) ou `npm run device:virtual`.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { isDistanceSensorModel, type DistanceSensorModel } from "@/lib/collector/distance-sensors";
import type { DeviceSimulationState, HardwareConfig, TelemetryPayload, TelemetryResponse } from "@/lib/iot/api-schema";
import {
  DEFAULT_SIMULATION_SETTINGS,
  SIMULATED_COLLECTOR,
  SIMULATED_DEVICE_ID,
  VIRTUAL_DEVICE_CONFIG,
} from "@/lib/iot/simulation-config";
import type { SimulationSettings } from "@/lib/iot/types";
import { createVirtualDevice } from "@/lib/iot/virtual-device";

const FW_VERSION = "virtual-0.3.0";
const TICK_MS = 100;
const INITIAL_VOLUME_LITERS = 6.6;
const SAVE_EVERY_MS = 10_000;
const STATE_FILE = path.join(process.cwd(), ".data", `virtual-${SIMULATED_COLLECTOR.code}.json`);

try {
  process.loadEnvFile(".env.local");
} catch {
  // .env.local é opcional quando as variáveis vêm do ambiente (ex.: CI).
}

const API_URL = (process.env.ECOHORTA_API_URL || "http://localhost:3000").replace(/\/$/, "");
const TOKEN = process.env.IOT_SIMULATED_DEVICE_TOKEN;

const log = (message: string) => console.log(`\x1b[35m[dispositivo virtual]\x1b[0m ${message}`);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const physicsOf = (settings: SimulationSettings) => ({
  inflowEnabled: settings.inflowEnabled,
  inflowLitersPerHour: settings.inflowLitersPerHour,
  faultNoFlow: settings.faultNoFlow,
});

/** Estado salvo: nível físico do tubo virtual e a configuração de hardware recebida (como a NVS do ESP32). */
async function loadState(): Promise<{ volumeLiters: number; sensorModel?: DistanceSensorModel; hardwareRevision: number | null }> {
  try {
    const saved = JSON.parse(await readFile(STATE_FILE, "utf8")) as { volumeLiters?: unknown; sensorModel?: unknown; hardwareRevision?: unknown };
    return {
      volumeLiters: typeof saved.volumeLiters === "number" ? saved.volumeLiters : INITIAL_VOLUME_LITERS,
      sensorModel: isDistanceSensorModel(saved.sensorModel) ? saved.sensorModel : undefined,
      hardwareRevision: typeof saved.hardwareRevision === "number" ? saved.hardwareRevision : null,
    };
  } catch {
    return { volumeLiters: INITIAL_VOLUME_LITERS, hardwareRevision: null };
  }
}

async function main() {
  if (!TOKEN) {
    log("IOT_SIMULATED_DEVICE_TOKEN não definido. Rode `npm run db:seed` (gera o token no .env.local e registra o hash no banco).");
    process.exit(1);
  }

  let settings: SimulationSettings = { ...DEFAULT_SIMULATION_SETTINGS };
  let appliedActionId = 0;
  let seq = 0;
  let connected = false;
  let lastReportKey = "";
  const saved = await loadState();
  let hardwareRevision = saved.hardwareRevision;
  const device = createVirtualDevice(VIRTUAL_DEVICE_CONFIG, {
    volumeLiters: saved.volumeLiters,
    settings: physicsOf(settings),
    sensorModel: saved.sensorModel,
  });

  const save = async () => {
    await mkdir(path.dirname(STATE_FILE), { recursive: true });
    await writeFile(
      STATE_FILE,
      JSON.stringify({ volumeLiters: device.exportState().volumeLiters, sensorModel: device.sensorModel(), hardwareRevision }),
    );
  };

  // Mesmo comportamento do firmware: a plataforma define o sensor; troca o driver e guarda a configuração.
  const applyHardware = (hardware: HardwareConfig | undefined) => {
    if (!hardware || !isDistanceSensorModel(hardware.distance_sensor)) return;
    if (device.setSensorModel(hardware.distance_sensor)) {
      log(`sensor configurado na plataforma: ${hardware.distance_sensor} (revisão ${hardware.revision}) — driver trocado`);
    }
    if (hardware.revision !== hardwareRevision) {
      hardwareRevision = hardware.revision;
      void save().catch(() => undefined);
    }
  };

  const applySimulation = (state: DeviceSimulationState | null) => {
    if (!state) return;
    if (state.settings.timeScale !== settings.timeScale) log(`velocidade ${state.settings.timeScale}×`);
    if (state.settings.offline !== settings.offline) log(state.settings.offline ? "simulando OFFLINE" : "voltando a enviar telemetria");
    settings = state.settings;
    device.updateSettings(physicsOf(settings));

    const { action } = state;
    if (action && action.id > appliedActionId) {
      let applied: boolean;
      let message: string;
      switch (action.type) {
        case "set_level":
          applied = device.setLevel(action.ratio);
          message = `nível ajustado para ${Math.round(action.ratio * 100)}%`;
          break;
        case "set_volume":
          applied = device.setVolume(action.liters);
          message = `volume ajustado para ${action.liters.toFixed(2)} L`;
          break;
        case "set_distance":
          applied = device.setDistance(action.distance_mm);
          message = `superfície a ${Math.round(action.distance_mm)} mm do sensor`;
          break;
        case "reset":
          applied = device.setVolume(INITIAL_VOLUME_LITERS);
          message = "simulação reiniciada";
          break;
      }
      if (applied) {
        appliedActionId = action.id;
        log(message);
      }
    }
  };

  // Física e firmware: avançam continuamente, na velocidade escolhida no painel.
  let last = performance.now();
  setInterval(() => {
    const now = performance.now();
    const realMs = Math.min(1000, now - last);
    last = now;
    device.advance(realMs * settings.timeScale, realMs);
  }, TICK_MS);

  setInterval(() => void save().catch(() => undefined), SAVE_EVERY_MS);
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => void save().finally(() => process.exit(0)));
  }

  const headers = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };
  log(`conectando a ${API_URL} como ${SIMULATED_DEVICE_ID} (${SIMULATED_COLLECTOR.code})`);

  // Comunicação: mesmo ciclo que o firmware do ESP32 executará.
  while (true) {
    let nextPollMs = 1000;
    try {
      if (settings.offline) {
        const response = await fetch(
          `${API_URL}/api/iot/simulation?device_id=${SIMULATED_DEVICE_ID}&applied_action_id=${appliedActionId}`,
          { headers, signal: AbortSignal.timeout(5000) },
        );
        if (response.ok) applySimulation(((await response.json()) as { simulation: DeviceSimulationState }).simulation);
        await sleep(2000);
        continue;
      }

      const reading = device.reading();
      const report = device.commandReport();
      const payload: TelemetryPayload = {
        device_id: SIMULATED_DEVICE_ID,
        collector_code: SIMULATED_COLLECTOR.code,
        seq: ++seq,
        uptime_ms: reading.uptimeMs,
        // Dado primário: distância. O volume enviado só vale enquanto o captador não tem calibração na plataforma.
        distance_mm: reading.distanceMm,
        volume_liters: reading.volumeLiters,
        sensor_model: device.sensorModel(),
        hardware_revision: hardwareRevision,
        sensor_diagnostics: reading.diagnostics,
        valve: reading.valve,
        status: reading.status,
        fw_version: FW_VERSION,
        command_report: report,
        applied_simulation_action_id: appliedActionId,
      };

      const response = await fetch(`${API_URL}/api/iot/telemetry`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) {
        log(`plataforma respondeu HTTP ${response.status}${response.status === 401 ? " (token do dispositivo inválido)" : ""}`);
        await sleep(3000);
        continue;
      }
      if (!connected) {
        connected = true;
        log(`conectado | ${reading.volumeLiters.toFixed(2)} L`);
      }

      const body = (await response.json()) as TelemetryResponse;
      applyHardware(body.hardware);
      if (body.command) device.receive(body.command);
      applySimulation(body.simulation);

      const current = device.commandReport();
      const reportKey = current ? `${current.command_id}:${current.status}` : "";
      if (current && reportKey !== lastReportKey) {
        lastReportKey = reportKey;
        log(`comando ${current.command_id.slice(0, 8)} -> ${current.status} | ${current.delivered_liters.toFixed(2)} L${current.failure ? ` (${current.failure})` : ""}`);
      }
      // Mesmo comportamento esperado do ESP32: o servidor define o intervalo (mais curto durante uma liberação).
      nextPollMs = body.next_poll_ms;
    } catch {
      if (connected) log("plataforma indisponível, tentando novamente…");
      connected = false;
      nextPollMs = 2000;
    }
    await sleep(nextPollMs);
  }
}

void main();
