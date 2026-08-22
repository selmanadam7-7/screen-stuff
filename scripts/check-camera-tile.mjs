// Puts a camera tile on the board and checks it renders, in both shapes.
// Uses Chromium's synthetic camera so the test does not fight whatever app is
// holding the real one.
import { chromium } from "file:///C:/Users/kong1/adgap/node_modules/playwright/index.mjs";

const [stream, outDir] = process.argv.slice(2);
const browser = await chromium.launch({
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
});
const context = await browser.newContext({ permissions: ["camera"] });
const page = await context.newPage();
const problems = [];
page.on("console", (m) => m.type() === "error" && problems.push(m.text()));
page.on("pageerror", (e) => problems.push(String(e)));

await page.goto(`http://localhost:4483/?stream=${encodeURIComponent(stream)}`, {
  waitUntil: "networkidle",
});
await page.waitForFunction(() => "__screenDropStore" in window, null, { timeout: 15000 });

const report = await page.evaluate(async () => {
  const useStore = window.__screenDropStore;
  const store = useStore.getState();
  store.setBoardProp({ name: "Camera check" });
  store.addCamera();

  const id = useStore.getState().selection[0];
  // Make it big enough to read in the screenshot.
  store.patchTile(id, { x: 300, y: 200, w: 900, h: 506 });
  await new Promise((r) => setTimeout(r, 3000));
  store.fitEverything();
  await new Promise((r) => setTimeout(r, 1500));

  const tile = useStore.getState().doc.tiles.find((t) => t.id === id);
  const canvas = document.querySelector(".editor canvas");
  const ctx = canvas.getContext("2d");
  const seen = new Set();
  for (let y = 20; y < canvas.height; y += 25) {
    for (let x = 20; x < canvas.width; x += 25) {
      const [r, g, b] = ctx.getImageData(x, y, 1, 1).data;
      seen.add(`${r >> 4},${g >> 4},${b >> 4}`);
    }
  }
  return { tileKind: tile?.kind, mirrored: tile?.mirrored, shape: tile?.shape, distinctColours: seen.size };
});

await page.screenshot({ path: `${outDir}/camera-rect.png` });

// And as a circle, which takes a different clip path.
await page.evaluate(async () => {
  const useStore = window.__screenDropStore;
  const id = useStore.getState().doc.tiles.find((t) => t.kind === "camera").id;
  useStore.getState().patchTile(id, { shape: "circle", w: 600, h: 600 });
  useStore.getState().fitEverything();
  await new Promise((r) => setTimeout(r, 1200));
});
await page.screenshot({ path: `${outDir}/camera-circle.png` });

console.log(JSON.stringify({ ...report, problems, ok: report.distinctColours > 10 }, null, 2));
await browser.close();
process.exit(report.distinctColours > 10 && problems.length === 0 ? 0 : 1);
