// Captura telas em tamanhos de celular para revisão visual.
// Requer o servidor rodando (npm run dev) e Microsoft Edge ou Chrome instalado.
//
// Uso:
//   npm run screenshot -- / /design
//   npm run screenshot -- /agua --wait=3000 --full --widths=390
//
// Sequências (--steps), separadas por ";;":
//   click:SELETOR   toca no elemento
//   hold:SELETOR    pressiona e segura (1,5 s) — confirmação da válvula
//   key:TECLA       pressiona uma tecla (ex.: Escape)
//   wait:MS         espera
//   shot:NOME       captura a tela com o sufixo NOME
//
//   npm run screenshot -- /missoes --widths=390 --steps="click:[data-testid=mission-card] button;;shot:aberto"
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";

const args = process.argv.slice(2);
const flags = Object.fromEntries(
  args
    .filter((arg) => arg.startsWith("--"))
    .map((arg) => {
      const [key, ...rest] = arg.slice(2).split("=");
      return [key, rest.length ? rest.join("=") : "true"];
    }),
);
const routes = args.filter((arg) => !arg.startsWith("--"));

const baseUrl = flags.base ?? "http://localhost:3000";
const waitMs = Number(flags.wait ?? 1500);
const widths = (flags.widths ?? "360,390,412").split(",").map(Number);
const heights = { 360: 800, 390: 844, 412: 915 };
const outDir = flags.out ?? ".screenshots";
const fullPage = flags.full === "true";

const steps = [
  ...(flags.click ? flags.click.split(";;").map((selector) => ["click", selector]) : []),
  ...(flags.steps
    ? flags.steps.split(";;").map((step) => {
        const index = step.indexOf(":");
        return [step.slice(0, index), step.slice(index + 1)];
      })
    : []),
];
const hasShots = steps.some(([action]) => action === "shot");

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({ channel: flags.channel ?? "msedge" });

try {
  for (const route of routes.length ? routes : ["/"]) {
    for (const width of widths) {
      const context = await browser.newContext({
        viewport: { width, height: heights[width] ?? 844 },
        deviceScaleFactor: 1,
        isMobile: true,
        hasTouch: true,
        colorScheme: "dark",
        locale: "pt-BR",
      });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });

      const slug = route === "/" ? "home" : route.replace(/^\//, "").replaceAll("/", "_");
      const suffix = flags.name ? `-${flags.name}` : "";
      const capture = async (name) => {
        const file = `${outDir}/${slug}${suffix}${name ? `-${name}` : ""}-${width}.png`;
        await page.screenshot({ path: file, fullPage });
        console.log(`${file}  ${errors.length ? `ERROS: ${errors.join(" | ")}` : "ok"}`);
      };

      await page.goto(baseUrl + route, { waitUntil: "load" });
      await page.waitForTimeout(waitMs);

      for (const [action, value] of steps) {
        if (action === "click") {
          await page.locator(value).first().click();
          await page.waitForTimeout(500);
        } else if (action === "hold") {
          const target = page.locator(value).first();
          await target.scrollIntoViewIfNeeded();
          const box = await target.boundingBox();
          if (!box) throw new Error(`Elemento não visível: ${value}`);
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          await page.mouse.down();
          await page.waitForTimeout(1500);
          await page.mouse.up();
        } else if (action === "key") {
          await page.keyboard.press(value);
          await page.waitForTimeout(400);
        } else if (action === "wait") {
          await page.waitForTimeout(Number(value));
        } else if (action === "shot") {
          await capture(value);
        } else {
          throw new Error(`Passo desconhecido: ${action}`);
        }
      }

      if (!hasShots) await capture("");
      await context.close();
    }
  }
} finally {
  await browser.close();
}
