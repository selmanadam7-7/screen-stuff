// Measures the cockpit at several widths and fails on the layout bugs that
// actually happen: something wider than the panel holding it, two floating
// controls sitting on top of each other, or the page scrolling sideways.
//
// The window's own minimum is 1080, so every width at or above that must lay
// out cleanly.
//
//   node scripts/check-layout.mjs [http://localhost:4483]
import { chromium } from "file:///C:/Users/kong1/adgap/node_modules/playwright/index.mjs";

const base = process.argv[2] ?? "http://localhost:4483";
const browser = await chromium.launch();
const failures = [];

for (const [width, height] of [
  [1080, 700],
  [1280, 720],
  [1520, 980],
  [1920, 1080],
  [2560, 1400],
]) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto(base, { waitUntil: "networkidle" });
  await page.waitForFunction(() => "__screenDropStore" in window, null, { timeout: 15000 });

  // A realistic board, and the stage selected — the panel with the most in it.
  await page.evaluate(() => {
    const useStore = window.__screenDropStore;
    const store = useStore.getState();
    const monitors = Array.from({ length: 4 }, (_, i) => ({
      id: `monitor:${i + 1}`,
      kind: "monitor",
      title: `Display ${i + 1}`,
      subtitle: "2560 x 1440",
      width: 2560,
      height: 1440,
      x: 0,
      y: 0,
      isPrimary: i === 0,
    }));
    useStore.setState({ sources: monitors, monitors });
    store.addSources(monitors.map((m) => m.id));
    store.addNote("measuring");
    store.saveScene("Four up");
    store.selectStage(true);
  });
  await page.waitForTimeout(900);

  const report = await page.evaluate((viewport) => {
    const rect = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width };
    };

    /** Anything sticking out of the panel that contains it. */
    const overflowing = [];
    const panels = ".inspector__scroll, .sidebar, .toolbar, .zoom, .group, .btn-row, .grid-2";
    for (const panel of document.querySelectorAll(panels)) {
      const box = panel.getBoundingClientRect();
      for (const child of panel.querySelectorAll("*")) {
        const c = child.getBoundingClientRect();
        if (c.width === 0) continue;
        if (c.right > box.right + 1 || c.left < box.left - 1) {
          overflowing.push({
            panel: panel.className,
            child: child.className || child.tagName,
            by: Math.round(Math.max(c.right - box.right, box.left - c.left)),
          });
        }
      }
    }

    const overlap = (a, b) =>
      a && b && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;

    const toolbar = rect(".toolbar");
    const onair = rect(".onair, .onair--empty");
    const rail = rect(".scene-rail");
    const zoom = rect(".zoom");
    const minimap = rect(".minimap");
    const canvas = rect(".editor canvas");
    const inspector = rect(".inspector");

    return {
      viewport,
      overflowing: overflowing.slice(0, 6),
      toolbarOverlapsOnAir: overlap(toolbar, onair),
      railOverlapsZoom: overlap(rail, zoom),
      railOverlapsMinimap: overlap(rail, minimap),
      canvasOverlapsInspector: canvas && inspector ? canvas.right > inspector.left + 1 : null,
      toolbarScrolls: (() => {
        const t = document.querySelector(".toolbar");
        return t ? t.scrollWidth > t.clientWidth + 1 : null;
      })(),
      bodyScrollsSideways: document.documentElement.scrollWidth > window.innerWidth,
    };
  }, `${width}x${height}`);

  const bad = [];
  if (report.overflowing.length) bad.push(`overflow: ${JSON.stringify(report.overflowing)}`);
  if (report.toolbarOverlapsOnAir) bad.push("the toolbar sits under the on-air pill");
  if (report.railOverlapsZoom) bad.push("the scene rail sits under the zoom control");
  if (report.railOverlapsMinimap) bad.push("the scene rail sits under the minimap");
  if (report.canvasOverlapsInspector) bad.push("the canvas runs under the inspector");
  if (report.toolbarScrolls) bad.push("the toolbar is wider than itself");
  if (report.bodyScrollsSideways) bad.push("the page scrolls sideways");

  console.log(`${bad.length ? " FAIL " : "  ok  "} ${width}x${height}${bad.length ? "  — " + bad.join("; ") : ""}`);
  if (bad.length) failures.push({ viewport: report.viewport, bad });

  await page.close();
}

await browser.close();
console.log(failures.length ? `\n${failures.length} widths with layout problems` : "\nevery width lays out cleanly");
process.exit(failures.length ? 1 : 0);
