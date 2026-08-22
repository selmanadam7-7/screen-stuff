/**
 * The greys dominate any screenshot by area, so a plain frequency count hides
 * the colours that actually define a design system. This ranks by saturation:
 * the primary, the semantic states, and the avatar palette.
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
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h * 360, s, l];
}

const global = new Map();

for (const file of files) {
  const { data, info } = await sharp(join(DIR, file)).raw().toBuffer({ resolveWithObject: true });
  const counts = new Map();
  for (let i = 0; i < data.length; i += info.channels * 2) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const [h, s, l] = hsl(r, g, b);
    // Only colours a designer would have chosen on purpose.
    if (s < 0.45 || l < 0.22 || l > 0.85) continue;
    const key = `${r >> 3 << 3},${g >> 3 << 3},${b >> 3 << 3}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    global.set(key, (global.get(key) ?? 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  console.log(`\n${file}`);
  console.log(
    top
      .map(([k, n]) => {
        const [r, g, b] = k.split(",").map(Number);
        const [h] = hsl(r, g, b);
        return `${hex(r, g, b)} h${Math.round(h)} (${n})`;
      })
      .join("  "),
  );
}

console.log("\n=== ACROSS ALL PRODUCT PAGES ===");
const ranked = [...global.entries()].sort((a, b) => b[1] - a[1]).slice(0, 26);
const out = ranked.map(([k, n]) => {
  const [r, g, b] = k.split(",").map(Number);
  const [h, s, l] = hsl(r, g, b);
  return { hex: hex(r, g, b), hue: Math.round(h), sat: +s.toFixed(2), light: +l.toFixed(2), n };
});
for (const c of out) {
  console.log(`${c.hex}  hue ${String(c.hue).padStart(3)}  sat ${c.sat}  light ${c.light}   ${c.n}`);
}
writeFileSync("design/accents.json", JSON.stringify(out, null, 2));
