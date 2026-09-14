// Gera os ícones PNG do PWA a partir de src/app/icon.svg.
// Uso: npm run icons
import { mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = new URL("../", import.meta.url);
const svg = await readFile(new URL("src/app/icon.svg", root), "utf8");
// Ícones "maskable" e da Apple precisam de fundo sem cantos arredondados:
// o próprio sistema aplica a máscara.
const fullBleedSvg = svg.replaceAll('rx="112"', 'rx="0"');

const outputs = [
  { file: "public/icons/icon-192.png", size: 192, source: svg },
  { file: "public/icons/icon-512.png", size: 512, source: svg },
  { file: "public/icons/icon-maskable-512.png", size: 512, source: fullBleedSvg },
  { file: "src/app/apple-icon.png", size: 180, source: fullBleedSvg },
];

await mkdir(new URL("public/icons/", root), { recursive: true });

for (const { file, size, source } of outputs) {
  await sharp(Buffer.from(source), { density: 384 })
    .resize(size, size)
    .png()
    .toFile(fileURLToPath(new URL(file, root)));
  console.log(`✓ ${file} (${size}px)`);
}
