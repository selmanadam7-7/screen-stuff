// How much crosses to the board window during a busy second.
//
// The cockpit used to send the whole document on every store write, and
// several things write on every animation frame -- the speaking meter, the
// stage animation, the pointer poll. So the app was at its slowest exactly
// while a stage was flying, which is when it is on screen.
//
// Run this after touching anything on the snapshot path. The number that
// matters is how few snapshots carry a document.
//
//   node scripts/measure-snapshots.mjs http://localhost:4483
import { chromium } from "file:///C:/Users/kong1/adgap/node_modules/playwright/index.mjs";
const base = process.argv[2];
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1400, height: 800 } })).newPage();
const act = (s) => page.evaluate((b) => new Function("store", b)(window.__screenStuffStore.getState()), s);

await page.goto(`${base}/?demo`, { waitUntil: "networkidle" });
await page.waitForFunction(() => "__screenStuffStore" in window, null, { timeout: 20000 });
await page.evaluate(() => document.querySelector(".demo-banner__head .icon-btn")?.click());
await page.waitForTimeout(1500);

await page.evaluate(() => {
  window.__count = { messages: 0, withDoc: 0, bytes: 0, docBytes: 0 };
  const ch = new BroadcastChannel("screen-stuff");
  ch.addEventListener("message", (e) => {
    if (e.data?.event !== "sd:snapshot") return;
    const p = e.data.payload;
    window.__count.messages++;
    const size = JSON.stringify(p).length;
    window.__count.bytes += size;
    if (p.doc) { window.__count.withDoc++; window.__count.docBytes += size; }
  });
});

// A busy second: the camera meter writing every frame, plus a stage fly.
await page.evaluate(() => {
  const s = window.__screenStuffStore.getState();
  let n = 0;
  window.__meter = setInterval(() => s.setCameraEmphasis((n++ % 100) / 100), 16);
});
await act("const t = store.doc.tiles.find(x => x.kind === 'source'); store.setStage({x:t.x,y:t.y,w:t.w,h:t.h}, {transition:'fly', force:true});");
await page.waitForTimeout(3000);
await page.evaluate(() => clearInterval(window.__meter));

const c = await page.evaluate(() => window.__count);
const perSec = (n) => (n / 3).toFixed(1);
console.log(`over 3 seconds of a flying stage + a 60Hz speaking meter:`);
console.log(`  snapshots sent      : ${c.messages}  (${perSec(c.messages)}/s)`);
console.log(`  ...carrying the doc : ${c.withDoc}  (${perSec(c.withDoc)}/s)`);
console.log(`  total payload       : ${(c.bytes/1024).toFixed(0)} KB  (${(c.bytes/3/1024).toFixed(0)} KB/s)`);
console.log(`  if every one carried the doc, it would have been ~${((c.docBytes / Math.max(1,c.withDoc)) * c.messages / 1024).toFixed(0)} KB`);
await browser.close();
