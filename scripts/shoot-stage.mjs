// Screenshots the stage in every state worth reviewing, in one pass.
//
//   node scripts/shoot-stage.mjs <out-dir> [http://localhost:4483]
import { chromium } from "file:///C:/Users/kong1/adgap/node_modules/playwright/index.mjs";

const [outDir, base = "http://localhost:4483"] = process.argv.slice(2);
if (!outDir) {
  console.error("usage: node scripts/shoot-stage.mjs <out-dir> [base-url]");
  process.exit(2);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1520, height: 980 } });
const problems = [];
page.on("console", (m) => m.type() === "error" && problems.push(m.text()));
page.on("pageerror", (e) => problems.push(String(e)));

await page.goto(base, { waitUntil: "networkidle" });
await page.waitForFunction(() => "__screenDropStore" in window, null, { timeout: 15000 });

const run = (fn, arg) => page.evaluate(fn, arg);
const shot = async (name, wait = 500) => {
  await page.waitForTimeout(wait);
  await page.screenshot({ path: `${outDir}/stage-${name}.png` });
};

const MONITORS = (count) =>
  Array.from({ length: count }, (_, i) => ({
    id: `monitor:${i + 1}`,
    kind: "monitor",
    title: `Display ${i + 1}`,
    subtitle: "2560 x 1440 @ 165Hz",
    width: 2560,
    height: 1440,
    x: 0,
    y: 0,
    isPrimary: i === 0,
  }));

// 1. The empty board — the view he opens on, now with the stage named.
await run(() => {
  const store = window.__screenDropStore.getState();
  store.newBoard("Untitled board");
});
await shot("01-opening");

// 2. The stage selected: handles, and the inspector explaining what it is.
await run(() => window.__screenDropStore.getState().selectStage(true));
await shot("02-selected");

// 3. A real board, stage on one group, the rest parked off to the side.
await run((monitors) => {
  const useStore = window.__screenDropStore;
  const store = useStore.getState();
  store.newBoard("Discovery call");
  useStore.setState({ sources: monitors, monitors });
  store.addSources(monitors.map((m) => m.id));
  store.addNote("Notes only I can see — the pricing floor, and what to ask next.");
  store.arrange("all");
  store.selectStage(false);
  store.select([]);
}, MONITORS(4));
await shot("03-board", 2500);

// 4. Off the stage: the private area, and the hint that says so.
await run(() => {
  const store = window.__screenDropStore.getState();
  const note = store.doc.tiles.find((t) => t.kind === "note");
  if (note) store.patchTile(note.id, { x: store.doc.frame.x + 2600, y: store.doc.frame.y + 120 });
  store.fitEverything();
});
await shot("04-offstage", 1600);

// 5. The stage tightened onto one screen, which is the move the app exists for.
await run(() => {
  const store = window.__screenDropStore.getState();
  const first = store.doc.tiles.find((t) => t.kind === "source");
  store.showStage();
  if (first) {
    store.setStage(
      { x: first.x - 40, y: first.y - 40, w: first.w + 80, h: (first.w + 80) / store.doc.aspect },
      { force: true },
    );
  }
  store.selectStage(true);
  store.showStage();
});
await shot("05-tightened", 1600);

// 6. The same thing in the dark look, because half of any call is at night.
await run(() => window.__screenDropStore.getState().setLook("graphite-dark"));
await shot("06-dark", 900);

// 7. The shortcut sheet, since two of the new keys live there.
await run(() => {
  const store = window.__screenDropStore.getState();
  store.setLook("pure-white");
  store.setPanel("settings");
});
await shot("07-settings", 700);

console.log(JSON.stringify({ out: outDir, problems }, null, 2));
await browser.close();
process.exit(problems.length ? 1 : 0);
