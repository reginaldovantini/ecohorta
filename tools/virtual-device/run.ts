/*
 * DISPOSITIVO VIRTUAL EC-001 (is_simulated = true)
 *
 * Processo separado que se comporta como o ESP32: lê o "sensor", controla a
 * "válvula" e conversa com a plataforma SOMENTE pela API IoT:
 *   POST /api/iot/telemetry  → envia leitura + relatório do comando
 *                            ← recebe comando pendente e parâmetros da simulação
 *
 * Uso: `npm run dev` (sobe plataforma + dispositivo) ou `npm run device:virtual`.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DeviceSimulationState, TelemetryPayload, TelemetryResponse } from "@/lib/iot/api-schema";
import {
  DEFAULT_SIMULATION_SETTINGS,
  SIMULATED_COLLECTOR,
  SIMULATED_DEVICE_ID,
  VIRTUAL_DEVICE_CONFIG,
} from "@/lib/iot/simulation-config";
import type { SimulationSettings } from "@/lib/iot/types";
import { createVirtualDevice } from "@/lib/iot/virtual-device";

const FW_VERSION = "virtual-0.2.0";
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

async function loadVolume() {
  try {
    const saved = JSON.parse(await readFile(STATE_FILE, "utf8")) as { volumeLiters?: unknown };
    return typeof saved.volumeLiters === "number" ? saved.volumeLiters : INITIAL_VOLUME_LITERS;
  } catch {
    return INITIAL_VOLUME_LITERS;
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
  const device = createVirtualDevice(VIRTUAL_DEVICE_CONFIG, {
    volumeLiters: await loadVolume(),
    settings: physicsOf(settings),
  });

  const save = async () => {
    await mkdir(path.dirname(STATE_FILE), { recursive: true });
    await writeFile(STATE_FILE, JSON.stringify({ volumeLiters: device.exportState().volumeLiters }));
  };

  const applySimulation = (state: DeviceSimulationState | null) => {
    if (!state) return;
    if (state.settings.timeScale !== settings.timeScale) log(`velocidade ${state.settings.timeScale}×`);
    if (state.settings.offline !== settings.offline) log(state.settings.offline ? "simulando OFFLINE" : "voltando a enviar telemetria");
    settings = state.settings;
    device.updateSettings(physicsOf(settings));

    const { action } = state;
    if (action && action.id > appliedActionId) {
      const ratio = action.type === "set_level" ? action.ratio : INITIAL_VOLUME_LITERS / VIRTUAL_DEVICE_CONFIG.capacityLiters;
      if (device.setLevel(ratio)) {
        appliedActionId = action.id;
        log(action.type === "set_level" ? `nível ajustado para ${Math.round(ratio * 100)}%` : "simulação reiniciada");
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
        distance_mm: reading.distanceMm,
        volume_liters: reading.volumeLiters,
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
