// Sobe a plataforma (next dev) e o dispositivo virtual EC-001 juntos.
// Gera um token aleatório para o dispositivo a cada execução — nenhuma credencial no código.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

const token = process.env.IOT_SIMULATED_DEVICE_TOKEN || randomBytes(24).toString("hex");
const env = { ...process.env, IOT_SIMULATED_DEVICE_TOKEN: token };
const isWindows = process.platform === "win32";
const children = [];
let stopping = false;

function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode !== null) continue;
    if (isWindows) spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    else child.kill("SIGTERM");
  }
  setTimeout(() => process.exit(code), 500);
}

function run(name, args) {
  // No Windows o npx precisa do shell; o comando vai como texto único (argumentos fixos, sem entrada do usuário).
  const child = isWindows
    ? spawn(`npx ${args.join(" ")}`, { env, stdio: "inherit", shell: true })
    : spawn("npx", args, { env, stdio: "inherit" });
  child.on("exit", (code) => {
    if (!stopping) {
      console.log(`[dev] ${name} encerrou (código ${code ?? 0}).`);
      stop(code ?? 0);
    }
  });
  children.push(child);
}

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));

run("plataforma", ["next", "dev", ...process.argv.slice(2)]);
// `tsx watch` reinicia o dispositivo quando o firmware virtual é alterado.
run("dispositivo virtual", ["tsx", "watch", "--clear-screen=false", "tools/virtual-device/run.ts"]);
