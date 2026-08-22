/**
 * Pulls the real palette out of the reference screenshots.
 *
 * Eyeballing a hex from a screenshot is how you end up two shades off across
 * forty components. This counts actual pixels and reports what the design
 * system is really made of.
 */
import sharp from "file:///C:/Users/kong1/BroFoam-Website/node_modules/sharp/lib/index.js";
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DIR = process.argv[2] ?? "D:/Screen share app/10 pics";
const files = readdirSync(DIR).filter((f) => f.endsWith(".png"));

const hex = (r, g, b) =>
  "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();

const report = {};

for (const file of files) {
  const { data, info } = await sharp(join(DIR, file))
    .raw()
    .toBuffer({ resolveWithObject: true });

  const counts = new Map();
  const channels = info.channels;
  for (let i = 0; i < data.length; i += channels * 4) {
    // Quantise slightly so anti-aliasing does not shatter every colour.
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const key = `${r >> 2 << 2},${g >> 2 << 2},${b >> 2 << 2}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 14)
    .map(([key, n]) => {
      const [r, g, b] = key.split(",").map(Number);
      return { hex: hex(r, g, b), share: +((n / total) * 100).toFixed(2) };
    });

  report[file] = { size: `${info.width}x${info.height}`, top };
  console.log(`\n${file}  (${info.width}x${info.height})`);
  console.log(top.map((c) => `${c.hex} ${String(c.share).padStart(5)}%`).join("   "));
}

writeFileSync("design/palette-report.json", JSON.stringify(report, null, 2));
