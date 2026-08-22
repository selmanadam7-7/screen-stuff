/**
 * Exact hexes, unquantised, grouped by hue family. Quantisation was fine for
 * finding *where* the colours live; picking the actual token values needs the
 * real pixel.
 */
import sharp from "file:///C:/Users/kong1/BroFoam-Website/node_modules/sharp/lib/index.js";
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DIR = process.argv[2] ?? "D:/Screen share app/10 pics";
const files = readdirSync(DIR).filter((f) => f.endsWith(".png") && f.startsWith("product-page"));

const hex = (r, g, b) =>
  "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();

function hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2, d = max - min;
  if (d === 0) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h * 360, s, l];
}

const FAMILIES = [
  { name: "primary blue", hue: [205, 230], sat: 0.6, light: [0.35, 0.62] },
  { name: "blue tint", hue: [200, 235], sat: 0.3, light: [0.85, 0.97] },
  { name: "green / success", hue: [130, 175], sat: 0.3, light: [0.3, 0.75] },
  { name: "amber / warning", hue: [30, 55], sat: 0.5, light: [0.4, 0.75] },
  { name: "red / danger", hue: [350, 372], sat: 0.5, light: [0.4, 0.72] },
  { name: "purple", hue: [245, 285], sat: 0.4, light: [0.4, 0.75] },
  { name: "teal", hue: [165, 200], sat: 0.4, light: [0.35, 0.7] },
  { name: "yellow note", hue: [40, 60], sat: 0.5, light: [0.75, 0.95] },
];

const buckets = new Map(FAMILIES.map((f) => [f.name, new Map()]));
const greys = new Map();

for (const file of files) {
  const { data, info } = await sharp(join(DIR, file)).raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += info.channels) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    let [h, s, l] = hsl(r, g, b);
    const key = hex(r, g, b);
    if (s < 0.18 && l < 0.72) {
      greys.set(key, (greys.get(key) ?? 0) + 1);
      continue;
    }
    if (s < 0.12) continue;
    for (const f of FAMILIES) {
      const hh = h < f.hue[0] && f.hue[1] > 360 ? h + 360 : h;
      if (hh >= f.hue[0] && hh <= f.hue[1] && s >= f.sat && l >= f.light[0] && l <= f.light[1]) {
        const m = buckets.get(f.name);
        m.set(key, (m.get(key) ?? 0) + 1);
      }
    }
  }
}

const result = {};
for (const [name, m] of buckets) {
  const top = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  result[name] = top.map(([k, n]) => ({ hex: k, n }));
  console.log(`${name.padEnd(16)} ${top.map(([k, n]) => `${k} (${n})`).join("  ")}`);
}
const topGreys = [...greys.entries()].sort((a, b) => b[1] - a[1]).slice(0, 22);
result.greys = topGreys.map(([k, n]) => ({ hex: k, n }));
console.log(`\ngreys/neutrals  ${topGreys.map(([k]) => k).join("  ")}`);

writeFileSync("design/exact.json", JSON.stringify(result, null, 2));
