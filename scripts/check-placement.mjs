// What you draw over is what gets covered.
//
// Redactions were stored against the tile's box and drawn against its body,
// so a rectangle over an API key covered something a title bar above it --
// a privacy promise that quietly did not hold. This draws one and reads it
// back the way the renderer does.
//
//   node scripts/check-placement.mjs http://localhost:4483
import { chromium } from "file:///C:/Users/kong1/adgap/node_modules/playwright/index.mjs";
const base = process.argv[2];
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1400, height: 800 } })).newPage();
const act = (s) => page.evaluate((b) => new Function("store", b)(window.__screenStuffStore.getState()), s);

await page.goto(`${base}/?demo`, { waitUntil: "networkidle" });
await page.waitForFunction(() => "__screenStuffStore" in window, null, { timeout: 20000 });
await page.evaluate(() => document.querySelector(".demo-banner__head .icon-btn")?.click());
await page.waitForTimeout(1500);

const result = await page.evaluate(async () => {
  const store = window.__screenStuffStore.getState();
  const mod = await import("/src/core/tilebox.ts");
  const red = await import("/src/core/redact.ts");
  const tile = store.doc.tiles.find((t) => t.kind === "source");
  const content = mod.contentRect(tile);

  // Draw a redaction over the middle of the picture, exactly as a drag would.
  const drawn = { x: content.x + content.w * 0.25, y: content.y + content.h * 0.25,
                  w: content.w * 0.5, h: content.h * 0.5 };
  store.addRedaction(tile.id, drawn);
  const after = window.__screenStuffStore.getState().doc.tiles.find((t) => t.id === tile.id);
  const stored = after.redactions[0];
  // And back out the way the renderer does it.
  const drawnBack = red.toBoardRect(after, stored, mod.contentRect(after));
  return {
    tile: { x: tile.x, y: tile.y, w: tile.w, h: tile.h },
    content,
    drawn,
    stored: { x: stored.x, y: stored.y, w: stored.w, h: stored.h },
    drawnBack,
  };
});

const near = (a, b, tol = 0.75) => Math.abs(a - b) < tol;
const r = result;
console.log("tile box :", JSON.stringify(r.tile));
console.log("content  :", JSON.stringify(r.content));
console.log("drew     :", JSON.stringify(r.drawn));
console.log("stored   :", JSON.stringify(r.stored));
console.log("drawn as :", JSON.stringify(r.drawnBack));
const ok = ["x","y","w","h"].every((k) => near(r.drawn[k], r.drawnBack[k]));
console.log(ok ? "\nPASS: a redaction is drawn exactly where it was drawn" 
               : "\nFAIL: what gets covered is not what was selected");
console.log(`(the title bar offset that used to be lost: ${(r.content.y - r.tile.y).toFixed(1)} units)`);
await browser.close();
process.exit(ok ? 0 : 1);
