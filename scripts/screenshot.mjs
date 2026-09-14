// Captura telas em tamanhos de celular para revisão visual.
// Requer o servidor rodando (npm run dev) e Microsoft Edge ou Chrome instalado.
//
// Uso:
//   npm run screenshot -- / /design
//   npm run screenshot -- /agua --wait=3000 --full --widths=390
//   npm run screenshot -- /missoes --click="[data-testid=mission-card]" --wait=800
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
const clicks = flags.click ? flags.click.split(";;") : [];

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

      await page.goto(baseUrl + route, { waitUntil: "load" });
      await page.waitForTimeout(waitMs);
      for (const selector of clicks) {
        await page.locator(selector).first().click();
        await page.waitForTimeout(waitMs);
      }

      const slug = route === "/" ? "home" : route.replace(/^\//, "").replaceAll("/", "_");
      const suffix = flags.name ? `-${flags.name}` : "";
      const file = `${outDir}/${slug}${suffix}-${width}.png`;
      await page.screenshot({ path: file, fullPage: flags.full === "true" });
      console.log(`${file}  ${errors.length ? `ERROS: ${errors.join(" | ")}` : "ok"}`);
      await context.close();
    }
  }
} finally {
  await browser.close();
}
