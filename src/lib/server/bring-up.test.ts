import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { CALIBRATION_STEP_IDS } from "@/lib/collector/volume-calibration";
import { secretsHeader } from "@/lib/collector/firmware-package";
import type { TelemetryPayload } from "@/lib/iot/api-schema";
import { createCalibrationService } from "./calibration-service";
import { createCollectorService, type CollectorService } from "./collector-service";
import { createCollectorSetupService } from "./collector-setup-service";
import { registerCollector, scanCollector } from "./collector-registry";
import { getMe } from "./profile-service";
import { registerSchool } from "./school-registry";
import { ACTORS, createTestDatabase, IDS, resetTestDatabase, TEST_PEPPER } from "./db/test-db";
import type { Actor } from "./actor";
import type { Database } from "./db/types";

/*
 * DO CADASTRO À PRIMEIRA MISSÃO, SEM ATALHO.
 *
 * Os outros testes partem de um captador já semeado no banco, com dispositivo e
 * token prontos. Este não parte de nada: cadastra o captador como a tela
 * cadastra, gera o programa da placa como a tela gera, autentica com o token
 * que saiu dali, calibra com água medida, e só então um estudante lê o QR e a
 * água sai.
 *
 * É o ensaio de instalação, em software. Ele existe porque cada peça pode estar
 * certa e a montagem, errada — e porque a montagem errada só aparece com a
 * placa na parede, um estudante esperando e ninguém sabendo o que olhar.
 */

let pg: PGlite;
let db: Database;
let collectors: CollectorService;
let clock = 0;
let seq = 0;

/** Quem administra a escola: é quem cadastra o captador e conduz a calibração. */
const admin: Actor = {
  profileId: IDS.teacher,
  schoolId: IDS.school,
  role: "teacher",
  platformAdmin: false,
  adminOfSchool: IDS.school,
  stewardOf: [],
};

const MM_PER_LITER = 1_000_000 / ((Math.PI / 4) * 96.8 ** 2);
const tubo = (litros: number) => 1700 - litros * MM_PER_LITER;

beforeAll(async () => {
  ({ pg, db } = await createTestDatabase());
}, 60_000);

beforeEach(async () => {
  await resetTestDatabase(db);
  clock = 1_700_000_000_000;
  seq = 0;
  collectors = createCollectorService({ db, pepper: TEST_PEPPER, now: () => clock });
});

afterAll(async () => {
  await pg.close();
});

/** A telemetria que o firmware monta, com o código e a placa daquele captador. */
const daPlaca = (code: string, deviceKey: string, patch: Partial<TelemetryPayload> = {}): TelemetryPayload => {
  seq++;
  return {
    device_id: deviceKey,
    collector_code: code,
    seq,
    uptime_ms: seq * 1000,
    distance_mm: tubo(8),
    sensor_model: "VL53L1X",
    hardware_revision: 1,
    valve: "closed",
    status: "MAINTENANCE",
    fw_version: "esp32-0.5.0",
    command_report: null,
    ...patch,
  };
};

describe("instalar um captador do zero e rodar a primeira missão", () => {
  it("percorre cadastro, programa da placa, conexão, calibração, habilitação e missão", async () => {
    // ---- 1. CADASTRO. A escola e o tubo entram como a tela os cadastra. ----
    const escola = await db.transaction((tx) =>
      registerSchool(tx, { name: "EE Prof.ª Clarinda Mendes de Aquino", city: "Campo Grande", state: "MS", enrolledStudents: 820 }),
    );
    const captador = await db.transaction((tx) =>
      registerCollector(tx, {
        schoolId: escola.id,
        location: "Pátio coberto, ao lado da sala 3",
        nominalDiameterMm: 100,
        nominalUsefulHeightMm: 1500,
        reserveLiters: 0.5,
        distanceSensor: "VL53L1X",
        createdBy: admin.profileId,
        pepper: TEST_PEPPER,
      }),
    );
    // Nasce protótipo: um tubo que ainda não mede nada não é captador da escola.
    expect(captador.code).toBe("PROTO-001");
    expect(captador.stewardCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(captador.network.ssid).toBeTruthy();

    // Este administrador administra esta escola: é o que a tela usa para decidir.
    const conduz: Actor = { ...admin, schoolId: escola.id, adminOfSchool: escola.id };

    // ---- 2. O PROGRAMA DA PLACA. O token sai daqui e de nenhum registro. ----
    const setup = createCollectorSetupService({ db });
    const pacote = await setup.issueFirmware(conduz, captador.code, {
      apiBaseUrl: "https://ecohorta-inteligente.vercel.app",
      pepper: TEST_PEPPER,
    });
    if (!pacote.ok) throw new Error(pacote.message);
    const { deviceKey, deviceToken } = pacote.value.identity;

    // O secrets.h gerado carrega a identidade, e a senha do Wi-Fi da escola não.
    const secrets = secretsHeader(pacote.value.identity);
    expect(secrets).toContain(deviceToken);
    expect(secrets).toContain(captador.code);
    expect(secrets).not.toContain("WIFI_PASSWORD");

    // ---- 3. CONEXÃO. A placa se autentica com o token que acabou de receber. ----
    const device = await collectors.authenticateDevice(`Bearer ${deviceToken}`, deviceKey, captador.code);
    expect(device).not.toBeNull();
    // E um token errado não entra.
    expect(await collectors.authenticateDevice("Bearer token-de-outra-placa", deviceKey, captador.code)).toBeNull();

    const primeira = await collectors.ingestTelemetry(device!, daPlaca(captador.code, deviceKey));
    // Sem calibração a placa mede, mas não pode liberar água.
    expect(primeira.hardware.calibration).toBeNull();

    // ---- 4. CALIBRAÇÃO com volumes conhecidos, medidos pelo sensor. ----
    const calibrations = createCalibrationService({ db, now: () => clock });
    expect(await calibrations.startSession(conduz, captador.code)).toMatchObject({ ok: true });
    const pontos = { zero: tubo(0), one: tubo(1), two: tubo(2), three: tubo(3), max: 200 } as const;
    for (const passo of CALIBRATION_STEP_IDS) {
      for (let i = 0; i < 20; i++) {
        clock += 400;
        await collectors.ingestTelemetry(device!, daPlaca(captador.code, deviceKey, { distance_mm: pontos[passo] + (i % 3) - 1 }));
      }
      expect(await calibrations.registerPoint(conduz, captador.code, passo)).toMatchObject({ ok: true });
    }
    const aceita = await calibrations.completeSession(conduz, captador.code);
    if (!aceita.ok) throw new Error(aceita.message);

    // ---- 5. HABILITAÇÃO. O número da escola se conquista calibrando. ----
    const { rows } = await db.query<{ code: string; activated_at: Date | null }>(
      "select code, activated_at from public.collectors where id = $1",
      [captador.id],
    );
    expect(rows[0]!.code).toBe("ECO-001");
    expect(rows[0]!.activated_at).not.toBeNull();

    // A calibração viaja até a placa: é ela que fecha a válvula no volume certo.
    clock += BENCH_LIVRE_MS;
    const comCalibracao = await collectors.ingestTelemetry(device!, daPlaca("ECO-001", deviceKey, { status: "READY" }));
    const modelo = comCalibracao.hardware.calibration;
    expect(modelo).not.toBeNull();
    expect(modelo!.constant_liters_per_mm * (modelo!.zero_distance_mm - tubo(3))).toBeCloseTo(3, 1);

    // ---- 6. A MISSÃO. O estudante lê o adesivo colado no tubo. ----
    const leitura = await db.transaction((tx) => scanCollector(tx, IDS.student, captador.qrToken));
    expect(leitura).not.toBeNull();
    expect(leitura!.code).toBe("ECO-001");

    const estudante: Actor = { ...ACTORS.student, schoolId: escola.id };
    const COMANDO = "f0000000-0000-4000-8000-000000000001";
    const EXECUCAO = "f0000000-0000-4000-8000-000000000002";
    const pedido = await collectors.requestDispense(estudante, "ECO-001", {
      command_id: COMANDO,
      execution_id: EXECUCAO,
      mission_id: "regar-jardim",
      scan_id: leitura!.scanId,
    });
    if (!pedido.ok) throw new Error(pedido.message);
    expect(pedido.value.targetLiters).toBe(3);

    // ---- 7. A PLACA RECEBE, ABRE, MEDE E FECHA. ----
    clock += 1000;
    const comando = await collectors.ingestTelemetry(device!, daPlaca("ECO-001", deviceKey, { status: "READY" }));
    expect(comando.command).toMatchObject({ command_id: COMANDO, action: "dispense" });

    clock += 12_000;
    await collectors.ingestTelemetry(
      device!,
      daPlaca("ECO-001", deviceKey, {
        distance_mm: tubo(5),
        status: "READY",
        command_report: {
          command_id: COMANDO,
          status: "COMPLETED",
          delivered_liters: 3,
          start_volume_liters: 8,
          end_volume_liters: 5,
          start_distance_mm: tubo(8),
          end_distance_mm: tubo(5),
          failure: null,
          started_uptime_ms: 1000,
          finished_uptime_ms: 13_000,
        },
      }),
    );

    // ---- 8. O IMPACTO CHEGA AO ESTUDANTE. ----
    const perfil = await getMe(db, estudante);
    expect(perfil.xp).toBeGreaterThan(0);
    expect(perfil.history[0]).toMatchObject({ status: "COMPLETED", collectorCode: "ECO-001", missionId: "regar-jardim" });
    expect(Number(perfil.history[0]!.deliveredLiters)).toBeCloseTo(3, 2);

    // E o estudante comum não vê nada de administração.
    expect(perfil.canAdminister).toBe(false);
    expect(perfil.platformAdmin).toBe(false);
  }, 30_000);
});

/*
 * DUAS ESCOLAS, DOIS ECO-001.
 *
 * O código do captador é sequencial DENTRO da escola — e tem de ser, senão a
 * segunda escola da rede receberia ECO-047 no primeiro tubo dela. A
 * consequência é que ECO-001 existe em toda escola, e procurar um captador só
 * pelo código devolve um tubo qualquer entre eles.
 *
 * Enquanto houve uma escola só, isso nunca apareceu. Apareceria no dia em que a
 * primeira escola parceira cadastrasse o captador dela — e apareceria como
 * telas falhando sem explicação, na escola errada, de forma intermitente.
 */
describe("a rede com mais de uma escola", () => {
  it("cada escola calibra o SEU ECO-001", async () => {
    const criar = async (nome: string, cidade: string) => {
      const escola = await db.transaction((tx) => registerSchool(tx, { name: nome, city: cidade, state: "MS" }));
      const captador = await db.transaction((tx) =>
        registerCollector(tx, {
          schoolId: escola.id,
          location: `Pátio da ${nome}`,
          nominalDiameterMm: 100,
          nominalUsefulHeightMm: 1500,
          reserveLiters: 0.5,
          createdBy: null,
          pepper: TEST_PEPPER,
        }),
      );
      // Vira ECO-001 da escola dela.
      await db.query("update public.collectors set prefix = 'ECO', code = 'ECO-001', activated_at = now() where id = $1", [captador.id]);
      return { escola, captador };
    };

    const uma = await criar("EE Primeira", "Campo Grande");
    const outra = await criar("EE Segunda", "Três Lagoas");

    // Os dois existem, com o mesmo código, em escolas diferentes.
    const { rows } = await db.query<{ n: number }>("select count(*)::int as n from public.collectors where code = 'ECO-001'");
    expect(rows[0]!.n).toBeGreaterThanOrEqual(2);

    const calibrations = createCalibrationService({ db, now: () => clock });
    const administra = (escolaId: string): Actor => ({
      profileId: IDS.teacher,
      schoolId: escolaId,
      role: "teacher",
      platformAdmin: false,
      adminOfSchool: escolaId,
      stewardOf: [],
    });

    // Cada administração abre a calibração do próprio tubo, e nunca a do outro.
    const daUma = await calibrations.getView(administra(uma.escola.id), "ECO-001");
    if (!daUma.ok) throw new Error(daUma.message);
    expect(daUma.value.collector.location).toContain("Primeira");

    const daOutra = await calibrations.getView(administra(outra.escola.id), "ECO-001");
    if (!daOutra.ok) throw new Error(daOutra.message);
    expect(daOutra.value.collector.location).toContain("Segunda");
  }, 30_000);
});

/** O ensaio de bancada que a calibração liga expira sozinho; aqui o relógio passa por ele. */
const BENCH_LIVRE_MS = 16 * 60_000;
