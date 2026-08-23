// Records the README's hero: the app doing the thing it is for, in ten seconds.
//
// Scripted rather than hand-recorded so it can be regenerated whenever the
// interface changes — a hero that is three redesigns out of date is worse than
// none, and the only way that does not happen is if remaking it is one command.
//
//   pnpm hero            # against a dev server on 4483
//   node scripts/record-hero.mjs http://localhost:4483
import { chromium } from "file:///C:/Users/kong1/adgap/node_modules/playwright/index.mjs";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "assets", "brand", "hero");
const base = process.argv[2] ?? "http://localhost:4483";

// 16:9 and not enormous: this ends up in a README, where a 4K capture is a
// several-megabyte download that renders at 800px anyway.
const WIDTH = 1280;
const HEIGHT = 720;

mkdirSync(OUT, { recursive: true });
const raw = join(OUT, ".raw");
rmSync(raw, { recursive: true, force: true });
mkdirSync(raw, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: WIDTH, height: HEIGHT },
  recordVideo: { dir: raw, size: { width: WIDTH, height: HEIGHT } },
});
const page = await context.newPage();

const beat = (ms) => page.waitForTimeout(ms);
const act = (body) =>
  page.evaluate((source) => new Function("store", source)(window.__screenStuffStore.getState()), body);

await page.goto(`${base}/?demo`, { waitUntil: "networkidle" });
await page.waitForFunction(() => "__screenStuffStore" in window, null, { timeout: 20000 });
// Out of the way: the pitch is the product, not a panel explaining it.
await page.evaluate(() => {
  document.querySelector(".demo-banner__head .icon-btn")?.dispatchEvent(
    new MouseEvent("click", { bubbles: true }),
  );
});
await beat(1400);

// 1. Everything you have, on one board.
await act("store.fitEverything();");
await beat(1800);

// 2. And only this rectangle is shared.
await act("store.showStage();");
await beat(1600);

// 3. Rearrange the shot in one click.
await act("store.applyLayout('pip');");
await beat(1500);
await act("store.applyLayout('focus');");
await beat(1400);

// 4. Set the next shot up where nobody can see it, then cut to it.
await act("store.openPreview();");
await beat(900);
await act(
  "const t = store.doc.tiles.find(x => x.kind === 'source');" +
    "if (t) store.setPreview({ x: t.x - 40, y: t.y - 40, w: t.w + 80, h: (t.w + 80) / store.doc.aspect });",
);
await beat(1500);
await act("store.take();");
await beat(1800);

// 5. Hold the shot, because every call needs to.
await act("store.raisePreset('brb');");
await beat(1700);
await act("store.showCard(null); store.showStage();");
await beat(1400);

await context.close();
await browser.close();

// Playwright names the file after the page; there is exactly one.
const webm = readdirSync(raw).find((f) => f.endsWith(".webm"));
if (!webm) {
  console.error("no recording was produced");
  process.exit(1);
}
const source = join(raw, webm);

const mp4 = join(OUT, "hero.mp4");
const gif = join(OUT, "hero.gif");
const still = join(OUT, "hero.png");

function ffmpeg(args) {
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args], { stdio: "inherit" });
}

// mp4 for anywhere that plays video, gif because a README rendered on GitHub
// will not play a video from a repo path.
ffmpeg(["-i", source, "-movflags", "+faststart", "-pix_fmt", "yuv420p", "-crf", "26", mp4]);
ffmpeg(["-i", source, "-vf", "select=eq(n\\,30)", "-frames:v", "1", still]);

// The GIF is the one that goes in the README, and a README is a page people
// wait for. Trimmed to the first beats, 10fps, 860 wide -- the full sequence
// stays in the mp4 for anywhere that can play one.
const GIF_SECONDS = 11;
const palette = join(raw, "palette.png");
// Two passes: a palette from the clip, then the encode against it. One-pass
// GIF from a screen recording bands the flat interface greys badly.
const filters = "fps=10,scale=760:-1:flags=lanczos";
ffmpeg(["-t", String(GIF_SECONDS), "-i", source, "-vf", `${filters},palettegen=stats_mode=diff`, palette]);
ffmpeg([
  "-t",
  String(GIF_SECONDS),
  "-i",
  source,
  "-i",
  palette,
  "-lavfi",
  `${filters}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3`,
  gif,
]);

rmSync(raw, { recursive: true, force: true });

for (const file of [mp4, gif, still]) {
  if (!existsSync(file)) {
    console.error(`missing ${file}`);
    process.exit(1);
  }
}
for (const file of [gif, mp4, still]) {
  const kb = Math.round(statSync(file).size / 1024);
  console.log(`  ${String(kb).padStart(5)} KB  ${file.replace(ROOT, ".")}`);
}
if (statSync(gif).size > 3 * 1024 * 1024) {
  console.error("the GIF is over 3 MB - a README should not be that heavy");
  process.exit(1);
}
console.log("hero written to assets/brand/hero");
