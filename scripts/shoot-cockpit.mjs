// Screenshots the cockpit in a realistic state: a board with live displays on
// it, so the picture shows the product rather than an empty canvas.
import { chromium } from "file:///C:/Users/kong1/adgap/node_modules/playwright/index.mjs";

const [stream, outDir, monitors = "4"] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1520, height: 980 } });
const problems = [];
page.on("console", (m) => m.type() === "error" && problems.push(m.text()));
page.on("pageerror", (e) => problems.push(String(e)));

await page.goto(`http://localhost:4483/?stream=${encodeURIComponent(stream)}`, {
  waitUntil: "networkidle",
});
await page.waitForFunction(() => "__screenDropStore" in window, null, { timeout: 15000 });

await page.evaluate((count) => {
  const useStore = window.__screenDropStore;
  const store = useStore.getState();
  // Pretend the source list arrived, then use the normal path to add them.
  useStore.setState({
    sources: Array.from({ length: count }, (_, i) => ({
      id: `monitor:${i + 1}`,
      kind: "monitor",
      title: `Display ${i + 1}`,
      subtitle: "2560 x 1440 @ 165Hz",
      width: 2560,
      height: 1440,
      x: 0,
      y: 0,
      isPrimary: i === 0,
    })),
    monitors: Array.from({ length: count }, (_, i) => ({
      id: `monitor:${i + 1}`,
      kind: "monitor",
      title: `Display ${i + 1}`,
      subtitle: "2560 x 1440 @ 165Hz",
      width: 2560,
      height: 1440,
      x: 0,
      y: 0,
      isPrimary: i === 0,
    })),
  });
  store.setBoardProp({ name: "Discovery call" });
  store.addSources(Array.from({ length: count }, (_, i) => `monitor:${i + 1}`));
  store.addNote("Their site, their ads, and the mockup — all in one shot.");
  store.saveScene("Four up");
  store.fitEverything();
  store.select([]);
}, Number(monitors));

await page.waitForTimeout(5000);
await page.screenshot({ path: `${outDir}/cockpit-live.png` });

// The guests panel.
await page.evaluate(() => window.__screenDropStore.getState().setPanel("guests"));
await page.waitForTimeout(700);
await page.screenshot({ path: `${outDir}/cockpit-guests.png` });

console.log(JSON.stringify({ problems, out: outDir }, null, 2));
await browser.close();
process.exit(problems.length ? 1 : 0);
