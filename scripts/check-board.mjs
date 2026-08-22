/**
 * End-to-end check of the board renderer.
 *
 * Loads board.html against a running capture engine, pushes it a real snapshot
 * over the bus (which falls back to a BroadcastChannel outside Tauri), waits for
 * live frames to land, and screenshots the result. This exercises the whole
 * path — frame server, decode, media pool, compositor — without needing the
 * desktop window in front of anything.
 *
 *   node scripts/check-board.mjs <ws-url> <out.png> [monitor-count]
 */
import { chromium } from "file:///C:/Users/kong1/adgap/node_modules/playwright/index.mjs";

const [streamUrl, out, monitorCount = "4"] = process.argv.slice(2);
if (!streamUrl || !out) {
  console.error("usage: check-board.mjs <ws-url> <out.png> [monitor-count]");
  process.exit(2);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const problems = [];
page.on("console", (m) => m.type() === "error" && problems.push(m.text()));
page.on("pageerror", (e) => problems.push(String(e)));

const url = `http://localhost:4483/board.html?stream=${encodeURIComponent(streamUrl)}`;
await page.goto(url, { waitUntil: "networkidle" });

// Build a board of every kind of tile the renderer knows how to draw.
const report = await page.evaluate(async (count) => {
  const FRAME = { x: 0, y: 0, w: 1920, h: 1080 };
  const gap = 24;
  const cols = 2;
  const cellW = (FRAME.w - gap * 3) / cols;
  const cellH = cellW / (16 / 9);

  const tile = (over) => ({
    id: over.id,
    kind: over.kind,
    x: 0,
    y: 0,
    w: 400,
    h: 225,
    z: 1,
    rotation: 0,
    opacity: 1,
    radius: 8,
    locked: false,
    hidden: false,
    fit: "contain",
    label: "",
    shadow: true,
    ...over,
  });

  const tiles = [];
  for (let i = 0; i < count; i++) {
    tiles.push(
      tile({
        id: `m${i}`,
        kind: "source",
        source: `monitor:${i + 1}`,
        label: `Display ${i + 1}`,
        x: gap + (i % cols) * (cellW + gap),
        y: gap + Math.floor(i / cols) * (cellH + gap),
        w: cellW,
        h: cellH,
        z: i + 1,
      }),
    );
  }
  tiles.push(
    tile({
      id: "note",
      kind: "note",
      x: FRAME.w - 470,
      y: FRAME.h - 300,
      w: 430,
      h: 240,
      z: 50,
      radius: 6,
      shadow: false,
      text: "Every screen, one board.\nThis note proves text wrapping works.",
      color: "#F5D06B",
      textColor: "#171307",
      fontSize: 34,
      align: "left",
    }),
  );

  const doc = {
    version: 1,
    name: "Renderer check",
    frame: FRAME,
    aspect: 16 / 9,
    tiles,
    strokes: [
      {
        id: "s1",
        tool: "arrow",
        color: "#FF5A41",
        width: 8,
        points: [980, 620, 1360, 830],
        createdAt: 0,
      },
      {
        id: "s2",
        tool: "box",
        color: "#56D9A3",
        width: 6,
        points: [40, 40, 620, 380],
        createdAt: 0,
      },
    ],
    scenes: [],
    background: "#08090D",
    showGrid: true,
    quality: 88,
    fps: 30,
  };

  const channel = new BroadcastChannel("screen-drop");
  channel.postMessage({
    target: "board",
    event: "sd:snapshot",
    payload: { doc, frame: FRAME, revision: 1, clean: true },
  });

  // Give the engine time to open captures and deliver frames.
  await new Promise((r) => setTimeout(r, 4000));

  const canvas = document.getElementById("stage");
  const ctx = canvas.getContext("2d");
  // Sample a grid of points; a board that drew nothing is uniformly background.
  const seen = new Set();
  for (let y = 20; y < canvas.height; y += 40) {
    for (let x = 20; x < canvas.width; x += 40) {
      const [r, g, b] = ctx.getImageData(x, y, 1, 1).data;
      seen.add(`${r >> 4},${g >> 4},${b >> 4}`);
    }
  }
  return {
    canvas: { width: canvas.width, height: canvas.height },
    distinctColours: seen.size,
    tiles: doc.tiles.length,
  };
}, Number(monitorCount));

await page.screenshot({ path: out });
await browser.close();

const ok = report.distinctColours > 12;
console.log(JSON.stringify({ ...report, out, problems, ok }, null, 2));
process.exit(ok && problems.length === 0 ? 0 : 1);
