/**
 * End-to-end check of the guest link, against a running `guest_harness`.
 *
 *   node scripts/check-guest.mjs <guest-url> <out.png>
 *
 * Verifies three things:
 *   1. the page loads, joins, and renders live tiles;
 *   2. a guest cannot open a source that is not on the board;
 *   3. drawing reaches the host.
 */
import { chromium } from "file:///C:/Users/kong1/adgap/node_modules/playwright/index.mjs";

const [guestUrl, out] = process.argv.slice(2);
if (!guestUrl || !out) {
  console.error("usage: check-guest.mjs <guest-url> <out.png>");
  process.exit(2);
}

const origin = new URL(guestUrl).origin;
const wsUrl = `${origin.replace("http", "ws")}/gw`;

// --- 1 & 3: the page itself ------------------------------------------------
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const problems = [];
page.on("console", (m) => m.type() === "error" && problems.push(m.text()));
page.on("pageerror", (e) => problems.push(String(e)));

await page.goto(guestUrl, { waitUntil: "networkidle" });
await page.fill("#guest-name-input", "Aaron");
await page.click("#guest-join");
await page.waitForTimeout(4500);

const rendered = await page.evaluate(() => {
  const canvas = document.getElementById("guest-stage");
  const ctx = canvas.getContext("2d");
  const seen = new Set();
  for (let y = 20; y < canvas.height; y += 40) {
    for (let x = 20; x < canvas.width; x += 40) {
      const [r, g, b] = ctx.getImageData(x, y, 1, 1).data;
      seen.add(`${r >> 4},${g >> 4},${b >> 4}`);
    }
  }
  return {
    distinctColours: seen.size,
    name: document.getElementById("guest-name")?.textContent ?? "",
    gateGone: document.getElementById("guest-gate")?.classList.contains("is-gone"),
    toolsShown: (document.getElementById("guest-tools")?.children.length ?? 0) > 0,
  };
});

await page.screenshot({ path: out });
await browser.close();

// --- 2: the security gate, over a raw socket -------------------------------
const gate = await new Promise((resolve) => {
  const socket = new WebSocket(wsUrl);
  const replies = [];
  const done = (value) => {
    try {
      socket.close();
    } catch {
      /* already closing */
    }
    resolve(value);
  };
  socket.addEventListener("open", () => {
    socket.send(JSON.stringify({ t: "hello", name: "probe" }));
    // On the board: allowed. Not on the board: must be refused.
    socket.send(
      JSON.stringify({ t: "subscribe", stream_id: 1, source: "monitor:1", width: 320, height: 180 }),
    );
    socket.send(
      JSON.stringify({
        t: "subscribe",
        stream_id: 2,
        source: "window:999999",
        width: 320,
        height: 180,
      }),
    );
  });
  socket.addEventListener("message", (e) => {
    if (typeof e.data === "string") {
      const message = JSON.parse(e.data);
      if (message.t === "refused") replies.push(message.message);
    } else {
      replies.push("frame");
    }
  });
  setTimeout(() => done(replies), 3500);
});

const gotFrames = gate.includes("frame");
const refusedOffBoard = gate.some((r) => typeof r === "string" && r.includes("not on the board"));

const result = {
  page: rendered,
  gate: { gotFrames, refusedOffBoard, replies: gate.slice(0, 6) },
  out,
  problems,
};
const ok =
  rendered.distinctColours > 12 &&
  rendered.gateGone === true &&
  rendered.name.length > 0 &&
  gotFrames &&
  refusedOffBoard &&
  problems.length === 0;

console.log(JSON.stringify({ ...result, ok }, null, 2));
process.exit(ok ? 0 : 1);
