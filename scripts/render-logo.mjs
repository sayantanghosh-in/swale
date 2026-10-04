/**
 * Renders the PNG copies of the logo from their SVG sources.
 *
 * Headless Chrome rather than a dedicated rasteriser: it is already on every
 * machine this is developed on, and it renders the same font stack the SVG
 * asks for. Only needed when the SVG changes.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const CHROME =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

if (!existsSync(CHROME)) {
  console.error(`No Chrome at ${CHROME}. Set CHROME_PATH and try again.`);
  process.exit(1);
}

const targets = [
  { name: "logo", width: 1460, height: 340 },
  { name: "mark", width: 512, height: 512 },
];

for (const { name, width, height } of targets) {
  const svg = path.resolve(`docs/images/${name}.svg`);
  const png = path.resolve(`docs/images/${name}.png`);
  const result = spawnSync(CHROME, [
    "--headless",
    "--disable-gpu",
    "--hide-scrollbars",
    `--screenshot=${png}`,
    `--window-size=${width},${height}`,
    "--default-background-color=00000000",
    `file://${svg}`,
  ]);
  if (result.status !== 0) {
    console.error(`Failed to render ${name}.png`);
    process.exit(1);
  }
  console.log(`docs/images/${name}.png`);
}
