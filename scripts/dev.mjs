// Sobe a plataforma (next dev) e o dispositivo virtual (captador SIM-001) juntos.
// Credenciais vêm do .env.local (o token do dispositivo é gerado por `npm run db:seed`) — nenhuma no código.
import { spawn } from "node:child_process";

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
    ? spawn(`npx ${args.join(" ")}`, { stdio: "inherit", shell: true })
    : spawn("npx", args, { stdio: "inherit" });
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
