import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { TelemetryPayload } from "@/lib/iot/api-schema";
import { createCollectorService, type AuthenticatedDevice, type CollectorService } from "./collector-service";
import { createPost, deletePost, EVIDENCE_BONUS_XP, listMyPosts, listWall, reportPost, toggleLike } from "./mission-wall";
import { getMe } from "./profile-service";
import { recordGuardianConsent, revokeGuardianConsent } from "./provisioning";
import {
  ACTORS,
  createTestDatabase,
  IDS,
  makeCollectorReal,
  resetTestDatabase,
  scanForRelease,
  TEST_DEVICE_TOKEN,
  TEST_PEPPER,
} from "./db/test-db";
import type { Actor } from "./actor";
import type { Database } from "./db/types";

/*
 * O MURAL É EVIDÊNCIA, NÃO ÁLBUM.
 *
 * Cada teste aqui guarda uma das quatro regras que tornam o mural defensável:
 * uma foto por missão medida, curtida que não vira ponto, autorização de imagem
 * como condição, e denúncia que tira do ar antes de alguém analisar.
 */

let pg: PGlite;
let db: Database;
let collectors: CollectorService;
let device: AuthenticatedDevice;
let clock = 0;
let seq = 0;

const eu = ACTORS.student;
const outro = ACTORS.student2;
const CMD = "d1000000-0000-4000-8000-000000000001";
const EXEC = "d1000000-0000-4000-8000-000000000002";

const telemetria = (patch: Partial<TelemetryPayload> = {}): TelemetryPayload => {
  seq++;
  return {
    device_id: "VIRTUAL-001",
    collector_code: "ECO-001",
    seq,
    uptime_ms: seq * 1000,
    distance_mm: 700,
    volume_liters: 9,
    valve: "closed",
    status: "READY",
    fw_version: "esp32-0.5.0",
    ...patch,
  };
};

/** Uma missão cumprida de verdade: é o que o mural exige para aceitar uma foto. */
async function cumprirMissao(commandId = CMD, executionId = EXEC, quem: Actor = eu, quemId: string = IDS.student) {
  const leitura = await scanForRelease(db, quemId);
  const pedido = await collectors.requestDispense(quem, "ECO-001", {
    command_id: commandId,
    execution_id: executionId,
    mission_id: "regar-jardim",
    scan_id: leitura,
  });
  if (!pedido.ok) throw new Error(pedido.message);
  clock += 10_000;
  await collectors.ingestTelemetry(
    device,
    telemetria({
      volume_liters: 6,
      command_report: {
        command_id: commandId,
        status: "COMPLETED",
        delivered_liters: 3,
        start_volume_liters: 9,
        end_volume_liters: 6,
        failure: null,
        started_uptime_ms: 1000,
        finished_uptime_ms: 11_000,
      },
    }),
  );
  return executionId;
}

const autorizarImagem = (profileId: string) =>
  recordGuardianConsent(db, { profileId, purpose: "uso_de_imagem", recordedBy: profileId, method: "termo_digital" });

const publicar = (executionId = EXEC, caption: string | null = "Reguei os canteiros da horta") =>
  createPost(db, eu, { executionId, imagePath: `escola/${IDS.school}/${executionId}.jpg`, caption });

beforeAll(async () => {
  ({ pg, db } = await createTestDatabase());
}, 60_000);

beforeEach(async () => {
  await resetTestDatabase(db);
  await makeCollectorReal(db);
  clock = 1_700_000_000_000;
  seq = 0;
  collectors = createCollectorService({ db, pepper: TEST_PEPPER, now: () => clock });
  const autenticado = await collectors.authenticateDevice(`Bearer ${TEST_DEVICE_TOKEN}`, "VIRTUAL-001", "ECO-001");
  if (!autenticado) throw new Error("dispositivo de teste não autenticou");
  device = autenticado;
  await collectors.ingestTelemetry(device, telemetria());
  await autorizarImagem(IDS.student);
});

afterAll(async () => {
  await pg.close();
});

describe("publicar é registrar a evidência de uma missão medida", () => {
  it("missão concluída vira publicação, e rende o bônus", async () => {
    await cumprirMissao();
    const antes = (await getMe(db, eu)).xp;

    const result = await publicar();
    if (!result.ok) throw new Error(result.message);
    expect(result.value.bonusXp).toBe(EVIDENCE_BONUS_XP);

    const depois = await getMe(db, eu);
    expect(depois.xp).toBe(antes + EVIDENCE_BONUS_XP);
  });

  it("uma foto por missão: a segunda tentativa é recusada", async () => {
    await cumprirMissao();
    expect((await publicar()).ok).toBe(true);
    expect(await publicar()).toMatchObject({ ok: false, status: 409 });
  });

  it("o bônus entra UMA vez, mesmo com duas tentativas", async () => {
    await cumprirMissao();
    const antes = (await getMe(db, eu)).xp;
    await publicar();
    await publicar();
    expect((await getMe(db, eu)).xp).toBe(antes + EVIDENCE_BONUS_XP);
  });

  it("missão de outra pessoa não se publica", async () => {
    await cumprirMissao(CMD, EXEC, outro, IDS.student2);
    expect(await publicar()).toMatchObject({ ok: false, status: 403 });
  });

  it("missão que não concluiu não vira evidência", async () => {
    const leitura = await scanForRelease(db, IDS.student);
    await collectors.requestDispense(eu, "ECO-001", {
      command_id: CMD,
      execution_id: EXEC,
      mission_id: "regar-jardim",
      scan_id: leitura,
    });
    clock += 9000;
    await collectors.ingestTelemetry(
      device,
      telemetria({
        command_report: {
          command_id: CMD,
          status: "FAILED",
          delivered_liters: 0,
          start_volume_liters: 9,
          end_volume_liters: 9,
          failure: "NO_FLOW",
          started_uptime_ms: 1000,
          finished_uptime_ms: 10_000,
        },
      }),
    );
    expect(await publicar()).toMatchObject({ ok: false, status: 409 });
  });

  it("legenda comprida demais é recusada antes de tocar no banco", async () => {
    await cumprirMissao();
    expect(await publicar(EXEC, "x".repeat(141))).toMatchObject({ ok: false, status: 422 });
  });
});

describe("a autorização de imagem é a condição", () => {
  it("sem autorização não publica — e a pontuação base continua intacta", async () => {
    await revokeGuardianConsent(db, IDS.student, "uso_de_imagem");
    await cumprirMissao();
    const perfil = await getMe(db, eu);

    expect(await publicar()).toMatchObject({ ok: false, status: 403 });
    // A missão pontuou do mesmo jeito: a foto é bônus, nunca a nota.
    expect(perfil.xp).toBeGreaterThan(0);
    expect(perfil.history[0]).toMatchObject({ status: "COMPLETED" });
  });

  it("retirar a autorização depois impede publicações novas", async () => {
    await cumprirMissao();
    expect((await publicar()).ok).toBe(true);

    await revokeGuardianConsent(db, IDS.student, "uso_de_imagem");
    const outraExecucao = await cumprirMissao("d1000000-0000-4000-8000-000000000003", "d1000000-0000-4000-8000-000000000004");
    expect(await publicar(outraExecucao)).toMatchObject({ ok: false, status: 403 });
  });
});

describe("curtida é reconhecimento, não moeda", () => {
  it("curtir e descurtir, uma por pessoa", async () => {
    await cumprirMissao();
    const post = await publicar();
    if (!post.ok) throw new Error(post.message);

    expect(await toggleLike(db, outro, post.value.postId)).toMatchObject({ ok: true, value: { likes: 1, likedByMe: true } });
    expect(await toggleLike(db, outro, post.value.postId)).toMatchObject({ ok: true, value: { likes: 0, likedByMe: false } });
  });

  it("curtida NÃO dá XP — nem para quem curte, nem para quem publicou", async () => {
    await cumprirMissao();
    const post = await publicar();
    if (!post.ok) throw new Error(post.message);

    const autorAntes = (await getMe(db, eu)).xp;
    const curtidorAntes = (await getMe(db, outro)).xp;
    await toggleLike(db, outro, post.value.postId);

    expect((await getMe(db, eu)).xp).toBe(autorAntes);
    expect((await getMe(db, outro)).xp).toBe(curtidorAntes);
  });
});

describe("o mural", () => {
  it("mostra a publicação com missão, litros medidos e autor", async () => {
    await cumprirMissao();
    await publicar();

    const mural = await listWall(db, outro);
    expect(mural).toHaveLength(1);
    expect(mural[0]).toMatchObject({
      mission: { id: "regar-jardim" },
      collectorCode: "ECO-001",
      likes: 0,
      likedByMe: false,
    });
    expect(mural[0]!.deliveredLiters).toBeCloseTo(3, 2);
    expect(mural[0]!.author.isMe).toBe(false);
    expect(mural[0]!.caption).toBe("Reguei os canteiros da horta");
  });

  it("quem publicou se reconhece na própria publicação", async () => {
    await cumprirMissao();
    await publicar();
    expect((await listWall(db, eu))[0]!.author.isMe).toBe(true);
    expect(await listMyPosts(db, eu)).toHaveLength(1);
    expect(await listMyPosts(db, outro)).toHaveLength(0);
  });
});

describe("denúncia tira do ar antes de alguém analisar", () => {
  it("some do mural na hora", async () => {
    await cumprirMissao();
    const post = await publicar();
    if (!post.ok) throw new Error(post.message);

    expect(await reportPost(db, outro, post.value.postId, "Foto fora do contexto da missão")).toMatchObject({ ok: true });
    expect(await listWall(db, outro)).toHaveLength(0);

    const { rows } = await db.query<{ hidden_reason: string | null }>(
      "select hidden_reason from public.mission_posts where id = $1",
      [post.value.postId],
    );
    expect(rows[0]!.hidden_reason).toBeTruthy();
  });

  it("uma denúncia por pessoa", async () => {
    await cumprirMissao();
    const post = await publicar();
    if (!post.ok) throw new Error(post.message);
    await reportPost(db, outro, post.value.postId, "Fora de contexto");
    expect(await reportPost(db, outro, post.value.postId, "Fora de contexto")).toMatchObject({ ok: false, status: 409 });
  });

  it("motivo vazio não é denúncia", async () => {
    await cumprirMissao();
    const post = await publicar();
    if (!post.ok) throw new Error(post.message);
    expect(await reportPost(db, outro, post.value.postId, " ")).toMatchObject({ ok: false, status: 422 });
  });
});

describe("apagar a própria publicação", () => {
  it("sai do mural; a missão e a pontuação ficam", async () => {
    await cumprirMissao();
    const post = await publicar();
    if (!post.ok) throw new Error(post.message);
    const xp = (await getMe(db, eu)).xp;

    expect(await deletePost(db, eu, post.value.postId)).toMatchObject({ ok: true });
    expect(await listWall(db, eu)).toHaveLength(0);
    // A missão aconteceu: a água saiu e o sensor mediu. Isso não se apaga.
    expect((await getMe(db, eu)).history[0]).toMatchObject({ status: "COMPLETED" });
    expect((await getMe(db, eu)).xp).toBe(xp);
  });

  it("ninguém apaga a publicação de outra pessoa", async () => {
    await cumprirMissao();
    const post = await publicar();
    if (!post.ok) throw new Error(post.message);
    expect(await deletePost(db, outro, post.value.postId)).toMatchObject({ ok: false, status: 404 });
  });
});
