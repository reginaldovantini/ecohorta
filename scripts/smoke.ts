/*
 * Teste de ponta a ponta da API — local ou na URL pública.
 *
 *   npm run smoke                                   (http://localhost:3000)
 *   SMOKE_BASE_URL=https://<app>.vercel.app npm run smoke
 *
 * Requer (.env.local): SMOKE_STUDENT_CODE, SMOKE_STUDENT_PIN, SMOKE_TEACHER_EMAIL,
 * SMOKE_TEACHER_PASSWORD e o dispositivo virtual enviando telemetria para a MESMA URL.
 * Executa missões reais na SIMULAÇÃO (1 L cada) e confere XP e histórico no servidor.
 */
import { randomUUID } from "node:crypto";
import type { CollectorSnapshot, DispenseProgress } from "@/lib/iot/types";

try {
  process.loadEnvFile(".env.local");
} catch {
  // Variáveis podem vir do ambiente.
}

const BASE = (process.env.SMOKE_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const TERMINAL = new Set(["COMPLETED", "FAILED", "CANCELLED"]);
const MISSION = { id: "hidratar-mudas", liters: 1, xp: 20 };

function required(name: string) {
  const value = process.env[name];
  if (!value) {
    console.error(`Defina ${name} no .env.local.`);
    process.exit(2);
  }
  return value;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let failures = 0;

function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "\x1b[32m✔\x1b[0m" : "\x1b[31m✘\x1b[0m"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

interface Reply<T> {
  status: number;
  body: T;
}

/** Cliente HTTP com cookies (sessão do Supabase em cookies httpOnly). */
class Session {
  private cookies = new Map<string, string>();

  async call<T = Record<string, unknown>>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Reply<T>> {
    const response = await fetch(BASE + path, {
      method,
      redirect: "manual",
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(this.cookies.size > 0 ? { Cookie: [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ") } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const raw of response.headers.getSetCookie()) {
      const pair = raw.split(";")[0] ?? "";
      const index = pair.indexOf("=");
      const name = pair.slice(0, index);
      const value = pair.slice(index + 1);
      if (!value || /max-age=0/i.test(raw)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    return { status: response.status, body: (await response.json().catch(() => ({}))) as T };
  }
}

async function waitForTerminal(session: Session, code: string, commandId: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const reply = await session.call<DispenseProgress>("GET", `/api/collectors/${code}/commands/${commandId}`);
    if (reply.status === 200 && TERMINAL.has(reply.body.status)) return reply.body;
    await sleep(1000);
  }
  return null;
}

async function main() {
  const student = { code: required("SMOKE_STUDENT_CODE"), pin: required("SMOKE_STUDENT_PIN") };
  const teacher = { email: required("SMOKE_TEACHER_EMAIL"), password: required("SMOKE_TEACHER_PASSWORD") };
  console.log(`Teste de API em ${BASE}\n`);

  // ---------- Sem sessão ----------
  const anon = new Session();
  const fakeId = randomUUID();
  check("GET /api/collectors sem login → 401", (await anon.call("GET", "/api/collectors")).status === 401);
  check("GET /api/me sem login → 401", (await anon.call("GET", "/api/me")).status === 401);
  check(
    "POST commands sem login → 401",
    (await anon.call("POST", "/api/collectors/EC-001/commands", { command_id: fakeId, execution_id: randomUUID(), mission_id: MISSION.id })).status === 401,
  );
  check("POST cancel sem login → 401", (await anon.call("POST", `/api/collectors/EC-001/commands/${fakeId}/cancel`)).status === 401);
  check("POST simulation sem login → 401", (await anon.call("POST", "/api/collectors/EC-001/simulation", { settings: { timeScale: 1 } })).status === 401);
  check(
    "Telemetria com token inválido → 401",
    (await anon.call("POST", "/api/iot/telemetry", { device_id: "VIRTUAL-001", collector_code: "EC-001" }, { Authorization: "Bearer token-invalido" })).status === 401,
  );
  check("Canal da simulação com token inválido → 401", (await anon.call("GET", "/api/iot/simulation?device_id=VIRTUAL-001", undefined, { Authorization: "Bearer x" })).status === 401);
  check("Login do estudante com PIN errado → 401", (await anon.call("POST", "/api/auth/student", { code: student.code, pin: "000000" })).status === 401);
  check("Estudante no login de e-mail → 401", (await anon.call("POST", "/api/auth/login", { email: "ninguem@exemplo.invalid", password: "x" })).status === 401);

  // ---------- Estudante ----------
  const me = new Session();
  const login = await me.call("POST", "/api/auth/student", student);
  check("Login do estudante (código + PIN)", login.status === 200, `HTTP ${login.status}`);
  if (login.status !== 200) return;

  const profile = await me.call<{ role: string; xp: number; history: { executionId: string }[]; identity: unknown }>("GET", "/api/me");
  check("GET /api/me do estudante", profile.status === 200 && profile.body.role === "student", `XP ${profile.body.xp}`);
  check("Perfil não expõe dados cadastrais", !/first_name|last_name|birth|access_code/i.test(JSON.stringify(profile.body)));
  const xpBefore = profile.body.xp;

  const list = await me.call<{ collectors: { code: string }[] }>("GET", "/api/collectors");
  const code = list.body.collectors?.[0]?.code;
  check("Lista de captadores da escola", list.status === 200 && Boolean(code), code);
  if (!code) return;

  check("Estudante não controla a simulação → 403", (await me.call("POST", `/api/collectors/${code}/simulation`, { settings: { timeScale: 1 } })).status === 403);

  const snapshot = await me.call<CollectorSnapshot>("GET", `/api/collectors/${code}`);
  const telemetry = snapshot.body.telemetry;
  check(
    "Captador conectado (dispositivo virtual enviando telemetria)",
    snapshot.status === 200 && telemetry.status !== "OFFLINE",
    `${telemetry?.status} · ${telemetry?.volumeLiters} L · origem ${telemetry?.origin}`,
  );
  if (telemetry?.status === "OFFLINE") {
    console.log("\nInicie o dispositivo virtual apontando para esta URL: ECOHORTA_API_URL=" + BASE + " npm run device:virtual");
    return;
  }

  // ---------- Professor ----------
  const prof = new Session();
  const teacherLogin = await prof.call("POST", "/api/auth/login", teacher);
  check("Login do professor (e-mail + senha)", teacherLogin.status === 200, `HTTP ${teacherLogin.status}`);

  if (snapshot.body.simulation) {
    const free = telemetry.volumeLiters - snapshot.body.info.reserveLiters;
    if (free < MISSION.liters * 2 + 0.5) {
      const refill = await prof.call("POST", `/api/collectors/${code}/simulation`, { action: { type: "set_level", ratio: 0.6 } });
      check("Professor ajusta o nível da simulação para o teste", refill.status === 200);
      await sleep(8000);
    } else {
      const same = await prof.call("POST", `/api/collectors/${code}/simulation`, { settings: { timeScale: snapshot.body.simulation.timeScale } });
      check("Professor controla a simulação → 200", same.status === 200);
    }
  }

  // ---------- Missão completa ----------
  const commandId = randomUUID();
  const executionId = randomUUID();
  const request = { command_id: commandId, execution_id: executionId, mission_id: MISSION.id, target_liters: 50 };
  const created = await me.call<DispenseProgress>("POST", `/api/collectors/${code}/commands`, request);
  check("Pedido de liberação → 201 QUEUED", created.status === 201 && created.body.status === "QUEUED", `${created.status} ${created.body.status ?? JSON.stringify(created.body)}`);
  check("Volume definido pelo servidor (ignora 50 L do navegador)", created.body.targetLiters === MISSION.liters, `${created.body.targetLiters} L`);
  const again = await me.call<DispenseProgress>("POST", `/api/collectors/${code}/commands`, request);
  check("Reenvio idempotente (mesmo command_id)", again.status === 201 && again.body.commandId === commandId);
  check("Professor acompanha o comando do estudante", (await prof.call("GET", `/api/collectors/${code}/commands/${commandId}`)).status === 200);

  const finished = await waitForTerminal(me, code, commandId, 300_000);
  check("Missão concluída com volume medido", finished?.status === "COMPLETED", finished ? `${finished.status} · ${finished.deliveredLiters} L medidos` : "tempo esgotado");

  const after = await me.call<{ xp: number; history: { executionId: string; xpAwarded: number }[] }>("GET", "/api/me");
  const record = after.body.history.find((item) => item.executionId === executionId);
  check("XP concedido pelo servidor", after.body.xp === xpBefore + MISSION.xp, `${xpBefore} → ${after.body.xp}`);
  check("Execução registrada no histórico", record?.xpAwarded === MISSION.xp);

  // ---------- Ocupado + cancelamento ----------
  const first = randomUUID();
  await me.call("POST", `/api/collectors/${code}/commands`, { command_id: first, execution_id: randomUUID(), mission_id: MISSION.id });
  const busy = await me.call<DispenseProgress>("POST", `/api/collectors/${code}/commands`, { command_id: randomUUID(), execution_id: randomUUID(), mission_id: MISSION.id });
  check("Segunda liberação simultânea → DEVICE_BUSY", busy.body.failure === "DEVICE_BUSY", `${busy.body.status} ${busy.body.failure}`);
  const cancel = await me.call<DispenseProgress>("POST", `/api/collectors/${code}/commands/${first}/cancel`);
  check("Cancelamento aceito", cancel.status === 200);
  const cancelled = await waitForTerminal(me, code, first, 120_000);
  check("Missão cancelada", cancelled?.status === "CANCELLED", cancelled ? `${cancelled.status} · ${cancelled.deliveredLiters} L` : "tempo esgotado");
  const afterCancel = await me.call<{ xp: number }>("GET", "/api/me");
  check("Cancelamento não concede XP", afterCancel.body.xp === after.body.xp);

  // ---------- Sessão ----------
  await me.call("POST", "/api/auth/logout");
  check("Logout encerra a sessão", (await me.call("GET", "/api/me")).status === 401);
  await prof.call("POST", "/api/auth/logout");
}

main()
  .catch((error: unknown) => {
    console.error(error);
    failures++;
  })
  .finally(() => {
    console.log(failures === 0 ? "\nTodos os testes passaram." : `\n${failures} verificação(ões) falharam.`);
    process.exit(failures === 0 ? 0 : 1);
  });
