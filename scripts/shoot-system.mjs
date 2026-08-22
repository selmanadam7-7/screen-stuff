// Captures the whole design system in one pass: every look, every page, every
// modal. Reviewing a redesign one screenshot at a time is how inconsistencies
// survive.
import { chromium } from "file:///C:/Users/kong1/adgap/node_modules/playwright/index.mjs";
import { mkdirSync } from "node:fs";

const [stream, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
});
const context = await browser.newContext({
  viewport: { width: 1520, height: 980 },
  permissions: ["camera"],
});
const page = await context.newPage();
const problems = [];
page.on("console", (m) => m.type() === "error" && problems.push(m.text()));
page.on("pageerror", (e) => problems.push(String(e)));

await page.goto(`http://localhost:4483/?stream=${encodeURIComponent(stream)}`, {
  waitUntil: "networkidle",
});
await page.waitForFunction(() => "__screenDropStore" in window, null, { timeout: 20000 });

// Build a board worth photographing.
await page.evaluate(async () => {
  const useStore = window.__screenDropStore;
  const store = useStore.getState();
  const monitors = Array.from({ length: 4 }, (_, i) => ({
    id: `monitor:${i + 1}`,
    kind: "monitor",
    title: `Display ${i + 1}`,
    subtitle: "2560 × 1440 @ 165Hz",
    width: 2560,
    height: 1440,
    x: 0,
    y: 0,
    isPrimary: i === 0,
  }));
  const windows = ["Claude Code", "Discord", "Figma — Q2 Roadmap", "Chrome — Analytics"].map(
    (title, i) => ({
      id: `monitor:${(i % 4) + 1}`,
      kind: "window",
      title,
      subtitle: `1920 × 1080`,
      width: 1920,
      height: 1080,
      x: 0,
      y: 0,
      isPrimary: false,
    }),
  );
  // The offline source list the api layer serves, so refreshes keep working.
  window.__screenDropSources = [...monitors, ...windows];
  useStore.setState({ sources: [...monitors, ...windows], monitors });
  store.setBoardProp({ name: "Discovery call" });
  store.addSources(monitors.map((m) => m.id));
  store.addNote("Their site, their ads, and the mockup — all in one shot.");
  store.saveScene("Four up");
  store.fitEverything();
  store.select([]);
  await new Promise((r) => setTimeout(r, 4000));
});

const shot = async (name, ms = 900) => {
  await page.waitForTimeout(ms);
  await page.screenshot({ path: `${outDir}/sys-${name}.png` });
};

const setLook = async (look) => {
  await page.evaluate((l) => window.__screenDropStore.getState().setLook(l), look);
  await page.waitForTimeout(700);
};

// --- the five looks -------------------------------------------------------
for (const look of ["pure-white", "liquid-glass", "arctic-blue", "graphite-dark", "spectrum-pro"]) {
  await setLook(look);
  await shot(`look-${look}`, 1200);
}
await setLook("pure-white");

// --- a tile selected, so the inspector is full ----------------------------
await page.evaluate(() => {
  const useStore = window.__screenDropStore;
  const tile = useStore.getState().doc.tiles.find((t) => t.kind === "source");
  useStore.getState().select([tile.id]);
});
await shot("inspector-tile");

// --- pages ----------------------------------------------------------------
for (const panel of ["boards", "media", "settings"]) {
  await page.evaluate((p) => window.__screenDropStore.getState().setPanel(p), panel);
  await shot(`page-${panel}`);
}
await page.evaluate(() => window.__screenDropStore.getState().setPanel("board"));

// --- modals ---------------------------------------------------------------
await page.click('[aria-label="Add a screen"]');
await shot("modal-add-screens", 2600);
await page.keyboard.press("Escape");

await page.click("text=Share");
await shot("modal-share", 900);
await page.keyboard.press("Escape");

// --- dark, with a tile selected -------------------------------------------
await setLook("graphite-dark");
await page.evaluate(() => {
  const useStore = window.__screenDropStore;
  const tile = useStore.getState().doc.tiles.find((t) => t.kind === "source");
  useStore.getState().select([tile.id]);
});
await shot("dark-inspector", 1300);

console.log(JSON.stringify({ problems, outDir }, null, 2));
await browser.close();
process.exit(problems.length ? 1 : 0);
